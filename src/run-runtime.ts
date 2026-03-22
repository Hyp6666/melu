import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createConnection } from "node:net";

import { MELU_HOME, SOCKETS_DIR, STATS_DIR } from "./config.js";

export interface MeluRunPaths {
  runId: string;
  socketPath: string;
  statsPath: string;
  pendingExtractionsDir: string;
}

export interface MeluRunStats {
  runId: string;
  processed: number;
  newMemories: number;
  failed: number;
  remainingQueue: number;
  updatedAt: string;
}

interface JsonSocketResponse {
  id?: string;
  type?: string;
  error?: string;
  latency_ms?: number;
  [key: string]: unknown;
}

export function createRunId(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export function getRunPaths(runId: string): MeluRunPaths {
  return {
    runId,
    socketPath: join(SOCKETS_DIR, runId, "embedder.sock"),
    statsPath: join(STATS_DIR, runId, "stats.json"),
    pendingExtractionsDir: join(MELU_HOME, "pending-extractions", runId),
  };
}

export function ensureRunPaths(paths: MeluRunPaths): void {
  for (const dir of [dirname(paths.socketPath), dirname(paths.statsPath), paths.pendingExtractionsDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

export function createInitialRunStats(runId: string, remainingQueue = 0): MeluRunStats {
  return {
    runId,
    processed: 0,
    newMemories: 0,
    failed: 0,
    remainingQueue,
    updatedAt: new Date().toISOString(),
  };
}

export function writeAtomicJson(filePath: string, value: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmpPath = join(
    dir,
    `.${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}.tmp`,
  );
  writeFileSync(tmpPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tmpPath, filePath);
}

export function readRunStats(statsPath: string): MeluRunStats | null {
  if (!existsSync(statsPath)) return null;
  try {
    const raw = readFileSync(statsPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<MeluRunStats>;
    if (
      typeof parsed.runId !== "string" ||
      typeof parsed.processed !== "number" ||
      typeof parsed.newMemories !== "number" ||
      typeof parsed.failed !== "number" ||
      typeof parsed.remainingQueue !== "number"
    ) {
      return null;
    }
    return {
      runId: parsed.runId,
      processed: parsed.processed,
      newMemories: parsed.newMemories,
      failed: parsed.failed,
      remainingQueue: parsed.remainingQueue,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function countQueueJobs(queueDir: string): number {
  if (!existsSync(queueDir)) return 0;
  try {
    return readdirSync(queueDir).filter((name) => name.endsWith(".pending.json") || name.endsWith(".working.json")).length;
  } catch {
    return 0;
  }
}

export function buildRunEnv(
  paths: MeluRunPaths,
  ownerPid: number,
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MELU_RUN_ID: paths.runId,
    MELU_OWNER_PID: String(ownerPid),
    MELU_EMBEDDER_SOCKET: paths.socketPath,
    MELU_PENDING_EXTRACTIONS_DIR: paths.pendingExtractionsDir,
    MELU_RUN_STATS_FILE: paths.statsPath,
    ...overrides,
  };
}

export function sendUnixSocketJson<TResponse extends JsonSocketResponse = JsonSocketResponse>(
  socketPath: string,
  payload: Record<string, unknown>,
  timeoutMs = 10000,
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = "";
    let settled = false;

    const finish = (error?: Error, response?: TResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve(response!);
      }
    };

    const timer = setTimeout(() => {
      finish(new Error(`timeout waiting for unix socket response: ${socketPath}`));
    }, timeoutMs);

    socket.setEncoding("utf-8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(payload)}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      const line = buffer.slice(0, newlineIndex).trim();
      if (!line) {
        finish(new Error("empty unix socket response"));
        return;
      }
      try {
        const parsed = JSON.parse(line) as TResponse;
        finish(undefined, parsed);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on("error", (error) => {
      finish(error);
    });
    socket.on("close", () => {
      if (!settled) {
        finish(new Error(`unix socket closed before response: ${socketPath}`));
      }
    });
  });
}

export async function waitForUnixSocketReady(
  socketPath: string,
  timeoutMs = 10000,
): Promise<void> {
  const start = Date.now();
  while (true) {
    try {
      const response = await sendUnixSocketJson(socketPath, {
        id: `ready-${Date.now()}`,
        type: "ping",
        texts: [],
      }, Math.min(2000, timeoutMs));
      if (!response.error) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    if (Date.now() - start >= timeoutMs) {
      throw new Error(`embedder daemon did not become ready within ${timeoutMs}ms`);
    }

    await sleep(250);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
