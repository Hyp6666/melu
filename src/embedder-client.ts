import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";

import {
  type EmbedderDaemonRequest,
  type EmbedderDaemonResponse,
  type EmbedderRequestType,
  getEmbedderDaemonSocketPath,
  isEmbedderDaemonRequest,
  isEmbedderRequestType,
  normalizeEmbedderTexts,
  encodeEmbedderMessage,
  tryParseEmbedderMessage,
} from "./embedder-ipc.js";

export interface EmbedderClientRequestOptions {
  runId: string;
  type: Exclude<EmbedderRequestType, "ping">;
  texts: string[];
  socketPath?: string;
  timeoutMs?: number;
}

export interface EmbedderClientPingOptions {
  runId: string;
  socketPath?: string;
  timeoutMs?: number;
}

export interface WaitForEmbedderDaemonOptions extends EmbedderClientPingOptions {
  retryIntervalMs?: number;
}

function connectSocket(socketPath: string, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    let settled = false;

    const settle = (error: Error | null, value?: Socket): void => {
      if (settled) return;
      settled = true;

      socket.removeAllListeners();
      if (error) {
        socket.destroy();
        reject(error);
        return;
      }

      resolve(value as Socket);
    };

    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs, () => {
      settle(new Error(`Timed out connecting to embedder daemon at ${socketPath}`));
    });

    socket.once("error", (error) => {
      settle(error instanceof Error ? error : new Error(String(error)));
    });

    socket.once("connect", () => {
      socket.setTimeout(0);
      settle(null, socket);
    });
  });
}

async function sendEmbedderRequest(
  request: EmbedderDaemonRequest,
  timeoutMs: number,
  socketPath: string,
): Promise<EmbedderDaemonResponse> {
  const socket = await connectSocket(socketPath, timeoutMs);

  return new Promise<EmbedderDaemonResponse>((resolve, reject) => {
    let buffer = "";
    let settled = false;

    const settle = (error: Error | null, response?: EmbedderDaemonResponse): void => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();

      if (error) {
        reject(error);
        return;
      }

      resolve(response as EmbedderDaemonResponse);
    };

    const onData = (chunk: string): void => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;

      const frame = buffer.slice(0, newlineIndex);
      const parsed = tryParseEmbedderMessage(frame);
      if (!parsed || typeof parsed !== "object") {
        settle(new Error("Invalid response from embedder daemon"));
        return;
      }

      const obj = parsed as Record<string, unknown>;
      if (
        typeof obj.id !== "string" ||
        typeof obj.run_id !== "string" ||
        !isEmbedderRequestType(obj.type) ||
        typeof obj.ok !== "boolean" ||
        typeof obj.latency_ms !== "number"
      ) {
        settle(new Error("Malformed response from embedder daemon"));
        return;
      }

      const response: EmbedderDaemonResponse = {
        id: obj.id,
        run_id: obj.run_id,
        type: obj.type,
        ok: obj.ok,
        error: typeof obj.error === "string" ? obj.error : null,
        latency_ms: obj.latency_ms,
        embeddings: Array.isArray(obj.embeddings)
          ? obj.embeddings
              .filter((item): item is number[] => Array.isArray(item))
              .map((vector) => vector.filter((value): value is number => typeof value === "number"))
          : undefined,
      };

      settle(null, response);
    };

    socket.on("data", onData);
    socket.once("error", (error) => {
      settle(error instanceof Error ? error : new Error(String(error)));
    });
    socket.once("timeout", () => {
      settle(new Error(`Timed out waiting for embedder daemon response at ${socketPath}`));
    });
    socket.once("close", () => {
      if (!settled) {
        settle(new Error("Embedder daemon closed the connection before responding"));
      }
    });

    socket.write(encodeEmbedderMessage(request), "utf8", (error) => {
      if (error) {
        settle(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

export async function requestEmbedderEmbeddings(
  options: EmbedderClientRequestOptions,
): Promise<Float32Array[]> {
  const texts = normalizeEmbedderTexts(options.texts);
  if (texts.length === 0) {
    throw new Error("Cannot request embeddings for empty texts");
  }

  const response = await sendEmbedderRequest(
    {
      id: randomUUID(),
      run_id: options.runId,
      type: options.type,
      texts,
    },
    options.timeoutMs ?? 60_000,
    options.socketPath ?? getEmbedderDaemonSocketPath(options.runId),
  );

  if (!response.ok) {
    throw new Error(response.error ?? "Embedder daemon returned an error");
  }

  const embeddings = response.embeddings ?? [];
  return embeddings.map((vector) => new Float32Array(vector));
}

export async function requestSingleEmbedderEmbedding(
  options: Omit<EmbedderClientRequestOptions, "texts"> & { text: string },
): Promise<Float32Array> {
  const vectors = await requestEmbedderEmbeddings({
    runId: options.runId,
    type: options.type,
    texts: [options.text],
    socketPath: options.socketPath,
    timeoutMs: options.timeoutMs,
  });

  if (vectors.length === 0) {
    throw new Error("Embedder daemon returned no vectors");
  }

  return vectors[0];
}

export async function pingEmbedderDaemon(
  options: EmbedderClientPingOptions,
): Promise<EmbedderDaemonResponse> {
  const response = await sendEmbedderRequest(
    {
      id: randomUUID(),
      run_id: options.runId,
      type: "ping",
      texts: [],
    },
    options.timeoutMs ?? 10_000,
    options.socketPath ?? getEmbedderDaemonSocketPath(options.runId),
  );

  if (!response.ok) {
    throw new Error(response.error ?? "Embedder daemon ping failed");
  }

  return response;
}

export async function waitForEmbedderDaemonReady(
  options: WaitForEmbedderDaemonOptions,
): Promise<void> {
  const retryIntervalMs = options.retryIntervalMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const startedAt = Date.now();

  while (true) {
    try {
      await pingEmbedderDaemon(options);
      return;
    } catch (error) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
    }
  }
}

export { getEmbedderDaemonSocketPath, isEmbedderDaemonRequest };
