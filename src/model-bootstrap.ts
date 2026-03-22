import { select } from "@inquirer/prompts";

import {
  getLlama,
  LlamaLogLevel,
  NoBinaryFoundError,
  resolveModelFile,
} from "node-llama-cpp";

import {
  EMBEDDING_MODEL_FILE,
  EMBEDDING_MODEL_PATH,
  EMBEDDING_MODEL_SOURCES,
  MODELS_DIR,
  ensureDirs,
  hasEmbeddingModel,
  isMirrorName,
  isUiLanguage,
  loadConfig,
  saveConfig,
  type MeluConfig,
  type MirrorName,
  type UiLanguage,
} from "./config.js";
import { getLocalizedMirrorLabel, getUiLanguageLabel, t } from "./i18n.js";

const MIRROR_CHOICES: Array<{
  mirror: MirrorName;
  key: string;
}> = [
  { mirror: "huggingface", key: "1" },
  { mirror: "modelscope", key: "2" },
];

const LANGUAGE_CHOICES: Array<{
  key: string;
  language: UiLanguage;
  aliases: string[];
}> = [
  { key: "1", language: "en", aliases: ["english"] },
  { key: "2", language: "zh-CN", aliases: ["zh-cn", "zh_cn", "zhcn", "cn", "simplified", "simplified-chinese"] },
  { key: "3", language: "zh-TW", aliases: ["zh-tw", "zh_tw", "zhtw", "tw", "traditional", "traditional-chinese"] },
  { key: "4", language: "ja", aliases: ["jp", "japanese"] },
  { key: "5", language: "ko", aliases: ["kr", "korean"] },
  { key: "6", language: "fr", aliases: ["french", "francais"] },
  { key: "7", language: "ru", aliases: ["russian"] },
  { key: "8", language: "de", aliases: ["german", "deutsch"] },
  { key: "9", language: "es", aliases: ["spanish", "espanol", "español"] },
  { key: "10", language: "pt", aliases: ["portuguese", "portugues", "português", "pt-br", "pt-pt"] },
];

let _runtimeCheck: Promise<void> | null = null;

export function getMirrorLabel(
  mirror: MirrorName | null,
  language: UiLanguage | null = null,
): string {
  if (!mirror) return t(language, "notSet");
  return getLocalizedMirrorLabel(mirror, language);
}

export function getConfiguredMirror(
  config: MeluConfig,
  preferredMirror?: string | null,
): MirrorName | null {
  if (isMirrorName(preferredMirror)) return preferredMirror;
  return config.mirror;
}

function normalizeUiLanguageInput(value: string | UiLanguage | null | undefined): UiLanguage | null {
  if (value == null) return null;
  if (isUiLanguage(value)) return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return null;

  for (const choice of LANGUAGE_CHOICES) {
    if (choice.key === normalized || choice.aliases.includes(normalized)) {
      return choice.language;
    }
  }
  return null;
}

export function getConfiguredUiLanguage(
  config: MeluConfig,
  preferredLanguage?: string | UiLanguage | null,
): UiLanguage | null {
  const preferred = normalizeUiLanguageInput(preferredLanguage);
  if (preferred) return preferred;
  return config.uiLanguage;
}

export async function promptForUiLanguageSelection(
  languageForPrompts: UiLanguage = "en",
): Promise<UiLanguage> {
  try {
    return await select<UiLanguage>({
      message: t(languageForPrompts, "languagePromptTitle"),
      default: "en",
      pageSize: LANGUAGE_CHOICES.length,
      instructions: {
        navigation: t(languageForPrompts, "menuHint"),
        pager: t(languageForPrompts, "menuHint"),
      },
      choices: LANGUAGE_CHOICES.map((choice) => ({
        value: choice.language,
        name: getUiLanguageLabel(choice.language),
      })),
    });
  } catch (error) {
    handlePromptAbort(error);
  }
}

export async function promptForMirrorSelection(
  language: UiLanguage = "en",
): Promise<MirrorName> {
  try {
    return await select<MirrorName>({
      message: t(language, "mirrorPromptTitle"),
      default: "huggingface",
      instructions: {
        navigation: t(language, "menuHint"),
        pager: t(language, "menuHint"),
      },
      choices: MIRROR_CHOICES.map((choice) => ({
        value: choice.mirror,
        name: getLocalizedMirrorLabel(choice.mirror, language),
        description: t(
          language,
          choice.mirror === "huggingface" ? "mirrorHintHuggingFace" : "mirrorHintModelScope",
        ),
      })),
    });
  } catch (error) {
    handlePromptAbort(error);
  }
}

export async function ensureUiLanguageConfigured(
  config: MeluConfig,
  options: {
    interactive: boolean;
    preferredLanguage?: string | UiLanguage | null;
    save?: boolean;
  } = { interactive: false },
): Promise<MeluConfig> {
  const selected = getConfiguredUiLanguage(config, options.preferredLanguage);
  if (selected) {
    if (config.uiLanguage !== selected) {
      config.uiLanguage = selected;
      if (options.save !== false) saveConfig(config);
    }
    return config;
  }

  if (!options.interactive || !process.stdin.isTTY || !process.stdout.isTTY) {
    config.uiLanguage = "en";
    if (options.save !== false) saveConfig(config);
    return config;
  }

  config.uiLanguage = await promptForUiLanguageSelection("en");
  if (options.save !== false) saveConfig(config);

  console.log(t(config.uiLanguage, "languageSet", { language: getUiLanguageLabel(config.uiLanguage) }));
  return config;
}

