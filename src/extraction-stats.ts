import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { STATS_DIR } from "./config.js";
import { resolveExtractionRunId } from "./extraction-queue.js";

const STATS_FILE_NAME = "extraction-worker.json";

export interface ExtractionRunStats {
  runId: string;
  processed: number;
  effectiveNewMemories: number;
  failed: number;
  remainingQueue: number;
  updatedAt: string;
}

function ensureDirectory(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function getExtractionStatsPath(runId: string): string {
  const normalizedRunId = resolveExtractionRunId(runId);
  return join(STATS_DIR, normalizedRunId, STATS_FILE_NAME);
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  ensureDirectory(dirname(filePath));
  const tmpPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );

  writeFileSync(tmpPath, JSON.stringify(value, null, 2), "utf-8");

  try {
    renameSync(tmpPath, filePath);
  } catch {
    try {
      unlinkSync(filePath);
    } catch {
      // Ignore missing destination or cleanup failures.
    }
    renameSync(tmpPath, filePath);
  }
}

export function createInitialExtractionRunStats(
  runId: string,
  remainingQueue = 0,
): ExtractionRunStats {
  return {
    runId: resolveExtractionRunId(runId),
    processed: 0,
    effectiveNewMemories: 0,
    failed: 0,
    remainingQueue,
    updatedAt: new Date().toISOString(),
  };
}

export function readExtractionRunStats(runId: string): ExtractionRunStats | null {
  const statsPath = getExtractionStatsPath(runId);
  if (!existsSync(statsPath)) return null;

  try {
    const parsed = JSON.parse(readFileSync(statsPath, "utf-8")) as Partial<ExtractionRunStats>;
    if (
      typeof parsed.runId !== "string" ||
      typeof parsed.processed !== "number" ||
      typeof parsed.effectiveNewMemories !== "number" ||
      typeof parsed.failed !== "number" ||
      typeof parsed.remainingQueue !== "number"
    ) {
      return null;
    }

    return {
      runId: parsed.runId,
      processed: parsed.processed,
      effectiveNewMemories: parsed.effectiveNewMemories,
      failed: parsed.failed,
      remainingQueue: parsed.remainingQueue,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeExtractionRunStats(stats: ExtractionRunStats): void {
  writeJsonAtomically(getExtractionStatsPath(stats.runId), stats);
}

export function updateExtractionRunStats(
  runId: string,
  updater: (current: ExtractionRunStats) => ExtractionRunStats,
): ExtractionRunStats {
  const current = readExtractionRunStats(runId) ?? createInitialExtractionRunStats(runId);
  const next = updater(current);
  const normalized: ExtractionRunStats = {
    ...next,
    runId: resolveExtractionRunId(next.runId),
    updatedAt: next.updatedAt || new Date().toISOString(),
  };
  writeExtractionRunStats(normalized);
  return normalized;
}

export function setExtractionRunStatsRemainingQueue(
  runId: string,
  remainingQueue: number,
): ExtractionRunStats {
  return updateExtractionRunStats(runId, (current) => ({
    ...current,
    remainingQueue,
    updatedAt: new Date().toISOString(),
  }));
}

