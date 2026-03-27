#!/usr/bin/env node

/**
 * Melu CLI 入口。
 *
 * 命令：init / run / stop / list / delete / clear / export / import / status
 */

import { Command } from "commander";
import { select } from "@inquirer/prompts";
import { execFileSync, spawn, type StdioOptions } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";
import {
  MELU_HOME,
  CONFIG_FILE,
  PID_FILE,
  DEFAULT_PORT,
  ensureDirs,
  hasEmbeddingModel,
  loadConfig,
  saveConfig,
  getMemoryPath,
  isMirrorName,
  isUiLanguage,
  type MirrorName,
  type UiLanguage,
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
  promptForMirrorSelection,
  promptForUiLanguageSelection,
  getMirrorLabel,
} from "./model-bootstrap.js";
import { createI18n, getUiLanguageLabel } from "./i18n.js";
import { waitForEmbedderDaemonReady } from "./embedder-client.js";
import { createRunId } from "./run-runtime.js";
import { createMeluRuntimeContext } from "./runtime-context.js";

const startupUi = createI18n(loadConfig().uiLanguage);
const program = new Command();
const CLAUDE_USER_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

interface ClaudeSettingsFile {
  env?: Record<string, unknown>;
  [key: string]: unknown;
}

interface PreparedForegroundCommand {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  shell: boolean;
  cleanup: () => void;
}

interface MeluChildProcessOptions {
  detached?: boolean;
  logPath?: string;
}

function isChineseLike(language: UiLanguage | null | undefined): boolean {
  return language === "zh-CN" || language === "zh-TW";
}

function cliText(language: UiLanguage | null | undefined, en: string, zh: string): string {
  return isChineseLike(language) ? zh : en;
}

function parseOptionalUiLanguage(value: string | undefined): UiLanguage | null {
  if (!value) return null;
  if (isUiLanguage(value)) return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh_cn" || normalized === "cn") return "zh-CN";
  if (normalized === "zh-tw" || normalized === "zh_tw" || normalized === "tw") return "zh-TW";
  if (normalized === "jp") return "ja";
  if (normalized === "kr") return "ko";
  if (normalized === "english") return "en";
  if (normalized === "japanese") return "ja";
  if (normalized === "korean") return "ko";
  if (normalized === "french") return "fr";
  if (normalized === "russian") return "ru";
  if (normalized === "german") return "de";
  if (normalized === "spanish") return "es";
  if (normalized === "portuguese") return "pt";
  return isUiLanguage(normalized) ? normalized : null;
}

function parseOptionalMirror(value: string | undefined): MirrorName | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return isMirrorName(normalized) ? normalized : null;
}

function parseOptionalMemoryEnabled(value: string | undefined): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "on", "true", "enable", "enabled", "yes", "y"].includes(normalized)) return true;
  if (["0", "off", "false", "disable", "disabled", "no", "n"].includes(normalized)) return false;
  return null;
}

function printConfigSummary(config: MeluConfig): void {
  const ui = createI18n(config.uiLanguage);
  console.log(cliText(config.uiLanguage, "Config:", "配置:") + ` ${CONFIG_FILE}`);
  console.log(cliText(config.uiLanguage, "Language:", "语言:") + ` ${getUiLanguageLabel(config.uiLanguage ?? "en")}`);
  console.log(cliText(config.uiLanguage, "Mirror:", "下载源:") + ` ${getMirrorLabel(config.mirror, config.uiLanguage)}`);
  console.log(
    cliText(config.uiLanguage, "Memory loading:", "记忆加载:")
    + ` ${config.memoryEnabled ? cliText(config.uiLanguage, "enabled", "开启") : cliText(config.uiLanguage, "disabled", "关闭")}`,
  );
  if (!config.memoryEnabled) {
    console.log(cliText(
      config.uiLanguage,
      "Applies to the next `melu run`: memory injection, extraction, and embedder startup will be skipped.",
      "对下一次 `melu run` 生效：将跳过记忆注入、记忆提取和 embedding daemon 启动。",
    ));
  }
  console.log(
    cliText(config.uiLanguage, "Auto-open dashboard:", "自动打开观察台:")
    + ` ${config.autoOpenDashboard ? cliText(config.uiLanguage, "enabled", "开启") : cliText(config.uiLanguage, "disabled", "关闭")}`,
  );
  console.log(cliText(config.uiLanguage, "Model:", "模型:") + ` ${config.embeddingModel}`);
  console.log(cliText(config.uiLanguage, "Model file:", "模型文件:") + ` ${hasEmbeddingModel() ? ui.t("statusDownloaded") : ui.t("statusNotDownloaded")}`);
}

