import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { PENDING_EXTRACTIONS_DIR } from "./config.js";

const DEFAULT_RUN_ID = "legacy";
const LEGACY_PENDING_EXTRACTION_FILE = join(PENDING_EXTRACTIONS_DIR, "pending-extractions.jsonl");
const LEGACY_JOB_SUFFIXES = [".pending.json", ".working.json", ".failed.json"] as const;
const JOB_SUFFIX = ".json";
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 30_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 10 * 60_000;

export interface ExtractionQueuePaths {
  runId: string;
  runDir: string;
  pendingDir: string;
  workingDir: string;
  failedDir: string;
}

export interface ExtractionQueueJob {
  id: string;
  runId: string;
  text: string;
  ts: number;
  attempts: number;
  memoryPath: string | null;
  lastError: string | null;
  nextAttemptAt: number | null;
  updatedAt: number;
}

export interface ClaimedPendingExtractionJob extends ExtractionQueueJob {
  claimedPath: string;
}

export interface ExtractionQueueSnapshot {
  runId: string;
  pending: number;
  working: number;
  retryableFailed: number;
  terminalFailed: number;
  remaining: number;
  nextRetryAt: number | null;
}

export interface RequeueClaimedPendingExtractionJobPolicy {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface RequeueClaimedPendingExtractionJobResult {
  job: ExtractionQueueJob;
  terminal: boolean;
  path: string;
}

function sanitizeRunId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_RUN_ID;
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return sanitized.length > 0 ? sanitized.slice(0, 120) : DEFAULT_RUN_ID;
}

export function resolveExtractionRunId(value?: string | null): string {
  const explicit = value?.trim();
  if (explicit) return sanitizeRunId(explicit);

  const fromEnv = process.env.MELU_RUN_ID?.trim() || process.env.MELU_EXTRACTION_RUN_ID?.trim();
  return sanitizeRunId(fromEnv || DEFAULT_RUN_ID);
}

export function getExtractionQueuePaths(runId: string): ExtractionQueuePaths {
  const normalizedRunId = resolveExtractionRunId(runId);
  const runDir = join(PENDING_EXTRACTIONS_DIR, normalizedRunId);
  return {
    runId: normalizedRunId,
    runDir,
    pendingDir: join(runDir, "pending"),
    workingDir: join(runDir, "working"),
    failedDir: join(runDir, "failed"),
  };
}

function ensureDirectory(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function ensureQueueDirs(paths: ExtractionQueuePaths): void {
  ensureDirectory(PENDING_EXTRACTIONS_DIR);
  ensureDirectory(paths.runDir);
  ensureDirectory(paths.pendingDir);
  ensureDirectory(paths.workingDir);
  ensureDirectory(paths.failedDir);
}

function queueFilePath(dir: string, jobId: string): string {
  return join(dir, `${jobId}${JOB_SUFFIX}`);
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  ensureDirectory(dirname(filePath));
  const tmpPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
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

function normalizeJob(value: unknown, runId: string): ExtractionQueueJob | null {
  if (!value || typeof value !== "object") return null;

  const obj = value as Record<string, unknown>;
  const text = typeof obj.text === "string" ? obj.text.trim() : "";
  if (!text) return null;

  const id = typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : randomUUID();
  const ts = typeof obj.ts === "number" && Number.isFinite(obj.ts) ? obj.ts : Date.now();
  const rawAttempts = Number(obj.attempts);
  const attempts = Number.isInteger(rawAttempts) && rawAttempts >= 0 ? rawAttempts : 0;
  const memoryPath = typeof obj.memoryPath === "string" && obj.memoryPath.trim() ? obj.memoryPath.trim() : null;
  const lastError = typeof obj.lastError === "string" && obj.lastError.trim() ? obj.lastError.trim() : null;
  const rawNextAttemptAt = Number(obj.nextAttemptAt);
  const nextAttemptAt = Number.isFinite(rawNextAttemptAt) && rawNextAttemptAt >= 0 ? rawNextAttemptAt : null;
  const rawUpdatedAt = Number(obj.updatedAt);
  const updatedAt = Number.isFinite(rawUpdatedAt) && rawUpdatedAt >= 0 ? rawUpdatedAt : ts;

  return {
    id,
    runId,
    text,
    ts,
    attempts,
    memoryPath,
    lastError,
    nextAttemptAt,
    updatedAt,
  };
}

function readJobFile(filePath: string, runId: string): ExtractionQueueJob | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    const job = normalizeJob(parsed, runId);
    if (!job) {
      try {
        unlinkSync(filePath);
      } catch {
        // Ignore cleanup failures for malformed files.
      }
      return null;
    }
    return job;
  } catch {
    try {
      unlinkSync(filePath);
    } catch {
      // Ignore cleanup failures for malformed files.
    }
    return null;
  }
}

