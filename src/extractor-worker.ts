import { buildEmbedderSocketPath } from "./runtime-context.js";
import { embedTextsViaDaemon } from "./embedder-daemon-client.js";
import { MemoryStore } from "./memory.js";
import {
  claimNextPendingExtractionJobForRun,
  completeClaimedPendingExtractionJob,
  getExtractionQueueSnapshotForRun,
  preparePendingExtractionQueueForRun,
  requeueClaimedPendingExtractionJob,
  resolveExtractionRunId,
  type ClaimedPendingExtractionJob,
} from "./extraction-queue.js";
import {
  createInitialExtractionRunStats,
  type ExtractionRunStats,
  updateExtractionRunStats,
} from "./extraction-stats.js";
import {
  extractMemoriesFromUserMessage,
  processAndStoreMemories,
} from "./extractor.js";

const DEFAULT_POLL_INTERVAL_MS = 2_000;

export interface ExtractorWorkerOptions {
  runId: string;
  defaultMemoryPath: string;
  embeddingModel: string;
  embedderSocketPath?: string;
  ownerPid?: number | null;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  pollIntervalMs?: number;
  quiet?: boolean;
  abortSignal?: AbortSignal | null;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isProcessAlive(pid: number | null | undefined): boolean {
  if (!Number.isInteger(pid) || (pid ?? 0) <= 0) {
    return false;
  }

  try {
    process.kill(pid as number, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number, abortSignal?: AbortSignal | null): Promise<void> {
  if (ms <= 0) return Promise.resolve();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = (): void => {
      cleanup();
      resolve();
    };

    const cleanup = (): void => {
      clearTimeout(timer);
      if (abortSignal) {
        abortSignal.removeEventListener("abort", onAbort);
      }
    };

    if (abortSignal) {
      if (abortSignal.aborted) {
        cleanup();
        resolve();
        return;
      }
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

async function storeMemoriesForJob(
  job: ClaimedPendingExtractionJob,
  runId: string,
  options: ExtractorWorkerOptions,
): Promise<number> {
  const memoryPath = job.memoryPath ?? options.defaultMemoryPath;
  if (!memoryPath) {
    throw new Error("Missing memory path for extraction job");
  }

  const rawMemories = await extractMemoriesFromUserMessage(job.text, {
    url: "",
    headers: {},
    bodyTemplate: {},
    quiet: options.quiet ?? true,
  });

  if (rawMemories.length === 0) {
    return 0;
  }

  const store = new MemoryStore(memoryPath);
  store.open();

  try {
    return await processAndStoreMemories(
      rawMemories,
      store,
      options.embeddingModel,
      memoryPath,
      {
        quiet: options.quiet ?? true,
        failOnEmbeddingError: true,
        embedText: async (summary: string, embeddingModel: string) => {
          const vectors = await embedTextsViaDaemon([summary], embeddingModel, {
            runId,
            socketPath: options.embedderSocketPath ?? buildEmbedderSocketPath(runId),
            type: "memory",
          });

          if (!vectors || vectors.length === 0) {
            throw new Error("Embedder daemon returned no vectors");
          }

          return vectors[0];
        },
      },
    );
  } finally {
    store.close();
  }
}

function persistStats(
  runId: string,
  counters: { processed: number; effectiveNewMemories: number; failed: number },
): { stats: ExtractionRunStats; remainingQueue: number; nextRetryAt: number | null } {
  const snapshot = getExtractionQueueSnapshotForRun(runId);
  const stats = updateExtractionRunStats(runId, () => ({
    ...createInitialExtractionRunStats(runId, snapshot.remaining),
    processed: counters.processed,
    effectiveNewMemories: counters.effectiveNewMemories,
    failed: counters.failed,
    remainingQueue: snapshot.remaining,
    updatedAt: new Date().toISOString(),
  }));

  return {
    stats,
    remainingQueue: snapshot.remaining,
    nextRetryAt: snapshot.nextRetryAt,
  };
}

export async function runExtractorWorker(
  options: ExtractorWorkerOptions,
): Promise<ExtractionRunStats> {
  const runId = resolveExtractionRunId(options.runId);
  const quiet = options.quiet ?? true;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  preparePendingExtractionQueueForRun(runId);

  const counters = {
    processed: 0,
    effectiveNewMemories: 0,
    failed: 0,
  };

  let { stats } = persistStats(runId, counters);

  while (true) {
    if (options.abortSignal?.aborted) {
      break;
    }

    const claimed = claimNextPendingExtractionJobForRun(runId);
    if (!claimed) {
      const snapshot = persistStats(runId, counters);
      stats = snapshot.stats;

      const ownerAlive = isProcessAlive(options.ownerPid);
      if (snapshot.remainingQueue === 0 && !ownerAlive) {
        break;
      }

      const now = Date.now();
      const waitMs = snapshot.remainingQueue === 0
        ? pollIntervalMs
        : snapshot.nextRetryAt !== null && snapshot.nextRetryAt > now
          ? Math.max(250, snapshot.nextRetryAt - now)
          : pollIntervalMs;
      await sleep(waitMs, options.abortSignal);
      continue;
    }

    let addedMemories = 0;
    let terminalFailure = false;

    try {
      addedMemories = await storeMemoriesForJob(claimed, runId, { ...options, quiet });
      completeClaimedPendingExtractionJob(claimed);
    } catch (error) {
      const result = requeueClaimedPendingExtractionJob(
        claimed,
        { lastError: formatError(error) },
        {
          maxAttempts: options.maxAttempts,
          baseDelayMs: options.retryBaseDelayMs,
          maxDelayMs: options.retryMaxDelayMs,
        },
      );
      terminalFailure = result.terminal;
    } finally {
      counters.processed += 1;
      counters.effectiveNewMemories += addedMemories;
      if (terminalFailure) {
        counters.failed += 1;
      }
      stats = persistStats(runId, counters).stats;
    }
  }

  return stats;
}

export function createExtractorWorkerAbortController(): AbortController {
  return new AbortController();
}
