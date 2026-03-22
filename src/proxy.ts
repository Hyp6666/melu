/**
 * Melu 代理服务。
 *
 * 原生 Node.js HTTP 服务器，拦截 Anthropic Messages API 请求，
 * 注入记忆后转发给真实 API，SSE streaming 逐 chunk 透传。
 */

import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig, getMemoryPath, type MeluConfig } from "./config.js";
import { embedLongTextViaDaemon } from "./embedder-daemon-client.js";
import { enqueuePendingExtractionJob } from "./extraction-queue.js";
import { MemoryStore, formatMemoriesForInjection } from "./memory.js";
import {
  applyMeluRuntimeContextEnv,
  getMeluRuntimeContext,
  type MeluRuntimeContext,
} from "./runtime-context.js";

let store: MemoryStore | null = null;
let config: MeluConfig;
let activeMemoryPath: string | null = null;
let runtimeContext: MeluRuntimeContext | null = null;
let didLogEmbedderFallback = false;
/** 本次 run 已入队的 userText 哈希集合，防止同一条消息被重复提取 */
const enqueuedTextHashes = new Set<string>();

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// ── 辅助函数 ─────────────────────────────────────────────────────────

function buildUpstreamHeaders(req: IncomingMessage): Record<string, string> {
  const forwardKeys = [
    "authorization", "x-api-key", "content-type",
    "anthropic-version", "anthropic-beta",
    "anthropic-dangerous-direct-browser-access",
    "user-agent", "x-app",
  ];
  const headers: Record<string, string> = {};
  for (const key of forwardKeys) {
    const val = req.headers[key];
    if (val) headers[key] = Array.isArray(val) ? val[0] : val;
  }
  return headers;
}

// 无需 ExtractionContext，提取由 CLI 层面的 claude -p 完成

/**
 * 从 user message 中剥离系统注入的标签内容（如 <system-reminder>、<available-deferred-tools> 等），
 * 只保留用户真正输入的文本。
 */
function stripSystemTags(text: string): string {
  // 移除所有 <tag-name>...</tag-name> 形式的系统注入块
  const cleaned = text.replace(/<(system-reminder|available-deferred-tools|local-command-caveat|command-name|command-message|command-args|local-command-stdout|task-notification|antml:[a-z_]+)[^>]*>[\s\S]*?<\/\1>/gi, "");
  // 也移除自闭合的 <tag /> 形式
  return cleaned.replace(/<(system-reminder|available-deferred-tools)[^>]*\/>/gi, "").trim();
}

/**
 * 判断一个 user message 是否只包含 tool_result 块（即不含真正的用户输入）。
 * Claude Code 在 assistant tool_use 之后会发送 role=user 的 tool_result 消息，
 * 这些不是用户真正说的话，不应被提取记忆。
 */
function isToolResultOnly(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  if (content.length === 0) return false;
  return content.every(
    (block) =>
      typeof block === "object" &&
      block !== null &&
      "type" in block &&
      (block as Record<string, unknown>).type === "tool_result",
  );
}

function extractUserText(messages: Array<{ role: string; content: unknown }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    // 跳过纯 tool_result 消息（不是用户真正的输入）
    if (isToolResultOnly(msg.content)) continue;
    if (typeof msg.content === "string") return stripSystemTags(msg.content);
    if (Array.isArray(msg.content)) {
      const parts: string[] = [];
      for (const block of msg.content) {
        if (typeof block === "object" && block && "type" in block && block.type === "text" && "text" in block) {
          parts.push(block.text as string);
        }
      }
      return stripSystemTags(parts.join("\n"));
    }
  }
  return "";
}