function moveFileReplacingExisting(sourcePath: string, targetPath: string): void {
  ensureDirectory(dirname(targetPath));
  try {
    unlinkSync(targetPath);
  } catch {
    // Ignore if the destination does not exist.
  }
  renameSync(sourcePath, targetPath);
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function collectJobs(dir: string, runId: string): Array<{ path: string; job: ExtractionQueueJob }> {
  const jobs: Array<{ path: string; job: ExtractionQueueJob }> = [];
  for (const fileName of listFiles(dir)) {
    if (!fileName.endsWith(JOB_SUFFIX)) continue;
    const path = join(dir, fileName);
    const job = readJobFile(path, runId);
    if (!job) continue;
    jobs.push({ path, job });
  }
  jobs.sort((a, b) => {
    if (a.job.ts !== b.job.ts) return a.job.ts - b.job.ts;
    if (a.job.attempts !== b.job.attempts) return a.job.attempts - b.job.attempts;
    return a.job.id.localeCompare(b.job.id);
  });
  return jobs;
}

function createQueuedJob(
  runId: string,
  text: string,
  memoryPath?: string | null,
): ExtractionQueueJob {
  const now = Date.now();
  return {
    id: randomUUID(),
    runId,
    text: text.trim(),
    ts: now,
    attempts: 0,
    memoryPath: memoryPath?.trim() || null,
    lastError: null,
    nextAttemptAt: null,
    updatedAt: now,
  };
}

function writeJobToPending(paths: ExtractionQueuePaths, job: ExtractionQueueJob): string {
  const jobPath = queueFilePath(paths.pendingDir, job.id);
  writeJsonAtomically(jobPath, job);
  return jobPath;
}

function writeJobToFailed(paths: ExtractionQueuePaths, job: ExtractionQueueJob): string {
  const jobPath = queueFilePath(paths.failedDir, job.id);
  writeJsonAtomically(jobPath, job);
  return jobPath;
}

function promoteRetryableFailedJobs(paths: ExtractionQueuePaths, now: number): void {
  for (const { path, job } of collectJobs(paths.failedDir, paths.runId)) {
    if (job.nextAttemptAt === null || job.nextAttemptAt > now) continue;

    const pendingPath = queueFilePath(paths.pendingDir, job.id);
    try {
      moveFileReplacingExisting(path, pendingPath);
    } catch {
      // Leave the job in failed if the move could not be completed.
    }
  }
}

function recoverWorkingJobs(paths: ExtractionQueuePaths): void {
  for (const { path, job } of collectJobs(paths.workingDir, paths.runId)) {
    const pendingPath = queueFilePath(paths.pendingDir, job.id);
    try {
      moveFileReplacingExisting(path, pendingPath);
    } catch {
      // Leave the job in working for a future run to recover.
    }
  }
}

function migrateLegacyPendingExtractionJobs(paths: ExtractionQueuePaths): void {
  if (existsSync(LEGACY_PENDING_EXTRACTION_FILE)) {
    try {
      const raw = readFileSync(LEGACY_PENDING_EXTRACTION_FILE, "utf-8").trim();
      if (raw) {
        for (const line of raw.split("\n").filter(Boolean)) {
          try {
            const normalized = normalizeJob(JSON.parse(line), paths.runId);
            if (normalized) {
              writeJobToPending(paths, normalized);
            }
          } catch {
            // Skip malformed legacy rows and keep migrating.
          }
        }
      }
    } finally {
      try {
        unlinkSync(LEGACY_PENDING_EXTRACTION_FILE);
      } catch {
        // Ignore cleanup failures.
      }
    }
  }

  for (const fileName of listFiles(PENDING_EXTRACTIONS_DIR)) {
    if (fileName === basename(paths.runDir)) continue;

    const legacySuffix = LEGACY_JOB_SUFFIXES.find((suffix) => fileName.endsWith(suffix));
    if (!legacySuffix) continue;

    const legacyPath = join(PENDING_EXTRACTIONS_DIR, fileName);
    const parsedJob = readJobFile(legacyPath, paths.runId);
    if (!parsedJob) continue;

    const targetDir = legacySuffix === ".failed.json" ? paths.failedDir : paths.pendingDir;
    const targetPath = queueFilePath(targetDir, parsedJob.id);
    try {
      writeJsonAtomically(targetPath, {
        ...parsedJob,
        nextAttemptAt: legacySuffix === ".failed.json" ? parsedJob.nextAttemptAt : null,
      });
    } catch {
      // Skip if the migrated file could not be written.
      continue;
    }

    try {
      unlinkSync(legacyPath);
    } catch {
      // Ignore cleanup failures.
    }
  }
}

export function preparePendingExtractionQueue(runId?: string | null): void {
  preparePendingExtractionQueueForRun(resolveExtractionRunId(runId));
}

export function preparePendingExtractionQueueForRun(runId: string): void {
  const paths = getExtractionQueuePaths(runId);
  ensureQueueDirs(paths);
  migrateLegacyPendingExtractionJobs(paths);
  recoverWorkingJobs(paths);
  promoteRetryableFailedJobs(paths, Date.now());
}

export function enqueuePendingExtractionJob(
  text: string,
  memoryPath?: string | null,
  runId?: string | null,
): string | null {
  return enqueuePendingExtractionJobForRun(resolveExtractionRunId(runId), text, memoryPath);
}

export function enqueuePendingExtractionJobForRun(
  runId: string,
  text: string,
  memoryPath?: string | null,
): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const paths = getExtractionQueuePaths(runId);
  ensureQueueDirs(paths);

  const job = createQueuedJob(paths.runId, trimmed, memoryPath ?? null);
  writeJobToPending(paths, job);
  return job.id;
}

