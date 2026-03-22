import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { SOCKETS_DIR } from "./config.js";

export const MELU_RUN_ID_ENV = "MELU_RUN_ID";
export const MELU_EMBEDDER_SOCKET_ENV = "MELU_EMBEDDER_SOCKET";
const LEGACY_RUN_ID = "legacy";

export interface MeluRuntimeContext {
  runId: string;
  embedderSocketPath: string;
}

function sanitizeRunId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return LEGACY_RUN_ID;
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return sanitized || LEGACY_RUN_ID;
}

export function normalizeMeluRunId(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return randomUUID();
  return sanitizeRunId(trimmed);
}

export function buildEmbedderSocketPath(runId: string): string {
  return join(SOCKETS_DIR, `embedder-${sanitizeRunId(runId)}.sock`);
}

export function createMeluRuntimeContext(runId?: string | null): MeluRuntimeContext {
  const normalizedRunId = normalizeMeluRunId(runId);
  return {
    runId: normalizedRunId,
    embedderSocketPath: buildEmbedderSocketPath(normalizedRunId),
  };
}

export function getMeluRuntimeContext(): MeluRuntimeContext {
  const runId = normalizeMeluRunId(process.env[MELU_RUN_ID_ENV]);
  const embedderSocketPath = process.env[MELU_EMBEDDER_SOCKET_ENV]?.trim() || buildEmbedderSocketPath(runId);
  return { runId, embedderSocketPath };
}

export function applyMeluRuntimeContextEnv(context: MeluRuntimeContext): void {
  process.env[MELU_RUN_ID_ENV] = context.runId;
  process.env[MELU_EMBEDDER_SOCKET_ENV] = context.embedderSocketPath;
}
