/**
 * Melu 记忆存储与检索。
 *
 * 单个 .memory 文件 = 一个 SQLite 数据库。
 * 支持 FTS5 全文搜索 + 向量余弦相似度搜索。
 */

import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { normalizeWhitespace, truncateCharacters } from "./text-chunking.js";

// ── 时间工具 ─────────────────────────────────────────────────────────

/** 本地时区时间，精确到分钟，ISO8601 带时区偏移 */
function nowLocal(): string {
  const now = new Date();
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const mm = String(Math.abs(offset) % 60).padStart(2, "0");
  const iso = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  return `${iso}${sign}${hh}:${mm}`;
}

// ── 向量工具 ─────────────────────────────────────────────────────────

function vectorToBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

function blobToVector(blob: Buffer): Float32Array {
  const ab = new ArrayBuffer(blob.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < blob.length; i++) view[i] = blob[i];
  return new Float32Array(ab);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 1e-10 ? dot / denom : 0;
}

// ── 类型 ─────────────────────────────────────────────────────────────

export interface Memory {
  id: string;
  content: string;
  summary: string;
  category: string;
  subject: string;
  confidence: number;
  isActive: number;
  supersedes: string | null;
  vector: Float32Array | null;
  createdAt: string;
  updatedAt: string;
  lastAccessed: string;
  accessCount: number;
  sourceConversation: string | null;
  extra: Record<string, unknown> | null;
}

interface MemoryRow {
  id: string;
  content: string;
  summary: string;
  category: string;
  subject: string;
  confidence: number;
  is_active: number;
  supersedes: string | null;
  vector: Buffer | null;
  created_at: string;
  updated_at: string;
  last_accessed: string;
  access_count: number;
  source_conversation: string | null;
  extra: string | null;
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    content: row.content,
    summary: row.summary,
    category: row.category,
    subject: row.subject,
    confidence: row.confidence,
    isActive: row.is_active,
    supersedes: row.supersedes,
    vector: row.vector ? blobToVector(row.vector) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessed: row.last_accessed,
    accessCount: row.access_count,
    sourceConversation: row.source_conversation,
    extra: row.extra ? JSON.parse(row.extra) : null,
  };
}

// ── Schema ───────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
    id                  TEXT PRIMARY KEY,
    content             TEXT NOT NULL,
    summary             TEXT NOT NULL,
    category            TEXT NOT NULL DEFAULT 'event',
    subject             TEXT NOT NULL DEFAULT '',
    confidence          REAL NOT NULL DEFAULT 1.0,
    is_active           INTEGER NOT NULL DEFAULT 1,
    supersedes          TEXT,
    vector              BLOB,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    last_accessed       TEXT NOT NULL,
    access_count        INTEGER NOT NULL DEFAULT 0,
    source_conversation TEXT,
    extra               TEXT
);

CREATE INDEX IF NOT EXISTS idx_memories_active ON memories(is_active);
CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
CREATE INDEX IF NOT EXISTS idx_memories_subject ON memories(subject);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    summary,
    content,
    content='memories',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, summary, content)
    VALUES (new.rowid, new.summary, new.content);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, summary, content)
    VALUES ('delete', old.rowid, old.summary, old.content);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, summary, content)
    VALUES ('delete', old.rowid, old.summary, old.content);
    INSERT INTO memories_fts(rowid, summary, content)
    VALUES (new.rowid, new.summary, new.content);
