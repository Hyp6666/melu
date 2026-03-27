import { createHash } from "node:crypto";
import { join } from "node:path";

import { SOCKETS_DIR } from "./config.js";

export const EMBEDDER_DAEMON_SOCKET_PREFIX = "embedder";
export const EMBEDDER_DAEMON_DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
export const EMBEDDER_DAEMON_DEFAULT_IDLE_CHECK_MS = 30 * 1000;
const WINDOWS_PIPE_PREFIX = "\\\\.\\pipe\\";
const MAX_RUN_ID_SEGMENT_LENGTH = 24;

export type EmbedderRequestType = "query" | "memory" | "ping";

export interface EmbedderDaemonRequest {
  id: string;
  run_id: string;
  type: EmbedderRequestType;
  texts: string[];
}

export interface EmbedderDaemonResponse {
  id: string;
  run_id: string;
  type: EmbedderRequestType;
  ok: boolean;
  error: string | null;
  latency_ms: number;
  embeddings?: number[][];
}

export function sanitizePathComponent(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return normalized.length > 0 ? normalized.slice(0, 120) : "default";
}

function hashRunId(runId: string): string {
  return createHash("sha1").update(runId).digest("hex").slice(0, 10);
}

function buildEmbedderDaemonEndpointName(runId: string): string {
  const safeRunId = sanitizePathComponent(runId);
  const runIdSegment = safeRunId.slice(0, MAX_RUN_ID_SEGMENT_LENGTH) || "default";
  return `${EMBEDDER_DAEMON_SOCKET_PREFIX}-${runIdSegment}-${hashRunId(safeRunId)}`;
}

export function getEmbedderDaemonSocketPath(runId: string): string {
  const endpointName = buildEmbedderDaemonEndpointName(runId);
  if (process.platform === "win32") {
    return `${WINDOWS_PIPE_PREFIX}melu-${endpointName}`;
  }

  return join(SOCKETS_DIR, `${endpointName}.sock`);
}

export function isWindowsNamedPipePath(value: string): boolean {
  return /^\\\\(?:\.|\?)\\pipe\\/i.test(value);
}

export function isEmbedderRequestType(value: unknown): value is EmbedderRequestType {
  return value === "query" || value === "memory" || value === "ping";
}

export function normalizeEmbedderTexts(texts: unknown): string[] {
  if (!Array.isArray(texts)) return [];

  const normalized: string[] = [];
  for (const item of texts) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (text) {
      normalized.push(text);
    }
  }
  return normalized;
}

export function isEmbedderDaemonRequest(value: unknown): value is EmbedderDaemonRequest {
  if (!value || typeof value !== "object") return false;

  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    obj.id.trim() !== "" &&
    typeof obj.run_id === "string" &&
    obj.run_id.trim() !== "" &&
    isEmbedderRequestType(obj.type) &&
    Array.isArray(obj.texts) &&
    obj.texts.every((item) => typeof item === "string")
  );
}

export function encodeEmbedderMessage(message: EmbedderDaemonRequest | EmbedderDaemonResponse): string {
  return JSON.stringify(message) + "\n";
}

export function tryParseEmbedderMessage(line: string): unknown {
  const trimmed = line.trim();
  if (trimmed === "") return null;

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}