export function claimNextPendingExtractionJob(runId?: string | null): ClaimedPendingExtractionJob | null {
  return claimNextPendingExtractionJobForRun(resolveExtractionRunId(runId));
}

export function claimNextPendingExtractionJobForRun(runId: string): ClaimedPendingExtractionJob | null {
  const paths = getExtractionQueuePaths(runId);
  ensureQueueDirs(paths);
  promoteRetryableFailedJobs(paths, Date.now());

  const jobs = collectJobs(paths.pendingDir, paths.runId);
  for (const { path, job } of jobs) {
    const claimedPath = queueFilePath(paths.workingDir, job.id);
    try {
      moveFileReplacingExisting(path, claimedPath);
    } catch {
      continue;
    }

    const claimedJob = readJobFile(claimedPath, paths.runId);
    if (!claimedJob) {
      try {
        unlinkSync(claimedPath);
      } catch {
        // Ignore cleanup failures.
      }
      continue;
    }

    return {
      ...claimedJob,
      claimedPath,
    };
  }

  return null;
}

export function completeClaimedPendingExtractionJob(
  job: ClaimedPendingExtractionJob,
): void {
  try {
    unlinkSync(job.claimedPath);
  } catch {
    // Ignore cleanup failures.
  }
}

function computeRetryDelayMs(
  attempt: number,
  policy?: RequeueClaimedPendingExtractionJobPolicy,
): number {
  const baseDelayMs = policy?.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const maxDelayMs = policy?.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
  const scale = Math.max(0, attempt - 1);
  const delayMs = baseDelayMs * (2 ** scale);
  return Math.min(delayMs, maxDelayMs);
}

