import { createConnection } from "node:net";
import { splitTextIntoOverlappingWindows } from "./text-chunking.js";
import {
  buildEmbedderSocketPath,
  createMeluRuntimeContext,
  getMeluRuntimeContext,
  type MeluRuntimeContext,
} from "./runtime-context.js";

export type EmbedderRequestType = "query" | "memory";

export interface EmbedderDaemonRequestOptions {
  runId?: string | null;
  socketPath?: string | null;
  timeoutMs?: number;
  type?: EmbedderRequestType;
}

interface EmbedderDaemonRequest {
  id: string;
  type: EmbedderRequestType;
  texts: string[];
  model: string;
  run_id: string;
}

interface EmbedderDaemonResponse {
  id?: string;
  type?: EmbedderRequestType;
  embedding?: unknown;
  embeddings?: unknown;
  error?: string | null;
  latency_ms?: number | null;
}

const DEFAULT_TIMEOUT_MS = 2500;

export async function embedLongTextViaDaemon(
  text: string,
  modelId: string,
  options?: EmbedderDaemonRequestOptions,
): Promise<Float32Array | null> {
  const chunks = splitTextIntoOverlappingWindows(text);
  if (chunks.length === 0) return null;

  const embeddings = await embedTextsViaDaemon(chunks, modelId, {
    ...options,
    type: options?.type ?? "query",
  });
  if (!embeddings || embeddings.length === 0) return null;
  if (embeddings.length === 1) return embeddings[0];
  return averageVectors(embeddings);
}

export async function embedTextsViaDaemon(
  texts: string[],
  modelId: string,
  options?: EmbedderDaemonRequestOptions,
): Promise<Float32Array[] | null> {
  const normalizedTexts = texts
    .map((text) => text.trim())
    .filter((text) => text.length > 0);

  if (normalizedTexts.length === 0) return null;

  const runtime = resolveRuntimeContext(options);
  if (!runtime.embedderSocketPath) return null;

  const payload = await requestEmbeddings(runtime, normalizedTexts, modelId, options?.type ?? "query", options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (!payload) return null;

  return payload;
}

function resolveRuntimeContext(options?: EmbedderDaemonRequestOptions): MeluRuntimeContext {
  if (options?.runId) {
    const runtime = createMeluRuntimeContext(options.runId);
    return {
      runId: runtime.runId,
      embedderSocketPath: options.socketPath?.trim() || runtime.embedderSocketPath,
    };
  }

  const runtime = getMeluRuntimeContext();
  return {
    runId: runtime.runId,
    embedderSocketPath: options?.socketPath?.trim() || runtime.embedderSocketPath || buildEmbedderSocketPath(runtime.runId),
  };
}

async function requestEmbeddings(
  runtime: MeluRuntimeContext,
  texts: string[],
  modelId: string,
  type: EmbedderRequestType,
  timeoutMs: number,
): Promise<Float32Array[] | null> {
  return await new Promise((resolve) => {
    const socket = createConnection({ path: runtime.embedderSocketPath });
    socket.setEncoding("utf8");

    let settled = false;
    let buffer = "";

    const request: EmbedderDaemonRequest = {
      id: randomRequestId(),
      type,
      texts,
      model: modelId,
      run_id: runtime.runId,
    };

    const timeout = setTimeout(() => {
      fail(null);
    }, timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.removeAllListeners();
      try {
        socket.destroy();
      } catch {
        // Ignore cleanup failures.
      }
    };

    const succeed = (vectors: Float32Array[] | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(vectors);
    };

    const fail = (_error: unknown): void => {
      succeed(null);
    };

    socket.on("connect", () => {
      try {
        socket.write(JSON.stringify(request) + "\n");
      } catch (error) {
        fail(error);
      }
    });

    socket.on("data", (chunk: string) => {
      buffer += chunk;

      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;

      const line = buffer.slice(0, newlineIndex).trim();
      if (!line) {
        fail(new Error("empty embedder daemon response"));
        return;
      }

      try {
        const response = JSON.parse(line) as EmbedderDaemonResponse;
        if (response.error) {
          fail(new Error(response.error));
          return;
        }

        const vectors = normalizeDaemonResponse(response);
        if (!vectors || vectors.length === 0) {
          fail(new Error("invalid embedder daemon response"));
          return;
        }

        succeed(vectors);
      } catch (error) {
        fail(error);
      }
    });

    socket.on("error", () => {
      fail(null);
    });

    socket.on("close", () => {
      if (!settled) {
        fail(null);
      }
    });
  });
}

function normalizeDaemonResponse(response: EmbedderDaemonResponse): Float32Array[] | null {
  if (Array.isArray(response.embeddings)) {
    const vectors = response.embeddings
      .map((entry) => normalizeVectorEntry(entry))
      .filter((vector): vector is Float32Array => vector !== null);
    return vectors.length > 0 ? vectors : null;
  }

  const singleVector = normalizeVectorEntry(response.embedding);
  return singleVector ? [singleVector] : null;
}

function normalizeVectorEntry(value: unknown): Float32Array | null {
  if (!Array.isArray(value)) return null;
  const vector = new Float32Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const entry = Number(value[i]);
    if (!Number.isFinite(entry)) return null;
    vector[i] = entry;
  }
  return normalizeVector(vector);
}

function normalizeVector(vector: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vector.length; i++) {
    norm += vector[i] * vector[i];
  }

  if (norm <= 1e-12) return vector;

  const scale = 1 / Math.sqrt(norm);
  for (let i = 0; i < vector.length; i++) {
    vector[i] *= scale;
  }
  return vector;
}

function averageVectors(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 0) {
    throw new Error("Cannot average empty vectors");
  }

  const result = new Float32Array(vectors[0].length);
  for (const vector of vectors) {
    if (vector.length !== result.length) {
      throw new Error("Vectors have different lengths");
    }
    for (let i = 0; i < vector.length; i++) {
      result[i] += vector[i];
    }
  }

  const scale = 1 / vectors.length;
  for (let i = 0; i < result.length; i++) {
    result[i] *= scale;
  }

  return normalizeVector(result);
}

function randomRequestId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
