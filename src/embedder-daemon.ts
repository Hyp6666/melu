import { existsSync, unlinkSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { pathToFileURL } from "node:url";

import { disposeEmbedder, embedBatch, getEmbedder } from "./embedder.js";
import {
  EMBEDDER_DAEMON_DEFAULT_IDLE_CHECK_MS,
  EMBEDDER_DAEMON_DEFAULT_IDLE_TIMEOUT_MS,
  type EmbedderDaemonRequest,
  type EmbedderDaemonResponse,
  type EmbedderRequestType,
  encodeEmbedderMessage,
  getEmbedderDaemonSocketPath,
  isEmbedderDaemonRequest,
  normalizeEmbedderTexts,
  tryParseEmbedderMessage,
} from "./embedder-ipc.js";
import { ensureDirs, loadConfig } from "./config.js";

export interface EmbedderDaemonOptions {
  runId: string;
  ownerPid?: number;
  socketPath?: string;
  modelId?: string;
  idleTimeoutMs?: number;
  idleCheckMs?: number;
}

interface RuntimeState {
  server: ReturnType<typeof createServer>;
  socketPath: string;
  ownerPid: number;
  idleTimeoutMs: number;
  idleCheckMs: number;
  modelId: string;
  shutdownRequested: boolean;
  inFlight: number;
  lastActivityAt: number;
  requestChain: Promise<void>;
  idleTimer: NodeJS.Timeout | null;
}

function hasProcessExited(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return true;

  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

function serializeResponse(response: EmbedderDaemonResponse): string {
  return encodeEmbedderMessage(response);
}

function createRequestError(
  request: EmbedderDaemonRequest,
  error: string,
  latencyMs: number,
): EmbedderDaemonResponse {
  return {
    id: request.id,
    run_id: request.run_id,
    type: request.type,
    ok: false,
    error,
    latency_ms: latencyMs,
  };
}

function createRequestSuccess(
  request: EmbedderDaemonRequest,
  latencyMs: number,
  embeddings?: number[][],
): EmbedderDaemonResponse {
  return {
    id: request.id,
    run_id: request.run_id,
    type: request.type,
    ok: true,
    error: null,
    latency_ms: latencyMs,
    embeddings,
  };
}

async function embedRequest(
  request: EmbedderDaemonRequest,
  modelId: string,
): Promise<EmbedderDaemonResponse> {
  const startedAt = Date.now();

  try {
    const texts = normalizeEmbedderTexts(request.texts);
    if (request.type !== "ping" && texts.length === 0) {
      return createRequestError(request, "texts must contain at least one non-empty string", Date.now() - startedAt);
    }

    if (request.type === "ping") {
      return createRequestSuccess(request, Date.now() - startedAt, []);
    }

    const vectors = await embedBatch(texts, modelId, {
      purpose: request.type === "memory" ? "memory" : "query",
    });
    return createRequestSuccess(
      request,
      Date.now() - startedAt,
      vectors.map((vector) => Array.from(vector)),
    );
  } catch (error) {
    return createRequestError(
      request,
      error instanceof Error ? error.message : String(error),
      Date.now() - startedAt,
    );
  }
}

function scheduleTask(state: RuntimeState, task: () => Promise<void>): void {
  state.requestChain = state.requestChain
    .then(task)
    .catch((error) => {
      console.error("[Melu] Embedder daemon task failed:", error);
    });
}

function maybeShutdownForIdle(state: RuntimeState): void {
  if (state.shutdownRequested) return;
  if (state.inFlight > 0) return;
  if (Date.now() - state.lastActivityAt < state.idleTimeoutMs) return;
  if (!hasProcessExited(state.ownerPid)) return;

  state.shutdownRequested = true;
  void shutdownEmbedderDaemon(state, 0, "owner process exited and daemon stayed idle");
}

async function shutdownEmbedderDaemon(
  state: RuntimeState,
  exitCode: number,
  reason: string,
): Promise<void> {
  if (state.shutdownRequested && exitCode !== 0) {
    return;
  }

  state.shutdownRequested = true;
  if (state.idleTimer) {
    clearInterval(state.idleTimer);
    state.idleTimer = null;
  }

  try {
    state.server.close();
  } catch {
    // Ignore close failures during shutdown.
  }

  try {
    await state.requestChain;
  } catch {
    // Ignore queued failures during shutdown.
  }

  try {
    await disposeEmbedder();
  } catch (error) {
    console.error("[Melu] Failed to dispose embedder during shutdown:", error);
  }

  try {
    if (existsSync(state.socketPath)) {
      unlinkSync(state.socketPath);
    }
  } catch {
    // Ignore cleanup failures.
  }

  console.error(`[Melu] Embedder daemon exited: ${reason}`);
  process.exit(exitCode);
}

function attachSocketHandlers(socket: Socket, state: RuntimeState): void {
  socket.setEncoding("utf8");

  let buffer = "";
  let handled = false;

  const finishWithResponse = (response: EmbedderDaemonResponse): void => {
    if (handled) return;
    handled = true;

    const payload = serializeResponse(response);
    socket.end(payload, "utf8");
  };

  socket.on("data", (chunk) => {
    if (handled) return;

    buffer += chunk;
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex === -1) return;

    const rawLine = buffer.slice(0, newlineIndex);
    const parsed = tryParseEmbedderMessage(rawLine);
    if (!isEmbedderDaemonRequest(parsed)) {
      finishWithResponse(
        createRequestError(
          {
            id: "invalid",
            run_id: "invalid",
            type: "ping",
            texts: [],
          },
          "Invalid embedder daemon request",
          0,
        ),
      );
      return;
    }

    const request = parsed;
    const queueItem = request;
    state.inFlight += 1;

    scheduleTask(state, async () => {
      state.lastActivityAt = Date.now();
      const response = await embedRequest(queueItem, state.modelId);
      state.inFlight -= 1;
      state.lastActivityAt = Date.now();

      if (response.run_id !== queueItem.run_id) {
        finishWithResponse(
          createRequestError(
            queueItem,
            "run_id mismatch in embedder daemon response",
            response.latency_ms,
          ),
        );
        return;
      }

      finishWithResponse(response);
      maybeShutdownForIdle(state);
    });
  });

  socket.on("error", (error) => {
    if (!handled) {
      handled = true;
      console.error("[Melu] Embedder daemon socket error:", error);
    }
  });

  socket.on("close", () => {
    if (!handled) {
      handled = true;
    }
  });
}

async function ensureSocketPathAvailable(socketPath: string): Promise<void> {
  if (!existsSync(socketPath)) return;

  const isLiveSocket = await new Promise<boolean>((resolve) => {
    const probe = createConnection({ path: socketPath });
    let settled = false;

    const settle = (isAlive: boolean): void => {
      if (settled) return;
      settled = true;
      probe.removeAllListeners();
      probe.destroy();
      resolve(isAlive);
    };

    probe.once("connect", () => {
      settle(true);
    });
    probe.once("error", () => {
      settle(false);
    });
    probe.setTimeout(250, () => {
      settle(false);
    });
  });

  if (isLiveSocket) {
    throw new Error(`Embedder daemon already appears to be running at ${socketPath}`);
  }

  try {
    unlinkSync(socketPath);
  } catch {
    // Ignore stale cleanup failures. Listen will fail if the path is genuinely busy.
  }
}

export async function startEmbedderDaemon(options: EmbedderDaemonOptions): Promise<void> {
  ensureDirs();
  delete process.env.MELU_EMBEDDER_SOCKET;

  const config = loadConfig();
  const socketPath = options.socketPath ?? getEmbedderDaemonSocketPath(options.runId);
  const ownerPid = options.ownerPid ?? process.ppid;
  const idleTimeoutMs = options.idleTimeoutMs ?? EMBEDDER_DAEMON_DEFAULT_IDLE_TIMEOUT_MS;
  const idleCheckMs = options.idleCheckMs ?? EMBEDDER_DAEMON_DEFAULT_IDLE_CHECK_MS;
  const modelId = options.modelId ?? config.embeddingModel;

  if (process.platform === "win32") {
    throw new Error("Embedder daemon currently expects a Unix socket path and is not wired for Windows yet.");
  }

  await ensureSocketPathAvailable(socketPath);

  console.error(`[Melu] Preloading embedder model for run ${options.runId}`);
  await getEmbedder(modelId);

  const server = createServer();
  const state: RuntimeState = {
    server,
    socketPath,
    ownerPid,
    idleTimeoutMs,
    idleCheckMs,
    modelId,
    shutdownRequested: false,
    inFlight: 0,
    lastActivityAt: Date.now(),
    requestChain: Promise.resolve(),
    idleTimer: null,
  };

  server.on("connection", (socket) => {
    attachSocketHandlers(socket, state);
  });

  server.on("error", (error) => {
    console.error("[Melu] Embedder daemon server error:", error);
    void shutdownEmbedderDaemon(state, 1, "server error");
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(socketPath, () => resolve());
    server.once("error", reject);
  });

  state.idleTimer = setInterval(() => {
    maybeShutdownForIdle(state);
  }, idleCheckMs);

  process.once("SIGINT", () => {
    void shutdownEmbedderDaemon(state, 0, "SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdownEmbedderDaemon(state, 0, "SIGTERM");
  });

  console.error(`[Melu] Embedder daemon listening at ${socketPath}`);
}

export async function runEmbedderDaemonFromEnv(): Promise<void> {
  const runId = process.env.MELU_RUN_ID ?? process.env.MELU_DAEMON_RUN_ID ?? "default";
  const socketPath = process.env.MELU_EMBEDDER_SOCKET?.trim() || undefined;
  const ownerPidRaw = process.env.MELU_DAEMON_OWNER_PID ?? "";
  const idleTimeoutRaw = process.env.MELU_DAEMON_IDLE_TIMEOUT_MS ?? "";
  const idleCheckRaw = process.env.MELU_DAEMON_IDLE_CHECK_MS ?? "";

  const ownerPid = Number(ownerPidRaw);
  const idleTimeoutMs = Number(idleTimeoutRaw);
  const idleCheckMs = Number(idleCheckRaw);

  await startEmbedderDaemon({
    runId,
    socketPath,
    ownerPid: Number.isInteger(ownerPid) && ownerPid > 0 ? ownerPid : undefined,
    idleTimeoutMs: Number.isFinite(idleTimeoutMs) && idleTimeoutMs > 0 ? idleTimeoutMs : undefined,
    idleCheckMs: Number.isFinite(idleCheckMs) && idleCheckMs > 0 ? idleCheckMs : undefined,
  });
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  void runEmbedderDaemonFromEnv().catch((error) => {
    console.error("[Melu] Failed to start embedder daemon:", error);
    process.exitCode = 1;
  });
}
