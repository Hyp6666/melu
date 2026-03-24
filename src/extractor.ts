/**
 * Melu 记忆提取器。
 *
 * 只从 user 消息中提取长期记忆。
 * 每条 user 消息完整传给 claude -p，最多提取 1 条记忆。
 * 不做切块——用户输入剥离系统标签后通常很短，LLM 处理无压力。
 */

import { embed } from "./embedder.js";
import { loadConfig } from "./config.js";
import { createI18n } from "./i18n.js";
import type { MemoryStore } from "./memory.js";
import {
  normalizeWhitespace,
  truncateCharacters,
} from "./text-chunking.js";

const MAX_SUMMARY_CHARS = 50;
const MAX_CONTENT_CHARS = 500;
const MAX_SUBJECT_CHARS = 80;

const MEMORY_CATEGORIES = new Set([
  "profile",
  "project",
  "event",
  "preference",
  "correction",
]);

const EXTRACTION_PROMPT = `You are a careful long-term memory extractor.
Based only on the user message below, determine whether there is one useful memory worth keeping for future conversations.

Extraction rules:
- Look only at the user message. Do not use any imagined assistant reply.
- Extract at most one memory.
- Prefer information that is likely to be useful again in future conversations, especially profile details, ongoing project context, durable preferences, important corrections, or recent events that may still matter later.
- If a detail is plausibly reusable for personalization, continuity, or project understanding, prefer keeping it rather than returning null.
- Do not extract pure one-off requests, casual chit-chat with no lasting signal, temporary tasks with no future value, or noisy situational context that is unlikely to matter again.

Language rule:
- Use the same language as the user's message when writing the memory.

Field requirements:
- content: up to 75 words, include enough context and detail to be useful on its own
- summary: one short summary sentence, ideally no more than 30 words, with a hard limit of 60 characters
- category: must be one of profile / project / event / preference / correction
- subject: a short topic tag such as user.name / user.preference.answer_style / project.melu

Output requirements:
- If a memory should be kept, output exactly one JSON object:
  {"content":"...","summary":"...","category":"...","subject":"..."}
- If nothing clearly reusable should be kept, output null
- Do not output Markdown
- Do not output explanations

User message:
{user_message}`;


interface RawMemory {
  content: string;
  summary: string;
  category: string;
  subject: string;
}

/**
 * 调用上游 Anthropic API 提取用户长期记忆。
 */
export interface ExtractionRequestContext {
  url: string;
  headers: Record<string, string>;
  bodyTemplate: Record<string, unknown>;
  quiet?: boolean;
  strict?: boolean;
}

export interface ProcessAndStoreMemoriesOptions {
  embedText?: (summary: string, embeddingModel: string) => Promise<Float32Array>;
  failOnEmbeddingError?: boolean;
  quiet?: boolean;
}

export async function extractMemoriesFromUserMessage(
  userMessage: string,
  ctx: ExtractionRequestContext,
): Promise<RawMemory[]> {
  const trimmed = normalizeWhitespace(userMessage);
  if (trimmed.length === 0) return [];

  // 不切块，完整的 userMessage 直接传给 claude -p 提取，最多返回 1 条记忆。
  // 用户单条消息剥离系统标签后一般几十到几百字，远在 LLM context 舒适区内。
  // 切块反而会丢失上下文关联，且每个 chunk 各调一次 claude -p 浪费配额。
  const candidate = await extractSingleMemoryFromChunk(trimmed, ctx);
  if (candidate) {
    return [candidate];
  }
  return [];
}

/**
 * 处理提取到的记忆：embedding → 去重 → 存储。返回新增条数。
 */
