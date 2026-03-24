#!/usr/bin/env node

/**
 * Melu CLI 入口。
 *
 * 命令：init / run / stop / list / delete / clear / export / import / status
 */

import { Command } from "commander";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";
import {
  MELU_HOME,
  PID_FILE,
  DEFAULT_PORT,
  ensureDirs,
  hasEmbeddingModel,
  loadConfig,
  saveConfig,
  getMemoryPath,
  type MeluConfig,
} from "./config.js";
import {
  getExtractionQueueSnapshotForRun,
  preparePendingExtractionQueueForRun,
} from "./extraction-queue.js";
import {
  createInitialExtractionRunStats,
  readExtractionRunStats,
  writeExtractionRunStats,
} from "./extraction-stats.js";
import { MemoryStore } from "./memory.js";
import {
  ensureEmbeddingModelReady,
  ensureEmbeddingRuntimeAvailable,
  ensureUiLanguageConfigured,
  getMirrorLabel,
} from "./model-bootstrap.js";
import { createI18n } from "./i18n.js";
import { waitForEmbedderDaemonReady } from "./embedder-client.js";
import { createRunId } from "./run-runtime.js";
import { createMeluRuntimeContext } from "./runtime-context.js";

const startupUi = createI18n(loadConfig().uiLanguage);
const program = new Command();
const CLAUDE_USER_SETTINGS_PATH = join(process.env.HOME ?? "", ".claude", "settings.json");

interface ClaudeSettingsFile {
  env?: Record<string, unknown>;
  [key: string]: unknown;
}

interface PreparedForegroundCommand {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cleanup: () => void;
}

program
  .name("melu")
  .description(startupUi.t("programDescription"))
  .version(
    JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf-8"),
    ).version,
  );

// ── init ─────────────────────────────────────────────────────────────

program
  .command("init")
  .description(startupUi.t("cmdInitDescription"))
  .option("--mirror <mirror>", startupUi.t("optMirrorDescription"))
  .action(async (opts: { mirror: string }) => {
    let config = loadConfig();
    config = await ensureUiLanguageConfigured(config, { interactive: true });
    const ui = createI18n(config.uiLanguage);

    console.log(ui.t("initTitle"));

    // 1. 创建目录
    ensureDirs();
    console.log(`  ${ui.t("labelDirectory")}: ${MELU_HOME}`);

    // 2. 保存配置
    const preparedConfig = await prepareEmbedding(config, {
      interactive: true,
      mirror: opts.mirror,
      showDownloadProgress: true,
    });
    saveConfig(preparedConfig);
    console.log(`  ${ui.t("labelConfig")}: ${MELU_HOME}/config.json`);

    // 3. 创建默认记忆文件
    const memPath = getMemoryPath();
    const store = new MemoryStore(memPath);
    store.open();
    store.setMeta("name", "default");
    store.setMeta("created_at", new Date().toISOString());
    store.close();
    console.log(`  ${ui.t("labelMemory")}: ${memPath}`);

    console.log("");
    console.log(ui.t("initComplete"));
    console.log(`  ${ui.t("labelMirrorSource")}: ${getMirrorLabel(preparedConfig.mirror, preparedConfig.uiLanguage)}`);
    console.log(`  ${ui.t("embeddingModelReady")}`);
    console.log(`  ${ui.t("usageRunClaude")}`);
  });

// ── run ──────────────────────────────────────────────────────────────

