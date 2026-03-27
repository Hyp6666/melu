/**
 * Melu 代理服务。
 *
 * 原生 Node.js HTTP 服务器，拦截 Anthropic Messages API 请求，
 * 注入记忆后转发给真实 API，SSE streaming 逐 chunk 透传。
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  EMBEDDING_MODEL_SOURCES,
  UI_LANGUAGES,
  getMemoryPath,
  hasEmbeddingModel,
  isMirrorName,
  isUiLanguage,
  loadConfig,
  saveConfig,
  type MeluConfig,
} from "./config.js";
import { embedLongTextViaDaemon } from "./embedder-daemon-client.js";
import { enqueuePendingExtractionJob } from "./extraction-queue.js";
import { getLocalizedMirrorLabel, getUiLanguageLabel } from "./i18n.js";
import { MemoryStore, formatMemoriesForInjection } from "./memory.js";
import { ensureEmbeddingModelReady, ensureEmbeddingRuntimeAvailable } from "./model-bootstrap.js";
import {
  applyMeluRuntimeContextEnv,
  getMeluRuntimeContext,
  type MeluRuntimeContext,
} from "./runtime-context.js";
import {
  appendProxyTraceEvent,
  buildProxyTraceDashboardHtml,
  getTraceEventsPath,
  readProxyTraceEvents,
  type TraceDashboardLanguage,
  type ProxyTracePromptMessage,
  type ProxyTracePromptSnapshot,
  type ProxyTraceResponseBlock,
  type ProxyTraceResponseSnapshot,
  type ProxyTraceToolCall,
} from "./trace.js";

let store: MemoryStore | null = null;
let config: MeluConfig;
let activeMemoryPath: string | null = null;
let runtimeContext: MeluRuntimeContext | null = null;
let didLogEmbedderFallback = false;
let traceSequence = 0;
let traceTurnSequence = 0;
type ProxyTraceRequestKind = "probe" | "topic_analysis" | "suggestion_mode" | "continuation" | "user_turn";

let activeTraceTurn: {
  id: string;
  seq: number;
  preview: string;
  userText: string;
  userTextHash: string;
  pendingStarter: boolean;
  lastRequestKind: ProxyTraceRequestKind;
} | null = null;
/** 本次 run 已入队的 userText 哈希集合，防止同一条消息被重复提取 */
const enqueuedTextHashes = new Set<string>();

interface ProxyTraceRequestContext {
  seq: number;
  requestId: string;
  requestKind: ProxyTraceRequestKind;
  turnId: string | null;
  turnSeq: number | null;
  turnPreview: string | null;
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
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

interface StreamingToolAccumulator {
  id: string | null;
  name: string;
  kind: string;
  inputBuffer: string;
  inputValue: unknown;
}

interface StreamingResponseBlockAccumulator {
  type: string;
  textBuffer: string;
  id: string | null;
  name: string | null;
}

interface StreamingResponseAccumulator {
  role: string;
  stopReason: string | null;
  blocksByIndex: Map<number, StreamingResponseBlockAccumulator>;
}

interface LatestUserMessageInfo {
  text: string;
  index: number | null;
  previousText: string;
  hasLaterMessages: boolean;
}

interface TraceRequestClassification {
  kind: ProxyTraceRequestKind;
  turnText: string;
  skipMemoryInjection: boolean;
  skipExtraction: boolean;
}

const MAX_TRACE_RAW_REQUEST_CHARS = 200_000;
const MAX_TRACE_RESPONSE_TEXT_CHARS = 80_000;

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function buildTurnPreview(text: string): string {
  const preview = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? text.trim();

  if (preview.length <= 96) return preview;
  return `${preview.slice(0, 96)}…`;
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return stripSystemTags(content);
  }
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "object" && block && "type" in block && block.type === "text" && "text" in block) {
      parts.push(String((block as Record<string, unknown>).text ?? ""));
    }
  }
  return stripSystemTags(parts.join("\n"));
}

function isCommandTranscriptText(text: string): boolean {
  const normalized = text.trim();
  return normalized.startsWith("Command: ") && normalized.includes("\nOutput:");
}

