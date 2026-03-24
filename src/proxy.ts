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
import {
  appendProxyTraceEvent,
  buildProxyTraceDashboardHtml,
  readProxyTraceEvents,
  type TraceDashboardLanguage,
  type ProxyTracePromptMessage,
  type ProxyTracePromptSnapshot,
  type ProxyTraceToolCall,
} from "./trace.js";

let store: MemoryStore | null = null;
let config: MeluConfig;
let activeMemoryPath: string | null = null;
let runtimeContext: MeluRuntimeContext | null = null;
let didLogEmbedderFallback = false;
let traceSequence = 0;
/** 本次 run 已入队的 userText 哈希集合，防止同一条消息被重复提取 */
const enqueuedTextHashes = new Set<string>();

interface ProxyTraceRequestContext {
  seq: number;
  requestId: string;
  startedAt: number;
  method: string;
  path: string;
  stream: boolean;
  model: string | null;
  requestBytes: number;
}

interface ResponseUsageSummary {
  inputTokens?: number;
  outputTokens?: number;
}

interface StreamingToolAccumulator {
  id: string | null;
  name: string;
  kind: string;
  inputBuffer: string;
  inputValue: unknown;
}

const MAX_TRACE_RAW_REQUEST_CHARS = 200_000;

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

function stringifyTraceRequestBody(body: Record<string, unknown>): { rawRequestBody: string; rawRequestTruncated: boolean } {
  const raw = JSON.stringify(body, null, 2);
  if (raw.length <= MAX_TRACE_RAW_REQUEST_CHARS) {
    return { rawRequestBody: raw, rawRequestTruncated: false };
  }
  return {
    rawRequestBody:
      raw.slice(0, MAX_TRACE_RAW_REQUEST_CHARS) +
      "\n/* melu trace truncated the raw request body for local dashboard rendering */",
    rawRequestTruncated: true,
  };
}

function snapshotSystemBlocks(system: unknown): ProxyTracePromptSnapshot["systemBlocks"] {
  if (typeof system === "string") {
    return [{ index: 0, type: "text", text: system }];
  }

  if (!Array.isArray(system)) {
    return [];
  }

  return system.map((block, index) => {
    if (typeof block === "string") {
      return { index, type: "text", text: block };
    }

    if (block && typeof block === "object") {
      const record = block as Record<string, unknown>;
      if (typeof record.text === "string") {
        return {
          index,
          type: typeof record.type === "string" ? record.type : "text",
          text: record.text,
        };
      }
      return {
        index,
        type: typeof record.type === "string" ? record.type : "object",
        text: JSON.stringify(record, null, 2),
      };
    }

    return { index, type: typeof block, text: String(block) };
  });
}

function snapshotPromptMessages(messages: unknown): ProxyTracePromptMessage[] {
  if (!Array.isArray(messages)) return [];

  return messages.map((message, index) => {
    if (!message || typeof message !== "object") {
      return {
        index,
        role: "unknown",
        contentTypes: [],
        text: "",
        toolResultOnly: false,
      };
    }

    const record = message as Record<string, unknown>;
    const role = typeof record.role === "string" ? record.role : "unknown";
    const content = record.content;

    if (typeof content === "string") {
      return {
        index,
        role,
        contentTypes: ["text"],
        text: content,
        toolResultOnly: false,
      };
    }

    if (!Array.isArray(content)) {
      return {
        index,
        role,
        contentTypes: [],
        text: "",
        toolResultOnly: false,
      };
    }

    const contentTypes: string[] = [];
    const textParts: string[] = [];

    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const blockRecord = block as Record<string, unknown>;
      const blockType = typeof blockRecord.type === "string" ? blockRecord.type : "unknown";
      contentTypes.push(blockType);
      if (blockType === "text" && typeof blockRecord.text === "string") {
        textParts.push(blockRecord.text);
      }
    }

    return {
      index,
      role,
      contentTypes,
      text: textParts.join("\n"),
      toolResultOnly: isToolResultOnly(content),
    };
  });
}

function buildPromptSnapshot(body: Record<string, unknown>): ProxyTracePromptSnapshot {
  const raw = stringifyTraceRequestBody(body);
  return {
    systemBlocks: snapshotSystemBlocks(body.system),
    messages: snapshotPromptMessages(body.messages),
    rawRequestBody: raw.rawRequestBody,
    rawRequestTruncated: raw.rawRequestTruncated,
  };
}