program
  .command("run")
  .description(startupUi.t("cmdRunDescription"))
  .option("-m, --memory <name>", startupUi.t("optMemoryNameOrPathDescription"))
  .option("--mirror <mirror>", startupUi.t("optMirrorDescription"))
  .option("-p, --port <port>", startupUi.t("optPortDescription"), String(DEFAULT_PORT))
  .argument("<command...>", startupUi.t("argCommandDescription"))
  .action(async (command: string[], opts: { memory?: string; mirror?: string; port: string }) => {
    let config = loadConfig();
    config = await ensureUiLanguageConfigured(config, { interactive: true });
    const ui = createI18n(config.uiLanguage);
    const port = parseInt(opts.port, 10) || config.port;
    config.port = port;

    const runId = createRunId();
    const runtimeContext = createMeluRuntimeContext(runId);
    preparePendingExtractionQueueForRun(runId);

    config = await prepareEmbedding(config, {
      interactive: true,
      mirror: opts.mirror,
      showDownloadProgress: !hasEmbeddingModel(),
    });

    const memPath = getMemoryPath(opts.memory);
    const initialSnapshot = getExtractionQueueSnapshotForRun(runId);
    writeExtractionRunStats(createInitialExtractionRunStats(runId, initialSnapshot.remaining));

    console.log(`${ui.t("runProxy")}: http://127.0.0.1:${port}`);
    console.log(`${ui.t("runMemory")}: ${memPath}`);
    console.log(`[Melu] run_id: ${runId}`);
    console.log("");

    await cleanupStaleProxyOnPort(port);

    const daemonEnv: NodeJS.ProcessEnv = {
      ...process.env,
      MELU_RUN_ID: runId,
      MELU_EMBEDDER_SOCKET: runtimeContext.embedderSocketPath,
      MELU_DAEMON_OWNER_PID: String(process.pid),
      MELU_DAEMON_IDLE_TIMEOUT_MS: String(30 * 60 * 1000),
    };
    const daemonChild = spawnMeluProcess("embedder-main.js", daemonEnv, true);

    await waitForEmbedderDaemonReady({
      runId,
      socketPath: runtimeContext.embedderSocketPath,
      timeoutMs: 120000,
    });

    const proxyChild = spawnMeluProcess(
      "proxy-main.js",
      {
        ...process.env,
        MELU_RUN_ID: runId,
        MELU_EMBEDDER_SOCKET: runtimeContext.embedderSocketPath,
        MELU_MEMORY_PATH: memPath,
        MELU_UPSTREAM_ANTHROPIC: resolveClaudeUpstreamBaseUrl(config.upstreamAnthropic),
      },
      true,
    );
    if (proxyChild.pid) {
      writeFileSync(PID_FILE, String(proxyChild.pid));
    }
    await waitForProxy(port, runId, 120000, config.uiLanguage);
    console.log(`[Melu] trace dashboard: http://127.0.0.1:${port}/__melu`);

    const workerChild = spawnMeluProcess(
      "extractor-worker-main.js",
      {
        ...process.env,
        MELU_RUN_ID: runId,
        MELU_OWNER_PID: String(process.pid),
        MELU_EMBEDDER_SOCKET: runtimeContext.embedderSocketPath,
        MELU_EMBEDDER_PID: daemonChild.pid ? String(daemonChild.pid) : undefined,
        MELU_MEMORY_PATH: memPath,
      },
      true,
    );
    void workerChild;

    const preparedCommand = prepareForegroundCommand(command, port);

    let finalized = false;
    let foregroundExitCode = 0;

    const finalizeRun = async (): Promise<void> => {
      if (finalized) return;
      finalized = true;
      preparedCommand.cleanup();
      terminateProcess(proxyChild.pid ?? null);
      clearProxyPidFile(proxyChild.pid ?? null);

      const snapshot = getExtractionQueueSnapshotForRun(runId);
      const stats = readExtractionRunStats(runId) ?? createInitialExtractionRunStats(runId, snapshot.remaining);
      writeExtractionRunStats({
        ...stats,
        remainingQueue: snapshot.remaining,
        updatedAt: new Date().toISOString(),
      });
      printRunSummary(ui, {
        runId,
        processed: stats.processed,
        effectiveNewMemories: stats.effectiveNewMemories,
        failed: stats.failed,
        remainingQueue: snapshot.remaining,
      });
      process.exitCode = foregroundExitCode;
    };

    const child = spawn(preparedCommand.command, preparedCommand.args, {
      env: preparedCommand.env,
      stdio: "inherit",
      shell: false,
    });

    child.on("exit", (code) => {
      foregroundExitCode = code ?? 0;
      void finalizeRun();
    });

    child.on("error", (error) => {
      console.error(`[Melu] 子命令启动失败: ${error.message}`);
      foregroundExitCode = 1;
      void finalizeRun();
    });

    const forwardSignal = (signal: NodeJS.Signals) => {
      try {
        child.kill(signal);
      } catch {
        // ignore
      }
    };

    process.on("SIGINT", () => forwardSignal("SIGINT"));
    process.on("SIGTERM", () => forwardSignal("SIGTERM"));
  });

// ── stop ─────────────────────────────────────────────────────────────

program
  .command("stop")
  .description(startupUi.t("cmdStopDescription"))
  .action(() => {
    const ui = createI18n(loadConfig().uiLanguage);
    const pid = readPid();
    if (pid === null) {
      console.log(ui.t("proxyNotRunning"));
      return;
    }

    try {
      process.kill(pid, "SIGTERM");
      console.log(ui.t("proxyStopped", { pid }));
    } catch {
      console.log(ui.t("proxyAlreadyGone"));
    }
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  });