async function promptForMemoryLoadingSelection(
  language: UiLanguage | null | undefined,
  currentValue: boolean,
): Promise<boolean> {
  try {
    return await select<boolean>({
      message: cliText(
        language,
        "Load runtime memories by default?",
        "是否默认加载运行记忆？",
      ),
      default: currentValue,
      choices: [
        {
          value: true,
          name: cliText(language, "Yes, enable memory", "是，开启记忆"),
          description: cliText(
            language,
            "Melu will prepare the embedding model and enable retrieval / extraction on future runs.",
            "Melu 会准备 embedding 模型，并在后续运行中启用检索 / 提取。",
          ),
        },
        {
          value: false,
          name: cliText(language, "No, skip memory for now", "否，暂不启用记忆"),
          description: cliText(
            language,
            "Skip model download now. You can enable it later from settings or `melu config memory on`.",
            "现在跳过模型下载。之后可在设置页或 `melu config memory on` 中开启。",
          ),
        },
      ],
    });
  } catch (error) {
    handlePromptAbort(error);
  }
}

function handlePromptAbort(error: unknown): never {
  if (
    error &&
    typeof error === "object" &&
    (
      ("code" in error && error.code === "ABORT_ERR")
      || ("name" in error && (error.name === "AbortPromptError" || error.name === "ExitPromptError"))
    )
  ) {
    console.log("");
    process.exit(130);
  }

  throw error;
}

function ensureDefaultMemoryFile(): string {
  const memPath = getMemoryPath();
  const store = new MemoryStore(memPath);
  store.open();
  if (!store.getMeta("name")) {
    store.setMeta("name", "default");
  }
  if (!store.getMeta("created_at")) {
    store.setMeta("created_at", new Date().toISOString());
  }
  store.close();
  return memPath;
}

async function runInitialSetupFlow(
  config: MeluConfig,
  options: {
    interactive: boolean;
    mirror?: string;
    showDownloadProgress: boolean;
  },
): Promise<{ config: MeluConfig; memoryPath: string }> {
  const ui = createI18n(config.uiLanguage);

  console.log(ui.t("initTitle"));

  ensureDirs();
  console.log(`  ${ui.t("labelDirectory")}: ${MELU_HOME}`);

  const nextMirror = parseOptionalMirror(options.mirror);
  if (options.mirror && !nextMirror) {
    console.error(cliText(config.uiLanguage, "Invalid mirror. Use huggingface or modelscope.", "无效下载源。请使用 huggingface 或 modelscope。"));
    process.exit(1);
  }
  if (nextMirror) {
    config.mirror = nextMirror;
  }

  if (options.interactive && process.stdin.isTTY && process.stdout.isTTY) {
    config.memoryEnabled = await promptForMemoryLoadingSelection(config.uiLanguage, config.memoryEnabled);
  }

  const preparedConfig = config.memoryEnabled
    ? await prepareEmbedding(config, {
      interactive: options.interactive,
      mirror: options.mirror,
      showDownloadProgress: options.showDownloadProgress,
    })
    : config;
  saveConfig(preparedConfig);
  console.log(`  ${ui.t("labelConfig")}: ${MELU_HOME}/config.json`);

  const memPath = ensureDefaultMemoryFile();
  console.log(`  ${ui.t("labelMemory")}: ${memPath}`);

  console.log("");
  console.log(ui.t("initComplete"));
  console.log(`  ${ui.t("labelMirrorSource")}: ${getMirrorLabel(preparedConfig.mirror, preparedConfig.uiLanguage)}`);
  if (preparedConfig.memoryEnabled) {
    console.log(`  ${ui.t("embeddingModelReady")}`);
  } else {
    console.log(cliText(preparedConfig.uiLanguage, "  Runtime memory remains disabled; model download skipped.", "  运行记忆保持关闭，已跳过模型下载。"));
  }
  console.log(`  ${ui.t("usageRunClaude")}`);

  return {
    config: preparedConfig,
    memoryPath: memPath,
  };
}