export function requeueClaimedPendingExtractionJob(
  job: ClaimedPendingExtractionJob,
  updates?: Partial<ExtractionQueueJob>,
  policy?: RequeueClaimedPendingExtractionJobPolicy | null,
): RequeueClaimedPendingExtractionJobResult {
  const paths = getExtractionQueuePaths(job.runId);
  ensureQueueDirs(paths);

  const nextAttempts = Number.isInteger(updates?.attempts) && (updates?.attempts ?? 0) >= 0
    ? Number(updates?.attempts)
    : job.attempts + 1;

  const nextJob: ExtractionQueueJob = {
    id: job.id,
    runId: paths.runId,
    text: updates?.text?.trim() || job.text,
    ts: typeof updates?.ts === "number" && Number.isFinite(updates.ts) ? updates.ts : job.ts,
    attempts: nextAttempts,
    memoryPath: updates?.memoryPath ?? job.memoryPath,
    lastError: updates?.lastError ?? job.lastError,
    nextAttemptAt: null,
    updatedAt: Date.now(),
  };

  if (policy) {
    const maxAttempts = policy.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const shouldRetry = nextAttempts < maxAttempts;
    nextJob.nextAttemptAt = shouldRetry
      ? Date.now() + computeRetryDelayMs(nextAttempts, policy)
      : null;
  }

  const targetPath = policy ? queueFilePath(paths.failedDir, nextJob.id) : queueFilePath(paths.pendingDir, nextJob.id);
  writeJsonAtomically(targetPath, nextJob);

  try {
    unlinkSync(job.claimedPath);
  } catch {
    // Ignore cleanup failures.
  }

  return {
    job: nextJob,
    terminal: Boolean(policy) && nextJob.nextAttemptAt === null,
    path: targetPath,
  };
}

export function getExtractionQueueSnapshot(runId?: string | null): ExtractionQueueSnapshot {
  return getExtractionQueueSnapshotForRun(resolveExtractionRunId(runId));
}

export function getExtractionQueueSnapshotForRun(runId: string): ExtractionQueueSnapshot {
  const paths = getExtractionQueuePaths(runId);
  ensureQueueDirs(paths);

  let pending = 0;
  let working = 0;
  let retryableFailed = 0;
  let terminalFailed = 0;
  let nextRetryAt: number | null = null;

  for (const { job } of collectJobs(paths.pendingDir, paths.runId)) {
    pending += 1;
    if (job.nextAttemptAt !== null && (nextRetryAt === null || job.nextAttemptAt < nextRetryAt)) {
      nextRetryAt = job.nextAttemptAt;
    }
  }

  for (const { job } of collectJobs(paths.workingDir, paths.runId)) {
    working += 1;
    if (job.nextAttemptAt !== null && (nextRetryAt === null || job.nextAttemptAt < nextRetryAt)) {
      nextRetryAt = job.nextAttemptAt;
    }
  }

  for (const { job } of collectJobs(paths.failedDir, paths.runId)) {
    if (job.nextAttemptAt === null) {
      terminalFailed += 1;
      continue;
    }
    retryableFailed += 1;
    if (nextRetryAt === null || job.nextAttemptAt < nextRetryAt) {
      nextRetryAt = job.nextAttemptAt;
    }
  }

  return {
    runId: paths.runId,
    pending,
    working,
    retryableFailed,
    terminalFailed,
    remaining: pending + working + retryableFailed,
    nextRetryAt,
  };
}