END;

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
`;

const SELECT_COLS =
  "id, content, summary, category, subject, confidence, is_active, " +
  "supersedes, vector, created_at, updated_at, last_accessed, " +
  "access_count, source_conversation, extra";

const MAX_INJECTION_MEMORIES = 50;
const MAX_INJECTION_CHARS = 8000;
const RETRIEVAL_SIMILARITY_THRESHOLD = 0.45;

// ── MemoryStore ──────────────────────────────────────────────────────

export class MemoryStore {
  private db: Database.Database | null = null;

  constructor(private dbPath: string) {}

  open(): void {
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private get conn(): Database.Database {
    if (!this.db) throw new Error("MemoryStore not opened");
    return this.db;
  }

  // ── 写入 ─────────────────────────────────────────────────────

  add(opts: {
    content: string;
    summary: string;
    category?: string;
    subject?: string;
    confidence?: number;
    vector?: Float32Array | null;
    supersedes?: string | null;
    sourceConversation?: string | null;
    extra?: Record<string, unknown> | null;
  }): string {
    const now = nowLocal();
    const id = uuidv4();

    this.conn.prepare(
      `INSERT INTO memories
       (id, content, summary, category, subject, confidence,
        is_active, supersedes, vector, created_at, updated_at,
        last_accessed, access_count, source_conversation, extra)
       VALUES (?,?,?,?,?,?,1,?,?,?,?,?,0,?,?)`
    ).run(
      id,
      opts.content,
      opts.summary,
      opts.category ?? "event",
      opts.subject ?? "",
      opts.confidence ?? 1.0,
      opts.supersedes ?? null,
      opts.vector ? vectorToBlob(opts.vector) : null,
      now, now, now,
      opts.sourceConversation ?? null,
      opts.extra ? JSON.stringify(opts.extra) : null,
    );

    if (opts.supersedes) {
      this.conn.prepare(
        "UPDATE memories SET is_active=0, updated_at=? WHERE id=?"
      ).run(now, opts.supersedes);
    }

    return id;
  }

  delete(memId: string): boolean {
    const result = this.conn.prepare("DELETE FROM memories WHERE id=?").run(memId);
    return result.changes > 0;
  }

  clear(): number {
    const result = this.conn.prepare("DELETE FROM memories").run();
    return result.changes;
  }

  // ── 读取 ─────────────────────────────────────────────────────

  countActive(): number {
    const row = this.conn.prepare(
      "SELECT COUNT(*) as cnt FROM memories WHERE is_active=1"
    ).get() as { cnt: number };
    return row?.cnt ?? 0;
  }

  getById(memId: string): Memory | null {
    const row = this.conn.prepare(
      `SELECT ${SELECT_COLS} FROM memories WHERE id=?`
    ).get(memId) as MemoryRow | undefined;
    return row ? rowToMemory(row) : null;
  }

  listAll(includeInactive = false): Memory[] {
    const where = includeInactive ? "" : "WHERE is_active=1";
    const rows = this.conn.prepare(
      `SELECT ${SELECT_COLS} FROM memories ${where} ORDER BY created_at DESC`
    ).all() as MemoryRow[];
    return rows.map(rowToMemory);
  }

  // ── 检索 ─────────────────────────────────────────────────────

  retrieve(queryVector?: Float32Array | null): Memory[] {
    const memories = queryVector
      ? this.vectorSearch(
          queryVector,
          MAX_INJECTION_MEMORIES,
          RETRIEVAL_SIMILARITY_THRESHOLD,
        )
      : this.getAllActive().slice(0, MAX_INJECTION_MEMORIES);
    this.touch(memories);
    return memories;
  }

  findSimilar(queryVector: Float32Array, threshold = 0.7): Array<{ memory: Memory; similarity: number }> {
    const rows = this.conn.prepare(
      `SELECT ${SELECT_COLS} FROM memories WHERE is_active=1 AND vector IS NOT NULL`
    ).all() as MemoryRow[];

    const results: Array<{ memory: Memory; similarity: number }> = [];
    for (const r of rows) {
      const m = rowToMemory(r);
      if (!m.vector) continue;
      const sim = cosineSimilarity(queryVector, m.vector);
      if (sim >= threshold) {
        results.push({ memory: m, similarity: sim });
      }
    }
    results.sort((a, b) => b.similarity - a.similarity);
    return results;
  }

  // ── 元信息 ────────────────────────────────────────────────────

  setMeta(key: string, value: string): void {
    this.conn.prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)"
    ).run(key, value);
  }

  getMeta(key: string): string | null {
    const row = this.conn.prepare(
      "SELECT value FROM meta WHERE key=?"
    ).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  // ── 导入导出 ──────────────────────────────────────────────────

  async exportTo(dest: string): Promise<void> {
    this.conn.pragma("wal_checkpoint(TRUNCATE)");
    await this.conn.backup(dest);
  }

  importFrom(src: string): number {
    const srcDb = new Database(src, { readonly: true });
    const rows = srcDb.prepare(
      `SELECT ${SELECT_COLS} FROM memories WHERE is_active=1`
    ).all() as MemoryRow[];
    srcDb.close();

    let count = 0;
    for (const r of rows) {
      const existing = this.getById(r.id);
      if (!existing) {
        const m = rowToMemory(r);
        this.conn.prepare(
          `INSERT INTO memories
           (id, content, summary, category, subject, confidence,
            is_active, supersedes, vector, created_at, updated_at,
            last_accessed, access_count, source_conversation, extra)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(
          m.id, m.content, m.summary, m.category, m.subject, m.confidence,
          m.isActive, m.supersedes,
          m.vector ? vectorToBlob(m.vector) : null,
          m.createdAt, m.updatedAt, m.lastAccessed, m.accessCount,
          m.sourceConversation,
          m.extra ? JSON.stringify(m.extra) : null,
        );
        count++;
      }
    }
    return count;
  }

  // ── 私有方法 ──────────────────────────────────────────────────

  private getAllActive(): Memory[] {
    const rows = this.conn.prepare(
      `SELECT ${SELECT_COLS}
       FROM memories
       WHERE is_active=1
       ORDER BY
         CASE WHEN category='profile' THEN 0 ELSE 1 END,
         access_count DESC,
         last_accessed DESC,
         created_at DESC`
    ).all() as MemoryRow[];
    return rows.map(rowToMemory);
  }

  private getByCategory(category: string): Memory[] {
    const rows = this.conn.prepare(
      `SELECT ${SELECT_COLS} FROM memories WHERE is_active=1 AND category=?`
    ).all(category) as MemoryRow[];
    return rows.map(rowToMemory);
  }

  private vectorSearch(queryVector: Float32Array, topK: number, threshold = 0): Memory[] {
    const rows = this.conn.prepare(
      `SELECT ${SELECT_COLS} FROM memories WHERE is_active=1 AND vector IS NOT NULL`
    ).all() as MemoryRow[];

    const scored: Array<{ memory: Memory; sim: number }> = [];
    for (const r of rows) {
      const m = rowToMemory(r);
      if (!m.vector) continue;
      const sim = cosineSimilarity(queryVector, m.vector);
      if (sim < threshold) continue;
      scored.push({ memory: m, sim });
    }
    scored.sort((a, b) => b.sim - a.sim);
    return scored.slice(0, topK).map((s) => s.memory);
  }

  private touch(memories: Memory[]): void {
    const now = nowLocal();
    const stmt = this.conn.prepare(
      "UPDATE memories SET last_accessed=?, access_count=access_count+1 WHERE id=?"
    );
    for (const m of memories) {
      stmt.run(now, m.id);
    }
  }
}

// ── 格式化 ───────────────────────────────────────────────────────────

export function formatMemoriesForInjection(memories: Memory[]): string {
  if (memories.length === 0) return "";

  const lines = ["\n\n[User Memory - Provided by Melu]"];
  let usedChars = lines[0].length;

  for (const m of memories.slice(0, MAX_INJECTION_MEMORIES)) {
    const content = truncateCharacters(normalizeWhitespace(m.content || m.summary), 500);
    if (content === "") continue;

    const timestamp = (m.updatedAt || m.createdAt || "").slice(0, 16);
    const line = `- ${timestamp} user says: ${content}`;
    if (usedChars + line.length > MAX_INJECTION_CHARS) {
      break;
    }

    lines.push(line);
    usedChars += line.length + 1;
  }

  if (lines.length === 1) {
    return "";
  }

  return lines.join("\n");
}