export async function processAndStoreMemories(
  rawMemories: RawMemory[],
  store: MemoryStore,
  embeddingModel: string,
  sourceConversation?: string,
  options?: ProcessAndStoreMemoriesOptions,
): Promise<number> {
  const ui = createI18n(loadConfig().uiLanguage);
  let added = 0;

  for (const rawMemory of rawMemories) {
    const memory = normalizeExtractedMemory(rawMemory);
    if (!memory) continue;

    const { content, summary, category, subject } = memory;

    let vector: Float32Array;
    try {
      vector = options?.embedText
        ? await options.embedText(summary, embeddingModel)
        : await embed(summary, embeddingModel, { purpose: "memory" });
    } catch (e) {
      if (!options?.quiet) {
        console.warn(ui.t("embeddingFailed"), e);
      }
      if (options?.failOnEmbeddingError === false) {
        continue;
      }
      throw e;
    }

    const similar = store.findSimilar(vector, 0.7);

    if (similar.length > 0) {
      const { memory: bestMatch, similarity: bestSim } = similar[0];

      if (bestSim > 0.9) {
        store.add({
          content,
          summary,
          category,
          subject,
          vector,
          supersedes: bestMatch.id,
          sourceConversation,
        });
        added++;
        if (!options?.quiet) {
          console.log(ui.t("memoryUpdated", { summary, previous: bestMatch.summary }));
        }
        continue;
      }

      if (bestSim > 0.7) {
        (
          store as unknown as {
            conn: { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
          }
        ).conn.prepare("UPDATE memories SET confidence = confidence * 0.8 WHERE id=?").run(bestMatch.id);
      }
    }

    store.add({
      content,
      summary,
      category,
      subject,
      vector,
      sourceConversation,
    });
    added++;
    if (!options?.quiet) {
      console.log(ui.t("memoryNew", { category, summary }));
    }
  }

  return added;
}

async function extractSingleMemoryFromChunk(
  userChunk: string,
  ctx: ExtractionRequestContext,
): Promise<RawMemory | null> {
  const prompt = EXTRACTION_PROMPT.replace("{user_message}", userChunk);
  const text = await callExtractionModel(prompt, ctx, 256);
  if (!text) return null;

  const parsed = parseJsonPayload(text);
  if (parsed == null) return null;

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const memory = normalizeExtractedMemory(item);
      if (memory) return memory;
    }
    return null;
  }

  return normalizeExtractedMemory(parsed);
}


async function callExtractionModel(
  prompt: string,
  ctx: ExtractionRequestContext,
  _maxTokens: number,
): Promise<string> {
  const { spawn } = await import("node:child_process");
  const ui = createI18n(loadConfig().uiLanguage);
  const quiet = Boolean(ctx.quiet);

  if (!quiet) {
    console.log(ui.t("claudePExtracting"));
  }

  return new Promise((resolve, reject) => {
    // 构造一个干净的环境：只保留系统必需的变量，删掉所有代理相关的
    const cleanEnv: Record<string, string> = {};
    const KEEP_KEYS = ["PATH", "HOME", "USER", "SHELL", "LANG", "TERM", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME"];
    for (const key of KEEP_KEYS) {
      if (process.env[key]) cleanEnv[key] = process.env[key]!;
    }

    const child = spawn("claude", ["-p", prompt], {
      env: cleanEnv,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
    });

    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));

    const errChunks: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));

    child.on("close", (code) => {
      const stdout = Buffer.concat(chunks).toString("utf-8").trim();
      if (code !== 0 || !stdout) {
        const stderr = Buffer.concat(errChunks).toString("utf-8").slice(0, 200);
        if (!quiet) {
          console.warn(ui.t("claudePExitCode", { code: code ?? "null", stderr }));
        }
        reject(new Error(ui.t("claudePExitCode", { code: code ?? "null", stderr })));
        return;
      }
      if (!quiet) {
        console.log(`[Melu:DEBUG] claude -p 返回: ${truncateCharacters(stdout, 200)}`);
      }
      resolve(stripMarkdownFences(stdout));
    });

    child.on("error", (err) => {
      if (!quiet) {
        console.warn(ui.t("claudePStartFailed", { message: err.message }));
      }
      reject(err);
    });
  });
}

function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  const lines = trimmed.split("\n");
  return lines
    .slice(1, lines[lines.length - 1].trim() === "```" ? -1 : undefined)
    .join("\n")
    .trim();
}

function parseJsonPayload(text: string): unknown {
  const normalized = text.trim();
  if (normalized === "" || normalized === "null") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

function normalizeExtractedMemory(value: unknown): RawMemory | null {
  if (!value || typeof value !== "object") return null;

  const obj = value as Record<string, unknown>;
  const rawSummary = normalizeWhitespace(String(obj.summary ?? ""));
  const rawContent = normalizeWhitespace(String(obj.content ?? rawSummary));

  if (rawSummary === "" && rawContent === "") {
    return null;
  }

  const summary = truncateCharacters(rawSummary || rawContent, MAX_SUMMARY_CHARS);
  const content = truncateCharacters(rawContent || summary, MAX_CONTENT_CHARS);
  const category = normalizeCategory(obj.category);
  const subject = truncateCharacters(normalizeWhitespace(String(obj.subject ?? "")), MAX_SUBJECT_CHARS, "");

  if (summary === "" || content === "") {
    return null;
  }

  return {
    content,
    summary,
    category,
    subject,
  };
}

function normalizeCategory(value: unknown): string {
  const category = normalizeWhitespace(String(value ?? "")).toLowerCase();
  if (MEMORY_CATEGORIES.has(category)) {
    return category;
  }
  return "event";
}