function isPolicySpecText(text: string): boolean {
  const normalized = text.trim();
  return normalized.startsWith("<policy_spec>")
    && normalized.includes("The user has allowed certain command prefixes")
    && normalized.includes("ONLY return the prefix.");
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

function extractLatestUserMessageInfo(messages: Array<{ role: string; content: unknown }>): LatestUserMessageInfo {
  const realUserMessages: Array<{ text: string; index: number }> = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    if (isToolResultOnly(msg.content)) continue;
    const text = extractMessageText(msg.content);
    if (!text.trim()) continue;
    realUserMessages.push({ text, index: i });
  }

  if (!realUserMessages.length) {
    return { text: "", index: null, previousText: "", hasLaterMessages: false };
  }

  const latest = realUserMessages[realUserMessages.length - 1];
  const previous = realUserMessages.length > 1 ? realUserMessages[realUserMessages.length - 2].text : "";
  return {
    text: latest.text,
    index: latest.index,
    previousText: previous,
    hasLaterMessages: latest.index < messages.length - 1,
  };
}

function extractUserText(messages: Array<{ role: string; content: unknown }>): string {
  return extractLatestUserMessageInfo(messages).text;
}

function flattenSystemText(system: unknown): string {
  if (typeof system === "string") return system;
  if (!Array.isArray(system)) return "";

  return system
    .map((block) => {
      if (typeof block === "string") return block;
      if (!block || typeof block !== "object") return "";
      const record = block as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function isQuotaProbeRequest(body: Record<string, unknown>, latestUserMessage: LatestUserMessageInfo): boolean {
  const maxTokens = typeof body.max_tokens === "number" ? body.max_tokens : null;
  return maxTokens === 1 && latestUserMessage.text.trim().toLowerCase() === "quota";
}

function isTopicAnalysisRequest(body: Record<string, unknown>): boolean {
  const systemText = flattenSystemText(body.system);
  return systemText.includes("Analyze if this message indicates a new conversation topic.");
}

function isWindowsSessionTitleRequest(body: Record<string, unknown>): boolean {
  if (process.platform !== "win32") {
    return false;
  }

  const systemText = flattenSystemText(body.system);
  return systemText.includes("Generate a concise, sentence-case title (3-7 words) that captures the main topic or goal of this coding session.")
    && systemText.includes("Return JSON with a single \"title\" field.");
}

function classifyTraceRequest(
  body: Record<string, unknown>,
  latestUserMessage: LatestUserMessageInfo,
): TraceRequestClassification {
  const latestText = latestUserMessage.text.trim();
  const previousText = latestUserMessage.previousText.trim();
  const activeTurnText = activeTraceTurn?.userText?.trim() ?? "";

  if (!latestText) {
    return {
      kind: "user_turn",
      turnText: "",
      skipMemoryInjection: false,
      skipExtraction: false,
    };
  }

  if (isQuotaProbeRequest(body, latestUserMessage)) {
    return {
      kind: "probe",
      turnText: "",
      skipMemoryInjection: true,
      skipExtraction: true,
    };
  }

  if (isWindowsSessionTitleRequest(body)) {
    return {
      kind: "probe",
      turnText: "",
      skipMemoryInjection: true,
      skipExtraction: true,
    };
  }

  if (latestText.startsWith("[SUGGESTION MODE:")) {
    return {
      kind: "suggestion_mode",
      turnText: previousText || activeTurnText,
      skipMemoryInjection: false,
      skipExtraction: true,
    };
  }

  if (isPolicySpecText(latestText)) {
    return {
      kind: "continuation",
      turnText: previousText || activeTurnText,
      skipMemoryInjection: true,
      skipExtraction: true,
    };
  }

  if (isCommandTranscriptText(latestText)) {
    return {
      kind: "continuation",
      turnText: previousText || activeTurnText,
      skipMemoryInjection: false,
      skipExtraction: true,
    };
  }

  if (isTopicAnalysisRequest(body)) {
    return {
      kind: "topic_analysis",
      turnText: latestText,
      skipMemoryInjection: false,
      skipExtraction: false,
    };
  }

  if (latestUserMessage.hasLaterMessages) {
    return {
      kind: "continuation",
      turnText: latestText,
      skipMemoryInjection: false,
      skipExtraction: false,
    };
  }

  return {
    kind: "user_turn",
    turnText: latestText,
    skipMemoryInjection: false,
    skipExtraction: false,
  };
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

    const rawText = textParts.join("\n");
    const cleanedText = role === "user" && !isToolResultOnly(content)
      ? stripSystemTags(rawText)
      : rawText;

    return {
      index,
      role,
      contentTypes,
      text: rawText,
      toolResultOnly: isToolResultOnly(content),
      cleanedText,
      hasSystemTags: cleanedText !== rawText,
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

function responseBlockText(type: string, block: Record<string, unknown>): string {
  if (type === "text" && typeof block.text === "string") {
    return block.text;
  }
  if (type === "thinking" && typeof block.thinking === "string") {
    return block.thinking;
  }
  if (type === "redacted_thinking") {
    return "[redacted thinking]";
  }
  return "";
}

function trimResponseBlocks(blocks: ProxyTraceResponseBlock[]): { blocks: ProxyTraceResponseBlock[]; truncated: boolean } {
  let remaining = MAX_TRACE_RESPONSE_TEXT_CHARS;
  let truncated = false;

  return {
    blocks: blocks.map((block) => {
      const next = { ...block };
      const rawText = typeof next.text === "string" ? next.text : "";
      if (!rawText) return next;

      if (remaining <= 0) {
        next.text = "…";
        truncated = true;
        return next;
      }

      if (rawText.length > remaining) {
        next.text = rawText.slice(0, remaining) + "…";
        remaining = 0;
        truncated = true;
        return next;
      }

      remaining -= rawText.length;
      return next;
    }),
    truncated,
  };
}

function snapshotResponseBlocks(content: unknown): { blocks: ProxyTraceResponseBlock[]; truncated: boolean } {
  if (!Array.isArray(content)) {
    return { blocks: [], truncated: false };
  }

  const blocks: ProxyTraceResponseBlock[] = [];
  content.forEach((block, index) => {
    if (!block || typeof block !== "object") return;
    const record = block as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "unknown";
    const text = responseBlockText(type, record);
    blocks.push({
      index,
      type,
      text,
      id: typeof record.id === "string" ? record.id : null,
      name: typeof record.name === "string" ? record.name : undefined,
    });
  });

  return trimResponseBlocks(blocks);
}

function extractResponseSnapshotFromMessageJson(payload: unknown): ProxyTraceResponseSnapshot | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const responseBlocks = snapshotResponseBlocks(record.content);
  const stopReason = typeof record.stop_reason === "string"
    ? record.stop_reason
    : typeof record.stopReason === "string"
      ? record.stopReason
      : null;

  if (!responseBlocks.blocks.length && !stopReason) {
    return undefined;
  }

  return {
    role: typeof record.role === "string" ? record.role : "assistant",
    blocks: responseBlocks.blocks,
    stopReason,
    ...(responseBlocks.truncated ? { truncated: true } : {}),
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

function resolveTraceTurn(classification: TraceRequestClassification): { id: string; seq: number; preview: string } | null {
  if (classification.kind === "probe") return null;

  const normalized = classification.turnText.trim();
  if (!normalized) {
    if (!activeTraceTurn) return null;
    activeTraceTurn.lastRequestKind = classification.kind;
    if (classification.kind !== "topic_analysis") {
      activeTraceTurn.pendingStarter = false;
    }
    return {
      id: activeTraceTurn.id,
      seq: activeTraceTurn.seq,
      preview: activeTraceTurn.preview,
    };
  }

  const userTextHash = hashText(normalized);
  const shouldReuseCurrentTurn = (() => {
    if (!activeTraceTurn) return false;
    if (activeTraceTurn.userTextHash !== userTextHash) return false;
    if (classification.kind === "topic_analysis") {
      return activeTraceTurn.pendingStarter;
    }
    if (classification.kind === "continuation" || classification.kind === "suggestion_mode") {
      return true;
    }
    return activeTraceTurn.pendingStarter;
  })();

  if (!shouldReuseCurrentTurn) {
    const seq = ++traceTurnSequence;
    const runId = getTraceRunId() ?? "legacy";
    activeTraceTurn = {
      id: `${runId}:turn:${seq}`,
      seq,
      preview: buildTurnPreview(normalized),
      userText: normalized,
      userTextHash,
      pendingStarter: classification.kind === "topic_analysis",
      lastRequestKind: classification.kind,
    };
  } else if (activeTraceTurn) {
    activeTraceTurn.lastRequestKind = classification.kind;
    if (classification.kind !== "topic_analysis") {
      activeTraceTurn.pendingStarter = false;
    }
  }

  if (!activeTraceTurn) return null;
  return {
    id: activeTraceTurn.id,
    seq: activeTraceTurn.seq,
    preview: activeTraceTurn.preview,
  };
}

function createTraceContext(method: string, path: string, requestBytes: number, requestKind: ProxyTraceRequestKind): ProxyTraceRequestContext {
  const seq = ++traceSequence;
  const runId = getTraceRunId() ?? "legacy";
  return {
    seq,
    requestId: `${runId}-${seq}`,
    requestKind,
    turnId: null,
    turnSeq: null,
    turnPreview: null,
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
    cacheCreationTokens: number;
    cacheReadTokens: number;
    note: string;
    promptSnapshot: ProxyTracePromptSnapshot;
    responseSnapshot: ProxyTraceResponseSnapshot;
    toolCalls: ProxyTraceToolCall[];
  }> = {},
): void {
  const runId = getTraceRunId();
  if (!runId) return;

  appendProxyTraceEvent(runId, {
    seq: ctx.seq,
    requestId: ctx.requestId,
    requestKind: ctx.requestKind,
    turnId: ctx.turnId ?? undefined,
    turnSeq: ctx.turnSeq ?? undefined,
    turnPreview: ctx.turnPreview ?? undefined,
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
  const cacheCreationTokens = typeof usage.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : undefined;
  const cacheReadTokens = typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : undefined;
  return { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens };
}

function mergeUsage(target: ResponseUsageSummary, next: ResponseUsageSummary): void {
  if (typeof next.inputTokens === "number") target.inputTokens = next.inputTokens;
  if (typeof next.outputTokens === "number") target.outputTokens = next.outputTokens;
  if (typeof next.cacheCreationTokens === "number") target.cacheCreationTokens = next.cacheCreationTokens;
  if (typeof next.cacheReadTokens === "number") target.cacheReadTokens = next.cacheReadTokens;
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

function applyResponseDataFromSsePayload(
  target: StreamingResponseAccumulator,
  payload: unknown,
): void {
  if (!payload || typeof payload !== "object") return;
  const record = payload as Record<string, unknown>;

  if (record.type === "message_start" && record.message && typeof record.message === "object") {
    const message = record.message as Record<string, unknown>;
    if (typeof message.role === "string") {
      target.role = message.role;
    }
    if (typeof message.stop_reason === "string") {
      target.stopReason = message.stop_reason;
    }
  }

  if (record.type === "message_delta" && record.delta && typeof record.delta === "object") {
    const delta = record.delta as Record<string, unknown>;
    if (typeof delta.stop_reason === "string") {
      target.stopReason = delta.stop_reason;
    }
  }

  const index = typeof record.index === "number" ? record.index : null;
  if (index === null) return;

  if (record.type === "content_block_start" && record.content_block && typeof record.content_block === "object") {
    const block = record.content_block as Record<string, unknown>;
    const type = typeof block.type === "string" ? block.type : "unknown";
    target.blocksByIndex.set(index, {
      type,
      textBuffer: responseBlockText(type, block),
      id: typeof block.id === "string" ? block.id : null,
      name: typeof block.name === "string" ? block.name : null,
    });
    return;
  }

  if (record.type === "content_block_delta" && record.delta && typeof record.delta === "object") {
    const block = target.blocksByIndex.get(index);
    if (!block) return;
    const delta = record.delta as Record<string, unknown>;
    if (delta.type === "text_delta" && typeof delta.text === "string") {
      block.textBuffer += delta.text;
    } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
      block.textBuffer += delta.thinking;
    }
  }
}

function buildResponseSnapshotFromStreaming(target: StreamingResponseAccumulator): ProxyTraceResponseSnapshot | undefined {
  const blocks = Array.from(target.blocksByIndex.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([index, block]) => {
      return {
        index,
        type: block.type,
        text: block.textBuffer,
        id: block.id,
        ...(block.name ? { name: block.name } : {}),
      };
    });
  const responseBlocks = trimResponseBlocks(blocks);
  if (!responseBlocks.blocks.length && !target.stopReason) {
    return undefined;
  }
  return {
    role: target.role || "assistant",
    blocks: responseBlocks.blocks,
    stopReason: target.stopReason,
    ...(responseBlocks.truncated ? { truncated: true } : {}),
  };
}

function consumeSseMetadata(
  buffer: string,
  usage: ResponseUsageSummary,
  toolsByIndex?: Map<number, StreamingToolAccumulator>,
  completedTools?: ProxyTraceToolCall[],
  responseAccumulator?: StreamingResponseAccumulator,
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
      if (responseAccumulator) {
        applyResponseDataFromSsePayload(responseAccumulator, payload);
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
  const current = loadConfig();
  return current.uiLanguage === "zh-CN" || current.uiLanguage === "zh-TW" ? "zh-CN" : "en";
}

function isMemoryEnabledForCurrentRun(): boolean {
  return config.memoryEnabled !== false;
}

function readDashboardSettingsPayload(): {
  uiLanguage: string | null;
  memoryEnabled: boolean;
  autoOpenDashboard: boolean;
  mirror: string | null;
  modelDownloaded: boolean;
  languageOptions: Array<{ value: string; label: string }>;
  mirrorOptions: Array<{ value: string; label: string }>;
} {
  const current = loadConfig();
  const language = current.uiLanguage ?? "en";
  return {
    uiLanguage: current.uiLanguage ?? "en",
    memoryEnabled: current.memoryEnabled !== false,
    autoOpenDashboard: current.autoOpenDashboard !== false,
    mirror: current.mirror,
    modelDownloaded: hasEmbeddingModel(),
    languageOptions: UI_LANGUAGES.map((value) => ({
      value,
      label: getUiLanguageLabel(value),
    })),
    mirrorOptions: Object.keys(EMBEDDING_MODEL_SOURCES).map((value) => ({
      value,
      label: getLocalizedMirrorLabel(value as keyof typeof EMBEDDING_MODEL_SOURCES, language),
    })),
  };
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

  if (req.method === "GET" && path === "/__melu/trace-file") {
    const runId = getTraceRunId() ?? "legacy";
    const tracePath = getTraceEventsPath(runId);
    if (!existsSync(tracePath)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Trace file not found");
      return;
    }
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(readFileSync(tracePath, "utf-8"));
    return;
  }

  if (req.method === "GET" && path === "/__melu/settings") {
    writeJsonResponse(res, 200, {
      generatedAt: new Date().toISOString(),
      ...readDashboardSettingsPayload(),
    });
    return;
  }

  if (req.method === "POST" && path === "/__melu/settings") {
    const rawBody = await readBody(req);
    let payload: Record<string, unknown> = {};
    try {
      payload = rawBody.length ? JSON.parse(rawBody.toString("utf-8")) as Record<string, unknown> : {};
    } catch {
      writeJsonResponse(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const current = loadConfig();
    const nextConfig: MeluConfig = { ...current };
    if ("uiLanguage" in payload) {
      const language = payload.uiLanguage;
      if (!isUiLanguage(language)) {
        writeJsonResponse(res, 400, { error: "Invalid uiLanguage" });
        return;
      }
      nextConfig.uiLanguage = language;
    }
    if ("memoryEnabled" in payload) {
      if (typeof payload.memoryEnabled !== "boolean") {
        writeJsonResponse(res, 400, { error: "Invalid memoryEnabled" });
        return;
      }
      nextConfig.memoryEnabled = payload.memoryEnabled;
    }
    if ("autoOpenDashboard" in payload) {
      if (typeof payload.autoOpenDashboard !== "boolean") {
        writeJsonResponse(res, 400, { error: "Invalid autoOpenDashboard" });
        return;
      }
      nextConfig.autoOpenDashboard = payload.autoOpenDashboard;
    }
    if ("mirror" in payload) {
      const mirror = payload.mirror;
      if (mirror !== null && !isMirrorName(mirror)) {
        writeJsonResponse(res, 400, { error: "Invalid mirror" });
        return;
      }
      nextConfig.mirror = mirror;
    }

    if (nextConfig.memoryEnabled && !hasEmbeddingModel()) {
      const errorLanguage = nextConfig.uiLanguage === "zh-CN" || nextConfig.uiLanguage === "zh-TW" ? "zh-CN" : "en";
      if (!nextConfig.mirror) {
        writeJsonResponse(res, 400, {
          error: errorLanguage === "zh-CN"
            ? "开启运行记忆前，请先选择下载源。"
            : "Choose a download source before enabling runtime memory.",
        });
        return;
      }

      try {
        await ensureEmbeddingRuntimeAvailable(nextConfig.uiLanguage);
        const prepared = await ensureEmbeddingModelReady({
          config: nextConfig,
          interactive: false,
          preferredMirror: nextConfig.mirror,
          showProgress: false,
        });
        Object.assign(nextConfig, prepared.config);
      } catch (error) {
        writeJsonResponse(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }

    saveConfig(nextConfig);
    writeJsonResponse(res, 200, {
      savedAt: new Date().toISOString(),
      ...readDashboardSettingsPayload(),
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
  let traceContext: ProxyTraceRequestContext | null = null;

  if (isMessages && rawBody.length > 0) {
    try {
      bodyDict = JSON.parse(rawBody.toString("utf-8"));
      isStreaming = bodyDict!.stream === true;

      const messages = bodyDict!.messages as Array<{ role: string; content: unknown }>;
      const latestUserMessage = extractLatestUserMessageInfo(messages);
      const classification = classifyTraceRequest(bodyDict!, latestUserMessage);
      userText = classification.turnText || latestUserMessage.text;
      traceContext = createTraceContext(req.method ?? "POST", path, rawBody.length, classification.kind);
      traceContext.stream = isStreaming;
      traceContext.model = typeof bodyDict!.model === "string" ? bodyDict!.model : null;

      const traceTurn = resolveTraceTurn(classification);
      if (traceContext && traceTurn) {
        traceContext.turnId = traceTurn.id;
        traceContext.turnSeq = traceTurn.seq;
        traceContext.turnPreview = traceTurn.preview;
      }
      console.log(`[Melu:DEBUG] userText 长度: ${userText.length}, 前200字: ${userText.slice(0, 200)}`);

      // 检索记忆
      if (isMemoryEnabledForCurrentRun() && store && userText && !classification.skipMemoryInjection) {
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

      if (isMemoryEnabledForCurrentRun() && forwarded && userText && userText.trim().length > 4 && !classification.skipExtraction) {
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
      traceContext = createTraceContext(req.method ?? "POST", path, rawBody.length, "user_turn");
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
    let responseSnapshot: ProxyTraceResponseSnapshot | undefined;
    const contentType = resp.headers.get("content-type")?.toLowerCase() ?? "";

    if (traceContext && contentType.includes("application/json")) {
      const buffer = Buffer.from(await resp.arrayBuffer());
      responseBytes = buffer.byteLength;
      try {
        const payload = JSON.parse(buffer.toString("utf-8"));
        usage = extractUsageFromMessageJson(payload);
        toolCalls = extractToolCallsFromMessageJson(payload);
        responseSnapshot = extractResponseSnapshotFromMessageJson(payload);
      } catch {
        usage = {};
        toolCalls = [];
        responseSnapshot = undefined;
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
        ...(responseSnapshot ? { responseSnapshot } : {}),
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
    const responseAccumulator: StreamingResponseAccumulator = {
      role: "assistant",
      stopReason: null,
      blocksByIndex: new Map<number, StreamingResponseBlockAccumulator>(),
    };
    if (resp.body) {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        responseBytes += value.byteLength;
        sseBuffer += decoder.decode(value, { stream: true });
        sseBuffer = consumeSseMetadata(sseBuffer, usage, toolsByIndex, toolCalls, responseAccumulator);
        res.write(value);
      }
      sseBuffer += decoder.decode();
      consumeSseMetadata(sseBuffer, usage, toolsByIndex, toolCalls, responseAccumulator);
      appendStreamingToolCalls(toolCalls, toolsByIndex);
    }

    res.end();
    const responseSnapshot = buildResponseSnapshotFromStreaming(responseAccumulator);
    if (traceContext) {
      recordTraceEvent(traceContext, "receive_end", {
        status: resp.status,
        responseBytes,
        durationMs: Date.now() - traceContext.startedAt,
        ...usage,
        ...(responseSnapshot ? { responseSnapshot } : {}),
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
  const portOverrideRaw = process.env.MELU_PROXY_PORT?.trim();
  if (portOverrideRaw) {
    const parsedPort = Number.parseInt(portOverrideRaw, 10);
    if (Number.isInteger(parsedPort) && parsedPort > 0) {
      config.port = parsedPort;
    }
  }
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
  traceTurnSequence = 0;
  activeTraceTurn = null;

  if (config.memoryEnabled !== false) {
    store = new MemoryStore(memPath);
    store.open();
    console.log(`[Melu] 记忆文件: ${memPath}`);
    console.log(`[Melu] 记忆条数: ${store.countActive()}`);
  } else {
    store = null;
    console.log(`[Melu] 记忆文件: ${memPath}`);
    console.log("[Melu] 已关闭运行时记忆加载；本次仅保留代理与观测。");
  }

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