function extractToolCallsFromContentBlocks(content: unknown): ProxyTraceToolCall[] {
  if (!Array.isArray(content)) return [];

  const toolCalls: ProxyTraceToolCall[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    const blockType = typeof record.type === "string" ? record.type : "";
    if (blockType !== "tool_use" && blockType !== "server_tool_use") continue;
    if (typeof record.name !== "string" || record.name.trim() === "") continue;

    toolCalls.push({
      id: typeof record.id === "string" ? record.id : null,
      name: record.name,
      kind: blockType,
      input: "input" in record ? record.input : undefined,
    });
  }

  return toolCalls;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function getTraceRunId(): string | null {
  return runtimeContext?.runId ?? null;
}

function createTraceContext(method: string, path: string, requestBytes: number): ProxyTraceRequestContext {
  const seq = ++traceSequence;
  const runId = getTraceRunId() ?? "legacy";
  return {
    seq,
    requestId: `${runId}-${seq}`,
    startedAt: Date.now(),
    method,
    path,
    stream: false,
    model: null,
    requestBytes,
  };
}

function recordTraceEvent(
  ctx: ProxyTraceRequestContext,
  type: "upload" | "receive_start" | "receive_end" | "receive_error",
  extra: Partial<{
    status: number;
    responseBytes: number;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    note: string;
    promptSnapshot: ProxyTracePromptSnapshot;
    toolCalls: ProxyTraceToolCall[];
  }> = {},
): void {
  const runId = getTraceRunId();
  if (!runId) return;

  appendProxyTraceEvent(runId, {
    seq: ctx.seq,
    requestId: ctx.requestId,
    type,
    timestamp: new Date().toISOString(),
    method: ctx.method,
    path: ctx.path,
    stream: ctx.stream,
    model: ctx.model,
    requestBytes: ctx.requestBytes,
    ...extra,
  });
}

function readUsageObject(value: unknown): ResponseUsageSummary {
  if (!value || typeof value !== "object") return {};
  const usage = value as Record<string, unknown>;
  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
  return { inputTokens, outputTokens };
}

function mergeUsage(target: ResponseUsageSummary, next: ResponseUsageSummary): void {
  if (typeof next.inputTokens === "number") target.inputTokens = next.inputTokens;
  if (typeof next.outputTokens === "number") target.outputTokens = next.outputTokens;
}

function extractUsageFromMessageJson(payload: unknown): ResponseUsageSummary {
  if (!payload || typeof payload !== "object") return {};
  const record = payload as Record<string, unknown>;
  if ("usage" in record) {
    return readUsageObject(record.usage);
  }
  return {};
}

function extractToolCallsFromMessageJson(payload: unknown): ProxyTraceToolCall[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  return extractToolCallsFromContentBlocks(record.content);
}

function applyUsageFromSsePayload(target: ResponseUsageSummary, payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const record = payload as Record<string, unknown>;

  if ("usage" in record) {
    mergeUsage(target, readUsageObject(record.usage));
  }

  if (record.type === "message_start" && record.message && typeof record.message === "object") {
    const message = record.message as Record<string, unknown>;
    if ("usage" in message) {
      mergeUsage(target, readUsageObject(message.usage));
    }
  }

  if (record.delta && typeof record.delta === "object") {
    const delta = record.delta as Record<string, unknown>;
    if ("usage" in delta) {
      mergeUsage(target, readUsageObject(delta.usage));
    }
  }
}

function maybeParseJson(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function appendStreamingToolCalls(target: ProxyTraceToolCall[], toolsByIndex: Map<number, StreamingToolAccumulator>): void {
  for (const [, tool] of toolsByIndex) {
    target.push({
      id: tool.id,
      name: tool.name,
      kind: tool.kind,
      input: tool.inputBuffer.trim() ? maybeParseJson(tool.inputBuffer) : tool.inputValue,
    });
  }
}

function applyToolDataFromSsePayload(
  toolsByIndex: Map<number, StreamingToolAccumulator>,
  completedTools: ProxyTraceToolCall[],
  payload: unknown,
): void {
  if (!payload || typeof payload !== "object") return;
  const record = payload as Record<string, unknown>;
  const index = typeof record.index === "number" ? record.index : null;
  if (index === null) return;

  if (record.type === "content_block_start" && record.content_block && typeof record.content_block === "object") {
    const block = record.content_block as Record<string, unknown>;
    const blockType = typeof block.type === "string" ? block.type : "";
    if (blockType !== "tool_use" && blockType !== "server_tool_use") return;
    toolsByIndex.set(index, {
      id: typeof block.id === "string" ? block.id : null,
      name: typeof block.name === "string" ? block.name : "(unknown tool)",
      kind: blockType,
      inputBuffer:
        block.input && typeof block.input === "object" && Object.keys(block.input as Record<string, unknown>).length > 0
          ? JSON.stringify(block.input)
          : "",
      inputValue: "input" in block ? block.input : undefined,
    });
    return;
  }

  if (record.type === "content_block_delta" && record.delta && typeof record.delta === "object") {
    const delta = record.delta as Record<string, unknown>;
    if (delta.type !== "input_json_delta") return;
    const tool = toolsByIndex.get(index);
    if (!tool) return;
    if (typeof delta.partial_json === "string") {
      tool.inputBuffer += delta.partial_json;
    }
    return;
  }

  if (record.type === "content_block_stop") {
    const tool = toolsByIndex.get(index);
    if (!tool) return;
    completedTools.push({
      id: tool.id,
      name: tool.name,
      kind: tool.kind,
      input: tool.inputBuffer.trim() ? maybeParseJson(tool.inputBuffer) : tool.inputValue,
    });
    toolsByIndex.delete(index);
  }
}

function consumeSseMetadata(
  buffer: string,
  usage: ResponseUsageSummary,
  toolsByIndex?: Map<number, StreamingToolAccumulator>,
  completedTools?: ProxyTraceToolCall[],
): string {
  let remaining = buffer;
  while (true) {
    const boundary = remaining.indexOf("\n\n");
    if (boundary === -1) break;
    const rawEvent = remaining.slice(0, boundary);
    remaining = remaining.slice(boundary + 2);

    const dataLines = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (!dataLines.length) continue;
    const dataText = dataLines.join("\n");
    if (dataText === "[DONE]") continue;

    try {
      const payload = JSON.parse(dataText);
      applyUsageFromSsePayload(usage, payload);
      if (toolsByIndex && completedTools) {
        applyToolDataFromSsePayload(toolsByIndex, completedTools, payload);
      }
    } catch {
      // ignore non-JSON SSE payloads
    }
  }
  return remaining;
}

function writeJsonResponse(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function getTraceDashboardLanguage(): TraceDashboardLanguage {
  return config.uiLanguage === "zh-CN" || config.uiLanguage === "zh-TW" ? "zh-CN" : "en";
}

// ── 核心处理 ─────────────────────────────────────────────────────────

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  const query = url.search;

  if (req.method === "GET" && (path === "/__melu" || path === "/__melu/")) {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(buildProxyTraceDashboardHtml(getTraceRunId() ?? "legacy", getTraceDashboardLanguage()));
    return;
  }

  if (req.method === "GET" && path === "/__melu/events") {
    writeJsonResponse(res, 200, {
      runId: getTraceRunId() ?? "legacy",
      generatedAt: new Date().toISOString(),
      events: readProxyTraceEvents(getTraceRunId() ?? "legacy"),
    });
    return;
  }

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
  let uploadRecorded = false;
  const traceContext = isMessages ? createTraceContext(req.method ?? "POST", path, rawBody.length) : null;

  if (isMessages && rawBody.length > 0) {
    try {
      bodyDict = JSON.parse(rawBody.toString("utf-8"));
      isStreaming = bodyDict!.stream === true;
      if (traceContext) {
        traceContext.stream = isStreaming;
        traceContext.model = typeof bodyDict!.model === "string" ? bodyDict!.model : null;
      }

      const messages = bodyDict!.messages as Array<{ role: string; content: unknown }>;
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
      const promptSnapshot = buildPromptSnapshot(bodyDict!);
      if (traceContext) {
        recordTraceEvent(traceContext, "upload", { promptSnapshot });
        uploadRecorded = true;
      }
      const newBody = JSON.stringify(bodyDict);
      upstreamHeaders["content-length"] = String(Buffer.byteLength(newBody));
      const model = (bodyDict!.model as string) ?? "";
      console.log(`[Melu] 请求模型: ${model || "(empty)"}`);

      const forwarded = isStreaming
        ? await handleStreaming(upstreamUrl, upstreamHeaders, newBody, res, traceContext)
        : await handleNormal(req.method ?? "POST", upstreamUrl, upstreamHeaders, newBody, res, traceContext);

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

  if (traceContext && !uploadRecorded) {
    recordTraceEvent(traceContext, "upload");
  }

  // 非 messages 请求或解析失败，原样转发
  await handleNormal(req.method ?? "GET", upstreamUrl, upstreamHeaders, rawBody, res, traceContext);
}

async function handleNormal(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: Buffer | string,
  res: ServerResponse,
  traceContext?: ProxyTraceRequestContext | null,
): Promise<boolean> {
  try {
    const resp = await fetch(url, {
      method,
      headers,
      body: method !== "GET" && method !== "HEAD" ? (typeof body === "string" ? body : new Uint8Array(body)) : undefined,
    });
    if (traceContext) {
      recordTraceEvent(traceContext, "receive_start", { status: resp.status });
    }

    res.writeHead(resp.status, Object.fromEntries(
      [...resp.headers.entries()].filter(([k]) =>
        !["content-encoding", "transfer-encoding", "content-length"].includes(k.toLowerCase())
      )
    ));

    let responseBytes = 0;
    let usage: ResponseUsageSummary = {};
    let toolCalls: ProxyTraceToolCall[] = [];
    const contentType = resp.headers.get("content-type")?.toLowerCase() ?? "";

    if (traceContext && contentType.includes("application/json")) {
      const buffer = Buffer.from(await resp.arrayBuffer());
      responseBytes = buffer.byteLength;
      try {
        const payload = JSON.parse(buffer.toString("utf-8"));
        usage = extractUsageFromMessageJson(payload);
        toolCalls = extractToolCallsFromMessageJson(payload);
      } catch {
        usage = {};
        toolCalls = [];
      }
      res.end(buffer);
    } else if (resp.body) {
      const reader = resp.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          responseBytes += value.byteLength;
          res.write(value);
        }
        res.end();
      };
      await pump();
    } else {
      const buffer = await resp.arrayBuffer();
      responseBytes = buffer.byteLength;
      res.end(Buffer.from(buffer));
    }
    if (traceContext) {
      recordTraceEvent(traceContext, "receive_end", {
        status: resp.status,
        responseBytes,
        durationMs: Date.now() - traceContext.startedAt,
        ...usage,
        ...(toolCalls.length ? { toolCalls } : {}),
      });
    }
    return resp.ok;
  } catch (e) {
    console.error("[Melu] 转发失败:", e);
    if (traceContext) {
      recordTraceEvent(traceContext, "receive_error", {
        durationMs: Date.now() - traceContext.startedAt,
        note: e instanceof Error ? e.message : String(e),
      });
    }
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
  traceContext?: ProxyTraceRequestContext | null,
): Promise<boolean> {
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body,
    });
    if (traceContext) {
      recordTraceEvent(traceContext, "receive_start", { status: resp.status });
    }

    // 透传响应头
    res.writeHead(resp.status, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    });

    let responseBytes = 0;
    const usage: ResponseUsageSummary = {};
    const toolCalls: ProxyTraceToolCall[] = [];
    const toolsByIndex = new Map<number, StreamingToolAccumulator>();
    if (resp.body) {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        responseBytes += value.byteLength;
        sseBuffer += decoder.decode(value, { stream: true });
        sseBuffer = consumeSseMetadata(sseBuffer, usage, toolsByIndex, toolCalls);
        res.write(value);
      }
      sseBuffer += decoder.decode();
      consumeSseMetadata(sseBuffer, usage, toolsByIndex, toolCalls);
      appendStreamingToolCalls(toolCalls, toolsByIndex);
    }

    res.end();
    if (traceContext) {
      recordTraceEvent(traceContext, "receive_end", {
        status: resp.status,
        responseBytes,
        durationMs: Date.now() - traceContext.startedAt,
        ...usage,
        ...(toolCalls.length ? { toolCalls } : {}),
      });
    }
    return resp.ok;
  } catch (e) {
    console.error("[Melu] Streaming 转发失败:", e);
    if (traceContext) {
      recordTraceEvent(traceContext, "receive_error", {
        durationMs: Date.now() - traceContext.startedAt,
        note: e instanceof Error ? e.message : String(e),
      });
    }
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
  traceSequence = 0;

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
