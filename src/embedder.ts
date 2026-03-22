/**
 * Melu Embedding 封装。
 *
 * 使用 node-llama-cpp 加载 GGUF embedding 模型，
 * 运行时使用预编译 llama.cpp binary，不要求用户自行安装系统编译依赖。
 */

import {
  getLlama,
  LlamaLogLevel,
  type Llama,
  type LlamaEmbeddingContext,
  type LlamaModel,
} from "node-llama-cpp";
import { createConnection } from "node:net";

import { loadConfig } from "./config.js";
import { ensureEmbeddingModelReady } from "./model-bootstrap.js";
import { splitTextIntoOverlappingWindows } from "./text-chunking.js";

// 英文 instruction 前缀，跨语言效果最优
const DEFAULT_INSTRUCTION = "Instruct: Retrieve semantically similar memories for the user\nQuery: ";
const EMBEDDER_SOCKET_ENV = "MELU_EMBEDDER_SOCKET";
const RUN_ID_ENV = "MELU_RUN_ID";
const REMOTE_EMBEDDER_TIMEOUT_MS = 10000;

type EmbeddingPurpose = "query" | "memory";

interface LoadedEmbedder {
  llama: Llama;
  model: LlamaModel;
  embeddingContext: LlamaEmbeddingContext;
}

let _embedder: LoadedEmbedder | null = null;
let _loading: Promise<LoadedEmbedder> | null = null;

/**
 * 获取或初始化 embedding backend（单例，懒加载）。
 */
export async function getEmbedder(modelId: string): Promise<LoadedEmbedder> {
  if (_embedder) return _embedder;

  if (_loading) return _loading;

  _loading = (async () => {
    const config = loadConfig();
    const { modelPath } = await ensureEmbeddingModelReady({
      config,
      interactive: false,
      showProgress: false,
    });

    console.log(`[Melu] 加载 GGUF embedding 模型: ${modelId}`);
    console.log(`[Melu] 模型文件: ${modelPath}`);

    const llama = await getLlama({
      build: "never",
      gpu: "auto",
      logLevel: LlamaLogLevel.warn,
      progressLogs: false,
    });

    const model = await llama.loadModel({
      gpuLayers: "auto",
      modelPath,
      useMmap: true,
    });

    // 切块 2000 字符，纯中文最坏 ≈ 1400 tokens，3072 留足余量
    const embeddingContext = await model.createEmbeddingContext({
      contextSize: 3072,
    });

    _embedder = {
      llama,
      model,
      embeddingContext,
    };

    console.log("[Melu] Embedding 模型就绪");
    return _embedder;
  })();

  return _loading;
}

/**
 * 对单条文本生成 embedding 向量。
 */
export async function embed(
  text: string,
  modelId: string,
  options: { purpose?: EmbeddingPurpose } = {},
): Promise<Float32Array> {
  const purpose = options.purpose ?? "query";

  if (shouldUseRemoteEmbedder()) {
    const vectors = await requestRemoteEmbeddings([text], purpose);
    return vectors[0];
  }

  const { embeddingContext } = await getEmbedder(modelId);
  const inputText = DEFAULT_INSTRUCTION + text;
  const output = await embeddingContext.getEmbeddingFor(inputText);
  return normalizeVector(new Float32Array(output.vector));
}

/**
 * 对长文本分块后做 embedding，并对所有 chunk 向量取平均。
 */
export async function embedLongText(
  text: string,
  modelId: string,
  options: { purpose?: EmbeddingPurpose } = {},
): Promise<Float32Array> {
  const chunks = splitTextIntoOverlappingWindows(text);
  if (chunks.length === 0) {
    throw new Error("Cannot embed empty text");
  }

  if (chunks.length === 1) {
    return embed(chunks[0], modelId, options);
  }

  const vectors = await embedBatch(chunks, modelId, options);
  return averageVectors(vectors);
}

/**
 * 批量 embedding。
 */
export async function embedBatch(
  texts: string[],
  modelId: string,
  options: { purpose?: EmbeddingPurpose } = {},
): Promise<Float32Array[]> {
  const purpose = options.purpose ?? "query";

  if (shouldUseRemoteEmbedder()) {
    return requestRemoteEmbeddings(texts, purpose);
  }

  const results: Float32Array[] = [];
  for (const text of texts) {
    results.push(await embed(text, modelId, options));
  }
  return results;
}

/**
 * 释放模型，回收内存。
 */
export async function disposeEmbedder(): Promise<void> {
  if (_embedder) {
    await _embedder.embeddingContext.dispose();
    await _embedder.model.dispose();
    await _embedder.llama.dispose();
    _embedder = null;
  }

  _loading = null;
}

function normalizeVector(vector: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vector.length; i++) {
    norm += vector[i] * vector[i];
  }

  if (norm <= 1e-12) {
    return vector;
  }

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

function shouldUseRemoteEmbedder(): boolean {
  return Boolean(process.env[EMBEDDER_SOCKET_ENV]?.trim());
}

async function requestRemoteEmbeddings(texts: string[], purpose: EmbeddingPurpose): Promise<Float32Array[]> {
  const socketPath = process.env[EMBEDDER_SOCKET_ENV]?.trim();
  if (!socketPath) {
    throw new Error("Remote embedder socket is not configured");
  }

  if (texts.length === 0) {
    return [];
  }

  const response = await sendRemoteEmbeddingRequest({
    id: `embed-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    run_id: process.env[RUN_ID_ENV]?.trim() || "legacy",
    type: purpose,
    texts,
  }, socketPath);

  const embeddings = response.embeddings;
  if (!Array.isArray(embeddings)) {
    throw new Error("Remote embedder returned no embeddings");
  }

  if (embeddings.length !== texts.length) {
    throw new Error("Remote embedder returned mismatched embedding count");
  }

  return embeddings.map((vector) => normalizeVector(new Float32Array(vector)));
}

interface RemoteEmbeddingRequest {
  id: string;
  run_id: string;
  type: EmbeddingPurpose | "ping" | "shutdown";
  texts: string[];
}

interface RemoteEmbeddingResponse {
  id?: string;
  run_id?: string;
  type?: string;
  embeddings?: number[][];
  error?: string;
  latency_ms?: number;
}

function sendRemoteEmbeddingRequest(
  request: RemoteEmbeddingRequest,
  socketPath: string,
): Promise<RemoteEmbeddingResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = "";
    let settled = false;

    const finish = (error?: Error, response?: RemoteEmbeddingResponse) => {
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
      finish(new Error(`Remote embedder timed out after ${REMOTE_EMBEDDER_TIMEOUT_MS}ms`));
    }, REMOTE_EMBEDDER_TIMEOUT_MS);

    socket.setEncoding("utf-8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;

      const line = buffer.slice(0, newlineIndex).trim();
      if (!line) {
        finish(new Error("Remote embedder returned an empty response"));
        return;
      }

      try {
        const parsed = JSON.parse(line) as RemoteEmbeddingResponse;
        if (parsed.error) {
          finish(new Error(parsed.error));
          return;
        }
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
        finish(new Error("Remote embedder closed before responding"));
      }
    });
  });
}