function ensureRunLogDir(runId: string): string {
  const dir = join(MELU_HOME, "run-logs", runId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readChildLogTail(logPath: string, maxChars = 4000): string | null {
  if (!existsSync(logPath)) return null;
  try {
    const raw = readFileSync(logPath, "utf-8");
    if (!raw) return null;
    return raw.length <= maxChars ? raw : raw.slice(-maxChars);
  } catch {
    return null;
  }
}

function decorateStartupFailure(error: Error, label: string, logPath?: string): Error {
  if (!logPath) return error;
  const logTail = readChildLogTail(logPath);
  if (!logTail) {
    return new Error(`${error.message}\n[Melu] ${label} log: ${logPath}`);
  }

  return new Error(`${error.message}\n[Melu] ${label} log: ${logPath}\n${logTail}`);
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
    await runInitialSetupFlow(config, {
      interactive: true,
      mirror: opts.mirror,
      showDownloadProgress: true,
    });
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
    const hadConfigFile = existsSync(CONFIG_FILE);
    let config = loadConfig();
    config = await ensureUiLanguageConfigured(config, { interactive: true });
    const ui = createI18n(config.uiLanguage);
    const port = parseInt(opts.port, 10) || config.port;
    config.port = port;

    if (!hadConfigFile) {
      const setupResult = await runInitialSetupFlow(config, {
        interactive: true,
        mirror: opts.mirror,
        showDownloadProgress: true,
      });
      config = setupResult.config;
    }

    const runId = createRunId();
    const runtimeContext = createMeluRuntimeContext(runId);
    const runLogDir = ensureRunLogDir(runId);
    preparePendingExtractionQueueForRun(runId);

    if (hadConfigFile && config.memoryEnabled) {
      config = await prepareEmbedding(config, {
        interactive: true,
        mirror: opts.mirror,
        showDownloadProgress: !hasEmbeddingModel(),
      });
    } else if (hadConfigFile && opts.mirror) {
      const nextMirror = parseOptionalMirror(opts.mirror);
      if (!nextMirror) {
        console.error(cliText(config.uiLanguage, "Invalid mirror. Use huggingface or modelscope.", "无效下载源。请使用 huggingface 或 modelscope。"));
        process.exit(1);
      }
      config = { ...config, mirror: nextMirror };
      saveConfig(config);
    }

    const memPath = getMemoryPath(opts.memory);
    const initialSnapshot = getExtractionQueueSnapshotForRun(runId);
    writeExtractionRunStats(createInitialExtractionRunStats(runId, initialSnapshot.remaining));

    console.log(`${ui.t("runProxy")}: http://127.0.0.1:${port}`);
    console.log(`${ui.t("runMemory")}: ${memPath}`);
    if (!config.memoryEnabled) {
      console.log(cliText(config.uiLanguage, "[Melu] Memory loading is disabled for this run.", "[Melu] 本次运行已关闭记忆加载。"));
    }
    console.log(`[Melu] run_id: ${runId}`);
    console.log("");

    await cleanupStaleProxyOnPort(port);

    const daemonChild = config.memoryEnabled
      ? spawnMeluProcess("embedder-main.js", {
        ...process.env,
        MELU_RUN_ID: runId,
        MELU_EMBEDDER_SOCKET: runtimeContext.embedderSocketPath,
        MELU_DAEMON_OWNER_PID: String(process.pid),
        MELU_DAEMON_IDLE_TIMEOUT_MS: String(30 * 60 * 1000),
      }, { detached: true, logPath: join(runLogDir, "embedder.log") })
      : null;
    let daemonStartFailure: Error | null = null;
    if (daemonChild) {
      daemonChild.once("error", (error) => {
        daemonStartFailure = error instanceof Error
          ? error
          : new Error(String(error));
      });
      daemonChild.once("exit", (code, signal) => {
        if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") return;
        daemonStartFailure = new Error(
          `[Melu] Embedder daemon exited before becoming ready (code=${code ?? "null"}, signal=${signal ?? "null"})`,
        );
      });
    }

    if (config.memoryEnabled) {
      try {
        await waitForEmbedderDaemonReady({
          runId,
          socketPath: runtimeContext.embedderSocketPath,
          timeoutMs: 120000,
        });
      } catch (error) {
        throw decorateStartupFailure(
          daemonStartFailure ?? (error instanceof Error ? error : new Error(String(error))),
          "Embedder daemon",
          join(runLogDir, "embedder.log"),
        );
      }
    }

    const proxyChild = spawnMeluProcess(
      "proxy-main.js",
      {
        ...process.env,
        MELU_RUN_ID: runId,
        MELU_PROXY_PORT: String(port),
        MELU_EMBEDDER_SOCKET: runtimeContext.embedderSocketPath,
        MELU_MEMORY_PATH: memPath,
        MELU_UPSTREAM_ANTHROPIC: resolveClaudeUpstreamBaseUrl(config.upstreamAnthropic),
      },
      { detached: true, logPath: join(runLogDir, "proxy.log") },
    );
    if (proxyChild.pid) {
      writeFileSync(PID_FILE, String(proxyChild.pid));
    }
    let proxyStartFailure: Error | null = null;
    proxyChild.once("error", (error) => {
      proxyStartFailure = error instanceof Error
        ? error
        : new Error(String(error));
    });
    proxyChild.once("exit", (code, signal) => {
      if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") return;
      proxyStartFailure = new Error(
        `[Melu] Proxy exited before becoming ready (code=${code ?? "null"}, signal=${signal ?? "null"})`,
      );
    });
    try {
      await waitForProxy(port, runId, 120000, config.uiLanguage);
    } catch (error) {
      throw decorateStartupFailure(
        proxyStartFailure ?? (error instanceof Error ? error : new Error(String(error))),
        "Proxy",
        join(runLogDir, "proxy.log"),
      );
    }
    const dashboardUrl = `http://127.0.0.1:${port}/__melu`;
    console.log(`[Melu] trace dashboard: ${dashboardUrl}`);
    if (config.autoOpenDashboard) {
      openDashboardInBrowser(dashboardUrl, config.uiLanguage);
    }

    if (config.memoryEnabled) {
      const workerChild = spawnMeluProcess(
        "extractor-worker-main.js",
        {
          ...process.env,
          MELU_RUN_ID: runId,
          MELU_OWNER_PID: String(process.pid),
          MELU_EMBEDDER_SOCKET: runtimeContext.embedderSocketPath,
          MELU_EMBEDDER_PID: daemonChild && daemonChild.pid ? String(daemonChild.pid) : undefined,
          MELU_MEMORY_PATH: memPath,
        },
        { detached: true, logPath: join(runLogDir, "extractor.log") },
      );
      void workerChild;
    }

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
      shell: preparedCommand.shell,
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
    console.log(
      cliText(config.uiLanguage, "Memory loading:", "记忆加载:")
      + ` ${config.memoryEnabled ? cliText(config.uiLanguage, "enabled", "开启") : cliText(config.uiLanguage, "disabled", "关闭")}`,
    );
    console.log(
      cliText(config.uiLanguage, "Auto-open dashboard:", "自动打开观察台:")
      + ` ${config.autoOpenDashboard ? cliText(config.uiLanguage, "enabled", "开启") : cliText(config.uiLanguage, "disabled", "关闭")}`,
    );
  });

// ── config ───────────────────────────────────────────────────────────

const configCommand = program
  .command("config")
  .description(cliText(startupUi.language, "View or update persistent Melu settings", "查看或修改 Melu 持久配置"));

configCommand
  .command("show")
  .description(cliText(startupUi.language, "Show current config", "显示当前配置"))
  .action(() => {
    printConfigSummary(loadConfig());
  });

configCommand
  .command("language")
  .description(cliText(startupUi.language, "Set display language", "设置显示语言"))
  .argument("[language]", cliText(startupUi.language, "Language code, e.g. zh-CN", "语言代码，例如 zh-CN"))
  .action(async (languageArg?: string) => {
    const config = loadConfig();
    let nextLanguage = parseOptionalUiLanguage(languageArg);

    if (!nextLanguage) {
      if (languageArg) {
        console.error(cliText(config.uiLanguage, "Invalid language. Example: en, zh-CN, ja", "无效语言。示例：en、zh-CN、ja"));
        process.exit(1);
      }
      nextLanguage = await promptForUiLanguageSelection(config.uiLanguage ?? "en");
    }

    const nextConfig = { ...config, uiLanguage: nextLanguage };
    saveConfig(nextConfig);
    console.log(cliText(nextConfig.uiLanguage, "Language updated:", "语言已更新:") + ` ${getUiLanguageLabel(nextLanguage)}`);
  });

configCommand
  .command("mirror")
  .description(cliText(startupUi.language, "Set model download source", "设置模型下载源"))
  .argument("[mirror]", "huggingface | modelscope")
  .action(async (mirrorArg?: string) => {
    const config = loadConfig();
    let nextMirror = parseOptionalMirror(mirrorArg);

    if (!nextMirror) {
      if (mirrorArg) {
        console.error(cliText(config.uiLanguage, "Invalid mirror. Use huggingface or modelscope.", "无效下载源。请使用 huggingface 或 modelscope。"));
        process.exit(1);
      }
      nextMirror = await promptForMirrorSelection(config.uiLanguage ?? "en");
    }

    const nextConfig = { ...config, mirror: nextMirror };
    saveConfig(nextConfig);
    console.log(cliText(nextConfig.uiLanguage, "Mirror updated:", "下载源已更新:") + ` ${getMirrorLabel(nextMirror, nextConfig.uiLanguage)}`);
  });

configCommand
  .command("memory")
  .description(cliText(startupUi.language, "Enable or disable memory loading for future runs", "为后续运行开启或关闭记忆加载"))
  .argument("[state]", "on | off")
  .action((stateArg?: string) => {
    const config = loadConfig();
    const parsedState = parseOptionalMemoryEnabled(stateArg);
    if (stateArg && parsedState === null) {
      console.error(cliText(config.uiLanguage, "Invalid state. Use on or off.", "无效状态。请使用 on 或 off。"));
      process.exit(1);
    }

    const nextState = parsedState === null ? !config.memoryEnabled : parsedState;
    const nextConfig = { ...config, memoryEnabled: nextState };
    saveConfig(nextConfig);
    console.log(
      cliText(nextConfig.uiLanguage, "Memory loading:", "记忆加载:")
      + ` ${nextState ? cliText(nextConfig.uiLanguage, "enabled", "开启") : cliText(nextConfig.uiLanguage, "disabled", "关闭")}`,
    );
    console.log(cliText(
      nextConfig.uiLanguage,
      "This takes effect on the next `melu run`.",
      "这会在下一次 `melu run` 时生效。",
    ));
  });

configCommand
  .command("dashboard")
  .description(cliText(startupUi.language, "Enable or disable automatic dashboard opening on future runs", "为后续运行开启或关闭观察台自动打开"))
  .argument("[state]", "on | off")
  .action((stateArg?: string) => {
    const config = loadConfig();
    const parsedState = parseOptionalMemoryEnabled(stateArg);
    if (stateArg && parsedState === null) {
      console.error(cliText(config.uiLanguage, "Invalid state. Use on or off.", "无效状态。请使用 on 或 off。"));
      process.exit(1);
    }

    const nextState = parsedState === null ? !config.autoOpenDashboard : parsedState;
    const nextConfig = { ...config, autoOpenDashboard: nextState };
    saveConfig(nextConfig);
    console.log(
      cliText(nextConfig.uiLanguage, "Auto-open dashboard:", "自动打开观察台:")
      + ` ${nextState ? cliText(nextConfig.uiLanguage, "enabled", "开启") : cliText(nextConfig.uiLanguage, "disabled", "关闭")}`,
    );
    console.log(cliText(
      nextConfig.uiLanguage,
      "This takes effect on the next `melu run`.",
      "这会在下一次 `melu run` 时生效。",
    ));
  });

// ── 内部工具 ─────────────────────────────────────────────────────────

function openDashboardInBrowser(
  url: string,
  language: UiLanguage | null | undefined,
): void {
  if (process.env.MELU_NO_AUTO_OPEN === "1") {
    return;
  }

  try {
    let child: ReturnType<typeof spawn>;
    if (process.platform === "darwin") {
      child = spawn("open", [url], { stdio: "ignore", detached: true });
    } else if (process.platform === "win32") {
      child = spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true });
    } else {
      child = spawn("xdg-open", [url], { stdio: "ignore", detached: true });
    }
    child.unref();
  } catch (error) {
    console.warn(
      cliText(language, "[Melu] Failed to auto-open dashboard:", "[Melu] 自动打开观察台失败:"),
      error instanceof Error ? error.message : String(error),
    );
  }
}

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
          if (payload.runId) {
            reject(new Error(
              cliText(
                language,
                `[Melu] Another Melu proxy is already serving port ${port} (run_id: ${payload.runId}).`,
                `[Melu] 端口 ${port} 上已有另一个 Melu proxy 在运行 (run_id: ${payload.runId})。`,
              ),
            ));
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
  if (process.platform === "win32") {
    try {
      const output = execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf-8" });
      const pids = new Set<number>();
      for (const rawLine of output.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const parts = line.split(/\s+/);
        if (parts.length < 5) continue;
        const protocol = parts[0].toUpperCase();
        const localAddress = parts[1];
        const state = parts[3].toUpperCase();
        const pid = Number.parseInt(parts[4], 10);
        if (protocol !== "TCP" || state !== "LISTENING" || !Number.isInteger(pid) || pid <= 0) continue;
        if (!localAddress.endsWith(`:${port}`)) continue;
        pids.add(pid);
      }
      return Array.from(pids);
    } catch {
      return [];
    }
  }

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
  if (process.platform === "win32") {
    try {
      return execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
        ],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
    } catch {
      return "";
    }
  }

  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