export async function ensureMirrorConfigured(
  config: MeluConfig,
  options: {
    interactive: boolean;
    preferredMirror?: string | null;
    uiLanguage?: UiLanguage | null;
    save?: boolean;
  } = { interactive: false },
): Promise<MeluConfig> {
  const selected = getConfiguredMirror(config, options.preferredMirror);
  if (selected) {
    if (config.mirror !== selected) {
      config.mirror = selected;
      if (options.save !== false) saveConfig(config);
    }
    return config;
  }

  const language = options.uiLanguage ?? config.uiLanguage ?? "en";

  if (!options.interactive || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(t(language, "mirrorSelectionRequired"));
  }

  config.mirror = await promptForMirrorSelection(language);
  if (options.save !== false) saveConfig(config);
  return config;
}

export async function ensureEmbeddingRuntimeAvailable(language: UiLanguage | null = null): Promise<void> {
  if (_runtimeCheck) return _runtimeCheck;

  _runtimeCheck = (async () => {
    try {
      await getLlama({
        build: "never",
        dryRun: true,
        gpu: "auto",
        logLevel: LlamaLogLevel.warn,
        progressLogs: false,
      });
    } catch (error) {
      throw formatRuntimeError(error, language);
    }
  })();

  return _runtimeCheck;
}

export async function ensureEmbeddingModelReady(
  options: {
    config?: MeluConfig;
    interactive?: boolean;
    preferredLanguage?: string | UiLanguage | null;
    preferredMirror?: string | null;
    showProgress?: boolean;
  } = {},
): Promise<{ config: MeluConfig; modelPath: string }> {
  ensureDirs();

  const baseConfig = options.config ?? loadConfig();
  const interactive = options.interactive ?? false;

  const configWithLanguage = await ensureUiLanguageConfigured(baseConfig, {
    interactive,
    preferredLanguage: options.preferredLanguage,
  });

  const config = await ensureMirrorConfigured(configWithLanguage, {
    interactive,
    preferredMirror: options.preferredMirror,
    uiLanguage: configWithLanguage.uiLanguage,
  });

  if (hasEmbeddingModel()) {
    console.log(t(config.uiLanguage, "modelAlreadyAvailable", { path: EMBEDDING_MODEL_PATH }));
    console.log(t(config.uiLanguage, "modelSkipDownload"));
    return { config, modelPath: EMBEDDING_MODEL_PATH };
  }

  const source = EMBEDDING_MODEL_SOURCES[config.mirror!];
  const sourceLabel = getLocalizedMirrorLabel(config.mirror!, config.uiLanguage);

  console.log(t(config.uiLanguage, "embeddingDownload", { file: EMBEDDING_MODEL_FILE }));
  console.log(t(config.uiLanguage, "labelSource", { label: sourceLabel }));
  console.log(t(config.uiLanguage, "labelSavedTo", { path: EMBEDDING_MODEL_PATH }));

  const modelPath = await withLocalizedDownloadProgress(config.uiLanguage, async () => resolveModelFile(source.downloadUrl, {
    cli: options.showProgress ?? true,
    directory: MODELS_DIR,
    download: "auto",
    fileName: EMBEDDING_MODEL_FILE,
    verify: false,
  }));

  return { config, modelPath };
}

async function withLocalizedDownloadProgress<T>(
  language: UiLanguage | null,
  run: () => Promise<T>,
): Promise<T> {
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);

  const patch = (text: string): string => text
    .replaceAll("Downloading to", t(language, "downloadProgressDownloadingTo"))
    .replaceAll("Downloaded to", t(language, "downloadProgressDownloadedTo"));

  const patchChunk = (chunk: string | Uint8Array): string | Uint8Array => {
    if (typeof chunk === "string") {
      return patch(chunk);
    }

    try {
      return Buffer.from(patch(Buffer.from(chunk).toString("utf8")), "utf8");
    } catch {
      return chunk;
    }
  };

  (process.stdout.write as typeof process.stdout.write) = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((err?: Error | null) => void), cb?: (err?: Error | null) => void) => {
    return stdoutWrite(patchChunk(chunk), encoding as BufferEncoding, cb);
  }) as typeof process.stdout.write;

  (process.stderr.write as typeof process.stderr.write) = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((err?: Error | null) => void), cb?: (err?: Error | null) => void) => {
    return stderrWrite(patchChunk(chunk), encoding as BufferEncoding, cb);
  }) as typeof process.stderr.write;

  try {
    return await run();
  } finally {
    process.stdout.write = stdoutWrite as typeof process.stdout.write;
    process.stderr.write = stderrWrite as typeof process.stderr.write;
  }
}

function formatRuntimeError(error: unknown, language: UiLanguage | null): Error {
  if (error instanceof NoBinaryFoundError) {
    return new Error(t(language, "runtimeBinaryUnavailable"));
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
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