// ── list ─────────────────────────────────────────────────────────────

program
  .command("list")
  .description(startupUi.t("cmdListDescription"))
  .option("-m, --memory <name>", startupUi.t("optMemoryDescription"))
  .option("-a, --all", startupUi.t("optAllDescription"), false)
  .action((opts: { memory?: string; all: boolean }) => {
    const ui = createI18n(loadConfig().uiLanguage);
    const memPath = getMemoryPath(opts.memory);
    if (!existsSync(memPath)) {
      console.log(ui.t("memoryFileNotFound", { path: memPath }));
      process.exit(1);
    }

    const store = new MemoryStore(memPath);
    store.open();
    const memories = store.listAll(opts.all);
    store.close();

    if (memories.length === 0) {
      console.log(ui.t("noMemories"));
      return;
    }

    console.log(`\n${ui.t("memoriesTitle", { count: memories.length })}\n`);
    console.log(
      padToDisplayWidth("ID", 12) +
      padToDisplayWidth(ui.t("tableType"), 14) +
      padToDisplayWidth(ui.t("tableSummary"), 50) +
      padToDisplayWidth(ui.t("tableCreatedAt"), 20) +
      ui.t("tableStatus")
    );
    console.log("-".repeat(100));

    for (const m of memories) {
      const status = m.isActive ? "✓" : "✗";
      console.log(
        padToDisplayWidth(m.id.slice(0, 10), 12) +
        padToDisplayWidth(m.category, 14) +
        padToDisplayWidth(truncateToDisplayWidth(m.summary, 46), 50) +
        padToDisplayWidth(m.createdAt.slice(0, 16), 20) +
        status
      );
    }

    console.log();
    console.log(ui.t("listShowHint"));
  });

// ── show ─────────────────────────────────────────────────────────────

program
  .command("show <id>")
  .description("显示一条记忆的完整信息")
  .option("-m, --memory <name>", startupUi.t("optMemoryDescription"))
  .action((id: string, opts: { memory?: string }) => {
    const memPath = getMemoryPath(opts.memory);
    if (!existsSync(memPath)) {
      console.log(`记忆文件不存在: ${memPath}`);
      process.exit(1);
    }

    const store = new MemoryStore(memPath);
    store.open();
    const all = store.listAll(true);
    const matched = all.filter((m) => m.id.startsWith(id));
    store.close();

    if (matched.length === 0) {
      console.log(`未找到 ID 前缀为 "${id}" 的记忆`);
      process.exit(1);
    }
    if (matched.length > 1) {
      console.log(`多条记忆匹配前缀 "${id}"，请提供更长的 ID：`);
      for (const m of matched) {
        console.log(`  ${m.id.slice(0, 12)}  ${m.summary}`);
      }
      process.exit(1);
    }

    const m = matched[0];
    console.log();
    console.log(`ID:       ${m.id}`);
    console.log(`类型:     ${m.category}`);
    console.log(`主题:     ${m.subject}`);
    console.log(`摘要:     ${m.summary}`);
    console.log(`内容:     ${m.content}`);
    console.log(`置信度:   ${m.confidence}`);
    console.log(`状态:     ${m.isActive ? "活跃" : "已停用"}`);
    console.log(`创建时间: ${m.createdAt}`);
    console.log(`更新时间: ${m.updatedAt}`);
    if (m.supersedes) {
      console.log(`替代:     ${m.supersedes}`);
    }
    console.log();
  });

// ── delete ───────────────────────────────────────────────────────────

program
  .command("delete <id>")
  .description(startupUi.t("cmdDeleteDescription"))
  .option("-m, --memory <name>", startupUi.t("optMemoryDescription"))
  .action((id: string, opts: { memory?: string }) => {
    const ui = createI18n(loadConfig().uiLanguage);
    const memPath = getMemoryPath(opts.memory);
    const store = new MemoryStore(memPath);
    store.open();

    const all = store.listAll(true);
    const matched = all.filter((m) => m.id.startsWith(id));

    if (matched.length === 0) {
      console.log(ui.t("memoryNotFoundByPrefix", { id }));
      store.close();
      process.exit(1);
    }
    if (matched.length > 1) {
      console.log(ui.t("multipleMemoryMatches"));
      store.close();
      process.exit(1);
    }

    store.delete(matched[0].id);
    store.close();
    console.log(ui.t("deletedMemory", { summary: matched[0].summary }));
  });