async function readRunningProxyRunId(port: number): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 500);
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/__melu/events`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!resp.ok) return null;
      const payload = (await resp.json()) as { runId?: string };
      return typeof payload.runId === "string" && payload.runId.trim() ? payload.runId : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

async function waitForPortToClear(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const occupied = await checkPort(port);
    if (!occupied) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return !(await checkPort(port));
}

function isMeluProxyProcess(pid: number): boolean {
  const command = readProcessCommand(pid);
  return command.includes("proxy-main.js") && command.includes("melu");
}

async function cleanupStaleProxyOnPort(port: number): Promise<void> {
  const pidFromFile = readPid();
  const existingRunId = await readRunningProxyRunId(port);

  let killedAny = false;
  if (pidFromFile !== null && isProcessAlive(pidFromFile) && existingRunId) {
    console.warn(`[Melu] 清理遗留 proxy 进程: pid=${pidFromFile}, port=${port}, run_id=${existingRunId}`);
    terminateProcess(pidFromFile);
    killedAny = true;
  }

  const candidatePids = listListeningPidsForPort(port);
  if (!candidatePids.length) {
    if (killedAny) {
      await waitForPortToClear(port, 4000);
    }
    clearProxyPidFile();
    return;
  }

  for (const pid of candidatePids) {
    if (pid === pidFromFile && killedAny) continue;
    if (!existingRunId && !isMeluProxyProcess(pid)) continue;
    console.warn(`[Melu] 清理遗留 proxy 进程: pid=${pid}, port=${port}${existingRunId ? `, run_id=${existingRunId}` : ""}`);
    terminateProcess(pid);
    killedAny = true;
  }

  if (killedAny) {
    const cleared = await waitForPortToClear(port, 4000);
    if (!cleared) {
      throw new Error(cliText(
        loadConfig().uiLanguage,
        `[Melu] Port ${port} is still occupied after attempting to stop the previous proxy.`,
        `[Melu] 尝试停止旧 proxy 后，端口 ${port} 仍然被占用。`,
      ));
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
  options: MeluChildProcessOptions = {},
): ReturnType<typeof spawn> {
  const detached = options.detached ?? false;
  let logFd: number | null = null;
  let stdio: StdioOptions = "inherit";
  if (detached && options.logPath) {
    logFd = openSync(options.logPath, "a");
    stdio = ["ignore", logFd, logFd];
  } else if (detached) {
    stdio = ["ignore", "ignore", "ignore"];
  }

  const child = spawn(process.execPath, [resolve(import.meta.dirname ?? ".", entrypointFile)], {
    env,
    cwd: resolve(import.meta.dirname ?? "."),
    detached,
    stdio,
    windowsHide: true,
  });

  if (logFd !== null) {
    closeSync(logFd);
  }

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
  const executableExt = extname(executableName);
  const executableStem = executableExt
    ? executableName.slice(0, -executableExt.length)
    : executableName;
  if (executableStem.toLowerCase() !== "claude") {
    const launch = resolveForegroundLaunch(command[0], command.slice(1));
    return {
      command: launch.command,
      args: launch.args,
      env,
      shell: launch.shell,
      cleanup: () => {
        // No-op for non-Claude commands.
      },
    };
  }

  const existingArgs = command.slice(1);
  if (containsClaudeSettingsFlag(existingArgs)) {
    const launch = resolveForegroundLaunch(command[0], existingArgs);
    return {
      command: launch.command,
      args: launch.args,
      env,
      shell: launch.shell,
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

  const launch = resolveForegroundLaunch(
    command[0],
    ["--setting-sources", "project,local", "--settings", tempSettingsPath, ...existingArgs],
  );

  return {
    command: launch.command,
    args: launch.args,
    env,
    shell: launch.shell,
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

function resolveForegroundLaunch(
  command: string,
  args: string[],
): Pick<PreparedForegroundCommand, "command" | "args" | "shell"> {
  if (process.platform !== "win32") {
    return {
      command,
      args,
      shell: false,
    };
  }

  const trimmed = command.trim();
  if (!trimmed) {
    return {
      command,
      args,
      shell: false,
    };
  }

  const directExt = extname(trimmed).toLowerCase();
  if (directExt) {
    return {
      command: trimmed,
      args,
      shell: directExt === ".cmd" || directExt === ".bat",
    };
  }

  const resolved = resolveWindowsCommandFromPath(trimmed);
  if (!resolved) {
    return {
      command: trimmed,
      args,
      shell: true,
    };
  }

  const resolvedExt = extname(resolved).toLowerCase();
  return {
    command: resolved,
    args,
    shell: resolvedExt === ".cmd" || resolvedExt === ".bat",
  };
}

function resolveWindowsCommandFromPath(command: string): string | null {
  try {
    const output = execFileSync("where.exe", [command], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!output) return null;

    const candidates = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (candidates.length === 0) {
      return null;
    }

    const preferredExtensions = getWindowsExecutableExtensions();
    for (const extension of preferredExtensions) {
      const match = candidates.find((candidate) => extname(candidate).toLowerCase() === extension);
      if (match) {
        return match;
      }
    }

    return candidates[0] ?? null;
  } catch {
    return null;
  }
}

function getWindowsExecutableExtensions(): string[] {
  const rawPathExt = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  const normalized = rawPathExt
    .split(";")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.startsWith("."));

  const result: string[] = [];
  for (const extension of normalized) {
    if (!result.includes(extension)) {
      result.push(extension);
    }
  }

  for (const extension of [".com", ".exe", ".bat", ".cmd"]) {
    if (!result.includes(extension)) {
      result.push(extension);
    }
  }

  return result;
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
