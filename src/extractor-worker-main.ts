import { ensureDirs, loadConfig } from "./config.js";
import { getExtractionQueueSnapshotForRun, resolveExtractionRunId } from "./extraction-queue.js";
import {
  createInitialExtractionRunStats,
  readExtractionRunStats,
  writeExtractionRunStats,
} from "./extraction-stats.js";
import { runExtractorWorker } from "./extractor-worker.js";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseOptionalPid(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;

  const pid = Number.parseInt(raw, 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function terminateProcess(pid: number | null): void {
  if (!pid) return;

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Best-effort cleanup.
  }
}

async function main(): Promise<void> {
  ensureDirs();

  const runId = resolveExtractionRunId(requireEnv("MELU_RUN_ID"));
  const defaultMemoryPath = requireEnv("MELU_MEMORY_PATH");
  const embedderSocketPath = requireEnv("MELU_EMBEDDER_SOCKET");
  const ownerPid = parseOptionalPid("MELU_OWNER_PID");
  const embedderPid = parseOptionalPid("MELU_EMBEDDER_PID");
  const config = loadConfig();

  const initialSnapshot = getExtractionQueueSnapshotForRun(runId);
  writeExtractionRunStats(
    readExtractionRunStats(runId) ?? createInitialExtractionRunStats(runId, initialSnapshot.remaining),
  );

  const abortController = new AbortController();
  process.once("SIGINT", () => abortController.abort());
  process.once("SIGTERM", () => abortController.abort());

  try {
    await runExtractorWorker({
      runId,
      ownerPid,
      defaultMemoryPath,
      embeddingModel: config.embeddingModel,
      embedderSocketPath,
      quiet: true,
      abortSignal: abortController.signal,
    });
  } finally {
    const finalSnapshot = getExtractionQueueSnapshotForRun(runId);
    const currentStats = readExtractionRunStats(runId) ?? createInitialExtractionRunStats(runId, finalSnapshot.remaining);
    writeExtractionRunStats({
      ...currentStats,
      remainingQueue: finalSnapshot.remaining,
      updatedAt: new Date().toISOString(),
    });

    if (finalSnapshot.remaining === 0) {
      terminateProcess(embedderPid);
    }
  }
}

void main().catch((error) => {
  console.error("[Melu] extractor worker failed:", error);
  process.exitCode = 1;
});