function injectMemoriesIntoBody(body: Record<string, unknown>, memoryText: string): void {
  if (!memoryText) return;
  const existing = body.system;
  if (typeof existing === "string") {
    body.system = existing + memoryText;
  } else if (Array.isArray(existing)) {
    (existing as unknown[]).push({ type: "text", text: memoryText });
  } else {
    body.system = memoryText;
  }
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

// ── 核心处理 ─────────────────────────────────────────────────────────

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  const query = url.search;
  const upstreamBase = config.upstreamAnthropic;
  const upstreamUrl = `${upstreamBase}${path}${query}`;
  const upstreamHeaders = buildUpstreamHeaders(req);
  console.log(`[Melu:DEBUG] 收到请求: ${req.method} ${path}${query}`);
  console.log(`[Melu:DEBUG] 转发到: ${upstreamUrl}`);
  console.log(`[Melu:DEBUG] Auth header 类型: ${req.headers["authorization"] ? "Bearer/OAuth" : ""} ${req.headers["x-api-key"] ? "API-Key" : ""}`);

  const rawBody = await readBody(req);

  const isMessages = path.includes("messages") && req.method === "POST";
  let bodyDict: Record<string, unknown> | null = null;
  let userText = "";
  let isStreaming = false;

  if (isMessages && rawBody.length > 0) {
    try {
      bodyDict = JSON.parse(rawBody.toString("utf-8"));
      const messages = bodyDict!.messages as Array<{ role: string; content: unknown }>;
      isStreaming = bodyDict!.stream === true;

      userText = extractUserText(messages);
      console.log(`[Melu:DEBUG] userText 长度: ${userText.length}, 前200字: ${userText.slice(0, 200)}`);

      // 检索记忆
      if (store && userText) {
        let queryVector: Float32Array | null = null;

        try {
          queryVector = await embedLongTextViaDaemon(userText, config.embeddingModel, {
            runId: runtimeContext?.runId ?? null,
            socketPath: runtimeContext?.embedderSocketPath ?? null,
            type: "query",
          });
        } catch (e) {
          queryVector = null;
          if (!didLogEmbedderFallback) {
            didLogEmbedderFallback = true;
            console.warn("[Melu] Embedding daemon 不可用，已降级为非向量检索");
          }
          console.warn("[Melu] Query embedding 失败:", e);
        }

        const memories = store.retrieve(queryVector);
        if (memories.length > 0) {
          const memoryText = formatMemoriesForInjection(memories);
          injectMemoriesIntoBody(bodyDict!, memoryText);
          console.log(`[Melu] 注入 ${memories.length} 条记忆`);
        }
      }

      // 重新序列化
      const newBody = JSON.stringify(bodyDict);
      upstreamHeaders["content-length"] = String(Buffer.byteLength(newBody));
      const model = (bodyDict!.model as string) ?? "";
      console.log(`[Melu] 请求模型: ${model || "(empty)"}`);

      const forwarded = isStreaming
        ? await handleStreaming(upstreamUrl, upstreamHeaders, newBody, res)
        : await handleNormal(req.method ?? "POST", upstreamUrl, upstreamHeaders, newBody, res);

      if (forwarded && userText && userText.trim().length > 4) {
        const textHash = hashText(userText);
        if (enqueuedTextHashes.has(textHash)) {
          console.log(`[Melu] 跳过重复 userText (hash=${textHash})`);
        } else {
          try {
            enqueuePendingExtractionJob(userText, activeMemoryPath, runtimeContext?.runId ?? null);
            enqueuedTextHashes.add(textHash);
            console.log(`[Melu] 已记录待提取文本 (${userText.length} 字符)`);
          } catch (e) {
            console.warn("[Melu] 写入待提取队列失败:", e);
          }
        }
      }
      return;
    } catch {
      console.warn("[Melu] 请求体 JSON 解析失败，原样转发");
    }
  }

  // 非 messages 请求或解析失败，原样转发
  await handleNormal(req.method ?? "GET", upstreamUrl, upstreamHeaders, rawBody, res);
}

async function handleNormal(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: Buffer | string,
  res: ServerResponse,
): Promise<boolean> {
  try {
    const resp = await fetch(url, {
      method,
      headers,
      body: method !== "GET" && method !== "HEAD" ? (typeof body === "string" ? body : new Uint8Array(body)) : undefined,
    });

    res.writeHead(resp.status, Object.fromEntries(
      [...resp.headers.entries()].filter(([k]) =>
        !["content-encoding", "transfer-encoding", "content-length"].includes(k.toLowerCase())
      )
    ));

    if (resp.body) {
      const reader = resp.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      };
      await pump();
    } else {
      const buffer = await resp.arrayBuffer();
      res.end(Buffer.from(buffer));
    }
    return resp.ok;
  } catch (e) {
    console.error("[Melu] 转发失败:", e);
    res.writeHead(502);
    res.end("Melu proxy error");
    return false;
  }
}

async function handleStreaming(
  url: string,
  headers: Record<string, string>,
  body: string,
  res: ServerResponse,
): Promise<boolean> {
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body,
    });

    // 透传响应头
    res.writeHead(resp.status, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    });

    if (resp.body) {
      const reader = resp.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }

    res.end();
    return resp.ok;
  } catch (e) {
    console.error("[Melu] Streaming 转发失败:", e);
    if (!res.headersSent) {
      res.writeHead(502);
    }
    res.end("Melu proxy streaming error");
    return false;
  }
}

// ── 启动 ─────────────────────────────────────────────────────────────

export function startProxy(
  memoryName?: string | null,
  runtime?: MeluRuntimeContext,
): Promise<void> {
  config = loadConfig();
  const upstreamOverride = process.env.MELU_UPSTREAM_ANTHROPIC?.trim();
  if (upstreamOverride) {
    config.upstreamAnthropic = upstreamOverride;
  }
  runtimeContext = runtime ?? getMeluRuntimeContext();
  applyMeluRuntimeContextEnv(runtimeContext);
  const memPath = getMemoryPath(memoryName ?? config.defaultMemory);
  activeMemoryPath = memPath;
  didLogEmbedderFallback = false;

  store = new MemoryStore(memPath);
  store.open();
  console.log(`[Melu] 记忆文件: ${memPath}`);
  console.log(`[Melu] 记忆条数: ${store.countActive()}`);

  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      handleRequest(req, res).catch((e) => {
        console.error("[Melu] 请求处理失败:", e);
        if (!res.headersSent) res.writeHead(500);
        res.end("Internal proxy error");
      });
    });

    server.listen(config.port, "127.0.0.1", () => {
      console.log(`[Melu] 代理服务运行在 http://127.0.0.1:${config.port}`);
      resolve();
    });

    // 优雅退出
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log("\n[Melu] 正在关闭...");
      store?.close();
      store = null;
      activeMemoryPath = null;
      runtimeContext = null;
      server.close(() => {
        console.log("[Melu] 已完全退出");
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 3000);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