// ── clear ────────────────────────────────────────────────────────────

program
  .command("clear")
  .description(startupUi.t("cmdClearDescription"))
  .option("-m, --memory <name>", startupUi.t("optMemoryDescription"))
  .option("-y, --yes", startupUi.t("optYesDescription"), false)
  .action(async (opts: { memory?: string; yes: boolean }) => {
    const ui = createI18n(loadConfig().uiLanguage);
    const memPath = getMemoryPath(opts.memory);
    const store = new MemoryStore(memPath);
    store.open();
    const count = store.countActive();

    if (count === 0) {
      console.log(ui.t("memoryAlreadyEmpty"));
      store.close();
      return;
    }

    if (!opts.yes) {
      const readline = await import("node:readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) =>
        rl.question(ui.t("confirmClearMemories", { count }), resolve)
      );
      rl.close();
      if (answer.toLowerCase() !== "y") {
        store.close();
        return;
      }
    }

    const deleted = store.clear();
    store.close();
    console.log(ui.t("clearedMemories", { count: deleted }));
  });

// ── export ───────────────────────────────────────────────────────────

program
  .command("export")
  .description(startupUi.t("cmdExportDescription"))
  .requiredOption("-o, --output <path>", startupUi.t("optOutputDescription"))
  .option("-m, --memory <name>", startupUi.t("optMemoryDescription"))
  .action(async (opts: { output: string; memory?: string }) => {
    const ui = createI18n(loadConfig().uiLanguage);
    const memPath = getMemoryPath(opts.memory);
    const store = new MemoryStore(memPath);
    store.open();
    let dest = resolve(opts.output);
    if (!dest.endsWith(".memory")) dest += ".memory";
    try {
      await store.exportTo(dest);
      console.log(ui.t("exportedTo", { path: dest }));
    } finally {
      store.close();
    }
  });

// ── import ───────────────────────────────────────────────────────────

program
  .command("import <source>")
  .description(startupUi.t("cmdImportDescription"))
  .option("-m, --memory <name>", startupUi.t("optMemoryDescription"))
  .action((source: string, opts: { memory?: string }) => {
    const ui = createI18n(loadConfig().uiLanguage);
    const src = resolve(source);
    if (!existsSync(src)) {
      console.log(ui.t("sourceFileNotFound", { path: src }));
      process.exit(1);
    }

    const memPath = getMemoryPath(opts.memory);
    const store = new MemoryStore(memPath);
    store.open();
    const count = store.importFrom(src);
    store.close();
    console.log(ui.t("importedMemories", { count }));
  });

// ── status ───────────────────────────────────────────────────────────

program
  .command("status")
  .description(startupUi.t("cmdStatusDescription"))
  .option("-m, --memory <name>", startupUi.t("optMemoryDescription"))
  .action((opts: { memory?: string }) => {
    const config = loadConfig();
    const ui = createI18n(config.uiLanguage);

    const pid = readPid();
    if (pid !== null && isProcessAlive(pid)) {
      console.log(ui.t("statusRunning", { pid, port: config.port }));
    } else {
      console.log(ui.t("statusStopped"));
    }

    const memPath = getMemoryPath(opts.memory);
    if (existsSync(memPath)) {
      const store = new MemoryStore(memPath);
      store.open();
      const count = store.countActive();
      store.close();
      console.log(ui.t("statusMemoryFile", { path: memPath }));
      console.log(ui.t("statusActiveMemories", { count }));
    } else {
      console.log(ui.t("memoryFileNotFound", { path: memPath }));
    }

    console.log(ui.t("statusEmbedding", { model: config.embeddingModel }));
    console.log(ui.t("statusMirrorSource", { label: getMirrorLabel(config.mirror, config.uiLanguage) }));
    console.log(ui.t("statusModelFile", { status: hasEmbeddingModel() ? ui.t("statusDownloaded") : ui.t("statusNotDownloaded") }));
  });

// ── 内部工具 ─────────────────────────────────────────────────────────

