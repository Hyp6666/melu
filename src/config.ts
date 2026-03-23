/**
 * Melu 配置管理。
 *
 * 所有配置存储在 ~/.melu/config.json。
 * API key 不在此处管理——直接从拦截到的请求头中获取。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, isAbsolute, extname } from "node:path";

export const MELU_HOME = join(homedir(), ".melu");
export const MODELS_DIR = join(MELU_HOME, "models");
export const MEMORIES_DIR = join(MELU_HOME, "memories");
export const SOCKETS_DIR = join(MELU_HOME, "sockets");
export const STATS_DIR = join(MELU_HOME, "stats");
export const TRACES_DIR = join(MELU_HOME, "traces");
export const PENDING_EXTRACTIONS_DIR =
  process.env.MELU_PENDING_EXTRACTIONS_DIR?.trim() || join(MELU_HOME, "pending-extractions");
export const CONFIG_FILE = join(MELU_HOME, "config.json");
export const PID_FILE = join(MELU_HOME, "proxy.pid");

export const DEFAULT_MEMORY_NAME = "default";
export const DEFAULT_PORT = 9800;

export type MirrorName = "huggingface" | "modelscope";
export const UI_LANGUAGES = ["en", "zh-CN", "zh-TW", "ja", "ko", "fr", "ru", "de", "es", "pt"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];
export const DEFAULT_UI_LANGUAGE: UiLanguage = "en";

// Embedding 模型
export const EMBEDDING_MODEL_ID = "Qwen/Qwen3-Embedding-0.6B-GGUF";
export const EMBEDDING_MODEL_FILE = "Qwen3-Embedding-0.6B-Q8_0.gguf";
export const EMBEDDING_MODEL_PATH = join(MODELS_DIR, EMBEDDING_MODEL_FILE);

export const EMBEDDING_MODEL_SOURCES: Record<
  MirrorName,
  { label: string; pageUrl: string; downloadUrl: string }
> = {
  huggingface: {
    label: "Hugging Face (Global)",
    pageUrl: "https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/tree/main",
    downloadUrl:
      "https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q8_0.gguf?download=true",
  },
  modelscope: {
    label: "ModelScope (CN)",
    pageUrl: "https://modelscope.cn/models/Qwen/Qwen3-Embedding-0.6B-GGUF/files",
    downloadUrl:
      "https://modelscope.cn/models/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/master/Qwen3-Embedding-0.6B-Q8_0.gguf",
  },
};

export const UPSTREAM_ANTHROPIC = "https://api.anthropic.com";

export interface MeluConfig {
  port: number;
  defaultMemory: string;
  embeddingModel: string;
  uiLanguage: UiLanguage | null;
  mirror: MirrorName | null;
  upstreamAnthropic: string;
}

const DEFAULT_CONFIG: MeluConfig = {
  port: DEFAULT_PORT,
  defaultMemory: DEFAULT_MEMORY_NAME,
  embeddingModel: EMBEDDING_MODEL_ID,
  uiLanguage: null,
  mirror: null,
  upstreamAnthropic: UPSTREAM_ANTHROPIC,
};

const LEGACY_EMBEDDING_MODEL_IDS = new Set([
  "onnx-community/Qwen3-Embedding-0.6B-ONNX",
]);

export function isMirrorName(value: unknown): value is MirrorName {
  return value === "huggingface" || value === "modelscope";
}

export function isUiLanguage(value: unknown): value is UiLanguage {
  return (
    value === "en" ||
    value === "zh-CN" ||
    value === "zh-TW" ||
    value === "ja" ||
    value === "ko" ||
    value === "fr" ||
    value === "ru" ||
    value === "de" ||
    value === "es" ||
    value === "pt"
  );
}

function normalizeMirror(value: unknown): MirrorName | null {
  if (isMirrorName(value)) {
    return value;
  }
  return null;
}

function normalizeUiLanguage(value: unknown): UiLanguage | null {
  if (isUiLanguage(value)) {
    return value;
  }
  return null;
}

function normalizeEmbeddingModel(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    return EMBEDDING_MODEL_ID;
  }

  if (LEGACY_EMBEDDING_MODEL_IDS.has(value)) {
    return EMBEDDING_MODEL_ID;
  }

  return value;
}

export function loadConfig(): MeluConfig {
  if (existsSync(CONFIG_FILE)) {
    try {
      const raw = readFileSync(CONFIG_FILE, "utf-8");
      const data = JSON.parse(raw);
      return {
        ...DEFAULT_CONFIG,
        ...data,
        embeddingModel: normalizeEmbeddingModel(data.embeddingModel),
        uiLanguage: normalizeUiLanguage(data.uiLanguage),
        mirror: normalizeMirror(data.mirror),
      };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(config: MeluConfig): void {
  ensureDirs();
  const normalized: MeluConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    embeddingModel: normalizeEmbeddingModel(config.embeddingModel),
    uiLanguage: normalizeUiLanguage(config.uiLanguage),
    mirror: normalizeMirror(config.mirror),
  };
  writeFileSync(CONFIG_FILE, JSON.stringify(normalized, null, 2), "utf-8");
}

export function ensureDirs(): void {
  for (const dir of [MELU_HOME, MODELS_DIR, MEMORIES_DIR, SOCKETS_DIR, STATS_DIR, TRACES_DIR, PENDING_EXTRACTIONS_DIR]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

export function getMemoryPath(nameOrPath?: string | null): string {
  const name = nameOrPath ?? DEFAULT_MEMORY_NAME;

  // 绝对路径或带路径分隔符的，直接使用（支持 U 盘等外部路径）
  if (isAbsolute(name) || name.includes("/") || name.includes("\\")) {
    return extname(name) === ".memory" ? name : name + ".memory";
  }

  // 否则视为 ~/.melu/memories/ 下的名称
  return join(MEMORIES_DIR, name + ".memory");
}

export function hasEmbeddingModel(): boolean {
  return existsSync(EMBEDDING_MODEL_PATH);
}