function waitForProxy(
  port: number,
  expectedRunId: string,
  timeout = 10000,
  language: MeluConfig["uiLanguage"] = null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ui = createI18n(language);
    const start = Date.now();

    const tryConnect = async () => {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/__melu/events`, { cache: "no-store" });
        if (resp.ok) {
          const payload = (await resp.json()) as { runId?: string };
          if (payload.runId === expectedRunId) {
            resolve();
            return;
          }
        }
      } catch {
        // keep polling below
      }

      if (Date.now() - start > timeout) {
        reject(new Error(ui.t("proxyStartupTimeout")));
        return;
      }
      setTimeout(() => {
        void tryConnect();
      }, 300);
    };
    void tryConnect();
  });
}

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    return parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: "127.0.0.1", port }, () => {
      sock.destroy();
      resolve(true); // 端口有人用
    });
    sock.on("error", () => {
      resolve(false); // 端口空闲
    });
  });
}

function listListeningPidsForPort(port: number): number[] {
  try {
    const output = execFileSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf-8" },
    ).trim();
    if (!output) return [];
    return output
      .split(/\s+/)
      .map((value) => parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

function readProcessCommand(pid: number): string {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function isMeluProxyProcess(pid: number): boolean {
  const command = readProcessCommand(pid);
  return command.includes("proxy-main.js") && command.includes("melu");
}

async function cleanupStaleProxyOnPort(port: number): Promise<void> {
  const pidFromFile = readPid();
  if (pidFromFile !== null && isProcessAlive(pidFromFile)) {
    return;
  }

  const candidatePids = listListeningPidsForPort(port);
  if (!candidatePids.length) {
    clearProxyPidFile();
    return;
  }

  let killedAny = false;
  for (const pid of candidatePids) {
    if (!isMeluProxyProcess(pid)) continue;
    console.warn(`[Melu] 清理遗留 proxy 进程: pid=${pid}, port=${port}`);
    terminateProcess(pid);
    killedAny = true;
  }

  if (killedAny) {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const occupied = await checkPort(port);
      if (!occupied) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  clearProxyPidFile();
}

function stopProxy(): void {
  const pid = readPid();
  terminateProcess(pid);
  clearProxyPidFile(pid);
}

async function prepareEmbedding(
  config: MeluConfig,
  options: {
    interactive: boolean;
    mirror?: string | null;
    showDownloadProgress: boolean;
  },
): Promise<MeluConfig> {
  const preparedConfig = { ...config };
  await ensureEmbeddingRuntimeAvailable(preparedConfig.uiLanguage);
  const result = await ensureEmbeddingModelReady({
    config: preparedConfig,
    interactive: options.interactive,
    preferredMirror: options.mirror,
    showProgress: options.showDownloadProgress,
  });
  return result.config;
}

function spawnMeluProcess(
  entrypointFile: string,
  env: NodeJS.ProcessEnv,
  detached = false,
): ReturnType<typeof spawn> {
  const child = spawn(process.execPath, [resolve(import.meta.dirname ?? ".", entrypointFile)], {
    env,
    cwd: resolve(import.meta.dirname ?? "."),
    detached,
    stdio: detached ? ["ignore", "ignore", "ignore"] : "inherit",
  });

  if (detached) {
    child.unref();
  }

  return child;
}

function truncateToDisplayWidth(text: string, maxWidth: number, suffix = "…"): string {
  if (maxWidth <= 0) return "";

  const trimmed = text.trim();
  if (getDisplayWidth(trimmed) <= maxWidth) {
    return trimmed;
  }

  const suffixWidth = getDisplayWidth(suffix);
  if (suffixWidth >= maxWidth) {
    return trimToDisplayWidth(trimmed, maxWidth);
  }

  return `${trimToDisplayWidth(trimmed, maxWidth - suffixWidth)}${suffix}`;
}

function padToDisplayWidth(text: string, width: number): string {
  const visibleWidth = getDisplayWidth(text);
  if (visibleWidth >= width) {
    return text;
  }

  return text + " ".repeat(width - visibleWidth);
}

function trimToDisplayWidth(text: string, maxWidth: number): string {
  let visibleWidth = 0;
  let result = "";

  for (const char of Array.from(text)) {
    const charWidth = getCharacterDisplayWidth(char);
    if (visibleWidth + charWidth > maxWidth) {
      break;
    }
    result += char;
    visibleWidth += charWidth;
  }

  return result;
}

function getDisplayWidth(text: string): number {
  let width = 0;

  for (const char of Array.from(text)) {
    width += getCharacterDisplayWidth(char);
  }

  return width;
}

function getCharacterDisplayWidth(char: string): number {
  const codePoint = char.codePointAt(0);
  if (codePoint == null) return 0;
  if (
    codePoint === 0 ||
    codePoint < 0x20 ||
    (codePoint >= 0x7f && codePoint < 0xa0)
  ) {
    return 0;
  }

  if (
    codePoint >= 0x1100 && (
      codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
      (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    )
  ) {
    return 2;
  }

  return 1;
}

function printRunSummary(
  ui: ReturnType<typeof createI18n>,
  stats: {
  runId: string;
  processed: number;
  effectiveNewMemories: number;
  failed: number;
  remainingQueue: number;
}): void {
  console.log("");
  console.log(ui.t("runSummaryTitle", { runId: stats.runId }));
  console.log(ui.t("runSummaryProcessed", { count: stats.processed }));
  console.log(ui.t("runSummaryEffectiveNewMemories", { count: stats.effectiveNewMemories }));
  console.log(ui.t("runSummaryFailed", { count: stats.failed }));
  console.log(ui.t("runSummaryRemainingQueue", { count: stats.remainingQueue }));
}

function terminateProcess(pid: number | null | undefined): void {
  if (!Number.isInteger(pid) || (pid ?? 0) <= 0) {
    return;
  }

  try {
    process.kill(pid as number, "SIGTERM");
  } catch {
    // Ignore missing child processes.
  }
}

function clearProxyPidFile(expectedPid?: number | null): void {
  const currentPid = readPid();
  if (currentPid === null) return;
  if (expectedPid && currentPid !== expectedPid) return;

  try {
    unlinkSync(PID_FILE);
  } catch {
    // Ignore cleanup failures.
  }
}

function prepareForegroundCommand(command: string[], port: number): PreparedForegroundCommand {
  const env = { ...process.env };
  env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;

  if (command.length === 0) {
    throw new Error("Missing foreground command");
  }

  const executableName = basename(command[0]);
  if (executableName !== "claude") {
    return {
      command: command[0],
      args: command.slice(1),
      env,
      cleanup: () => {
        // No-op for non-Claude commands.
      },
    };
  }

  const existingArgs = command.slice(1);
  if (containsClaudeSettingsFlag(existingArgs)) {
    return {
      command: command[0],
      args: existingArgs,
      env,
      cleanup: () => {
        // No-op when the caller explicitly controls Claude settings.
      },
    };
  }

  const tempDir = mkdtempSync(join(tmpdir(), "melu-claude-settings-"));
  const tempSettingsPath = join(tempDir, "settings.json");
  const userSettings = readClaudeUserSettings();
  const settingsEnv = normalizeSettingsEnv(userSettings?.env);

  // Preserve the user's current auth/provider settings while forcing Claude
  // itself to talk to the Melu proxy for this run only.
  settingsEnv.ANTHROPIC_BASE_URL = env.ANTHROPIC_BASE_URL;

  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    settingsEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.ANTHROPIC_AUTH_TOKEN?.trim()) {
    settingsEnv.ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;
  }

  const tempSettings: ClaudeSettingsFile = {
    ...(userSettings ?? {}),
    env: settingsEnv,
  };
  writeFileSync(tempSettingsPath, JSON.stringify(tempSettings, null, 2), "utf-8");

  return {
    command: command[0],
    args: ["--setting-sources", "project,local", "--settings", tempSettingsPath, ...existingArgs],
    env,
    cleanup: () => {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore temporary settings cleanup failures.
      }
    },
  };
}

function containsClaudeSettingsFlag(args: string[]): boolean {
  return args.some(
    (arg) =>
      arg === "--settings" ||
      arg.startsWith("--settings=") ||
      arg === "--setting-sources" ||
      arg.startsWith("--setting-sources="),
  );
}

function readClaudeUserSettings(): ClaudeSettingsFile | null {
  if (!CLAUDE_USER_SETTINGS_PATH || !existsSync(CLAUDE_USER_SETTINGS_PATH)) {
    return null;
  }

  try {
    const raw = readFileSync(CLAUDE_USER_SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as ClaudeSettingsFile;
  } catch {
    return null;
  }
}

function normalizeSettingsEnv(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (rawValue === undefined || rawValue === null) continue;
    result[key] = String(rawValue);
  }
  return result;
}

function resolveClaudeUpstreamBaseUrl(fallback: string): string {
  const processValue = process.env.ANTHROPIC_BASE_URL?.trim();
  if (processValue) {
    return processValue;
  }

  const userSettings = readClaudeUserSettings();
  const settingsValue = normalizeSettingsEnv(userSettings?.env).ANTHROPIC_BASE_URL?.trim();
  if (settingsValue) {
    return settingsValue;
  }

  return fallback;
}

// ── 启动 ─────────────────────────────────────────────────────────────

program.parse();
