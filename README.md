[简体中文](./README.zh-CN.md) | **English**

# Melu

**Transparent long-term memory for Claude Code.**

Melu is a local HTTP proxy that sits between Claude Code and the Anthropic API. It automatically extracts durable memories from your conversations and injects relevant ones into future sessions — giving your AI persistent, cross-session memory with all data stored locally on your machine.

The name "Melu" comes from **Memory Luminous**: memory that stays lit up, retrievable, and useful across sessions.

## Quick Start

Just run these three commands in your terminal to get started:

```bash
npm install -g @hope666/melu
melu init
```

Then `cd` into your project directory and run:

```bash
melu run -- claude
```

That's it. You can now use Claude Code as usual — the only difference is that Melu is quietly working in the background, helping Claude remember you across sessions.

> **Works with both API key and OAuth login.** Whether you authenticate Claude Code with an API key or via OAuth (free/Pro plan), Melu works seamlessly. It has also been tested with [cc-switch](https://github.com/farion1231/cc-switch) for multi-account setups — memory extraction works correctly across account switches.

### Check Your Memories

```bash
melu list
```

---

## Why Melu?

Claude Code is stateless — every session starts from scratch. Melu fixes this:

- **Remembers who you are**: your name, preferences, working style, project context
- **Fully transparent**: a local proxy you can inspect, not a black box
- **Data stays local**: all memories live in a SQLite `.memory` file on your machine — nothing is sent to any third-party service
- **Fully automatic**: no manual tagging, no "save" commands — it just works

---

## How It Works

When you run `melu run -- claude`, Melu launches a lightweight **three-process architecture** alongside Claude Code:

```
melu run -- claude
  │
  ├── Process 1: Embedder Daemon       ← Loads embedding model once, serves via Unix socket
  ├── Process 2: Proxy (port 9800)     ← Intercepts API requests, injects memories
  ├── Process 3: Extractor Worker      ← Extracts memories in the background
  └── Claude Code                      ← Runs in foreground, completely unmodified
```

### The Proxy — How Memories Are Injected

Every time Claude Code sends a request to the Anthropic API, the Melu proxy intercepts it:

```
You ↔ Claude Code ──request──► Melu Proxy ──► Anthropic API
                                  │
                        1. Receive the outgoing request
                        2. Clean user message (strip system tags)
                        3. Embed the message → search for relevant memories
                        4. Inject matched memories into the system prompt
                        5. Forward modified request to Anthropic
                        6. Stream response back transparently (SSE passthrough)
                        7. Enqueue cleaned message for memory extraction
```

The proxy only **adds** a small block of relevant memories to the system prompt. Your original request is preserved — the response comes directly from Anthropic's API, streamed back byte-for-byte.

### The Extractor — How Memories Are Created

While you're working, the Extractor Worker runs in the background, processing each message you send:

```
Extractor Worker (runs continuously in background)
  │
  ├── Pick a message from the queue (atomic file rename)
  ├── Send it to claude -p with an extraction prompt
  ├── Parse the structured result (content, summary, category)
  ├── Generate embedding vector via Embedder Daemon
  ├── Deduplicate against existing memories
  │     • Similarity > 0.9 → update existing memory
  │     • Similarity > 0.7 → lower old memory's confidence
  └── Store the new memory in SQLite
```

Each message produces **at most 1 memory** — only the most valuable insight is kept, preventing memory bloat.

### The Embedder — Local Semantic Search

The Embedder Daemon loads a local embedding model ([Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF), Q8_0 quantized, ~600 MB) once at startup and keeps it resident. Both the Proxy and Extractor share this single instance via Unix socket — no redundant model loading.

Memory retrieval uses **cosine similarity** on embedding vectors, so Melu finds semantically relevant memories, not just keyword matches.

### Graceful Degradation

If the Embedder Daemon is temporarily unavailable, the Proxy doesn't block — it falls back to injecting the most recent N memories. Your workflow is never interrupted.

---

## Resource Overhead

Melu is designed to be lightweight. Here's what to expect:

### Memory Usage

| Component | Approximate RSS |
|-----------|----------------|
| Embedder Daemon (GGUF model via mmap) | ~300–500 MB |
| Proxy | ~30–50 MB |
| Extractor Worker | ~30–50 MB |
| **Total** | **~400–600 MB** |

The embedding model uses mmap, so the OS manages memory pages efficiently — actual physical memory usage depends on system load and may be lower than the numbers above.

### Token Overhead

Melu adds a small amount of extra tokens to each request for memory injection:

- **Per request**: up to ~2,000–3,000 additional tokens in the system prompt (the injected memory block is capped at 8,000 characters)
- **Per user message**: 1 background `claude -p` call for extraction — this runs serially at concurrency 1, so it won't compete with your main session for rate limits

For comparison, many AI agent wrappers inject 10,000+ tokens of system prompts and tool definitions on every request. Melu's overhead is modest — roughly comparable to adding a short paragraph of context.

### Disk Usage

- Embedding model: ~600 MB (downloaded once during `melu init`)
- Memory database: typically a few KB to a few MB, depending on how many memories you accumulate

---

## Requirements

- **Node.js** >= 20.0.0
- **Claude Code** installed and authenticated
- **Platform**: macOS, Linux (arm64 / x64)
- ~600 MB disk space for the embedding model

---

## Command Reference

### `melu init`

Initial setup: creates directories, config, downloads the embedding model, and creates the default memory database.

```bash
melu init [--mirror <huggingface|modelscope>]
```

| Option | Description |
|--------|-------------|
| `--mirror` | Model download source: `huggingface` (global) or `modelscope` (China mainland) |

### `melu run <command...>`

Run any command with persistent memory enabled. Starts the proxy, intercepts Anthropic API traffic, and automatically injects/extracts memories.

```bash
melu run [options] -- <command...>
```

| Option | Description |
|--------|-------------|
| `-m, --memory <name>` | Memory file name or path (default: `default`) |
| `--mirror <mirror>` | Model download source if model is missing |
| `-p, --port <port>` | Proxy port (default: `9800`) |

**Examples:**

```bash
melu run -- claude                          # Standard usage
melu run -m work -- claude                  # Use a separate "work" memory
melu run -p 9801 -- claude                  # Use a different port
melu run -- claude --model opus             # Pass flags through to Claude
```

### `melu stop`

Stop the background proxy process.

```bash
melu stop
```

### `melu list`

List all memory entries.

```bash
melu list [options]
```

| Option | Description |
|--------|-------------|
| `-m, --memory <name>` | Memory file to list |
| `-a, --all` | Include inactive (superseded) memories |

### `melu show <id>`

Display full details of a single memory entry. Supports ID prefix matching.

```bash
melu show <id-prefix> [-m, --memory <name>]
```

### `melu delete <id>`

Delete a memory entry by ID prefix.

```bash
melu delete <id-prefix> [-m, --memory <name>]
```

### `melu clear`

Clear all active memories (with confirmation prompt).

```bash
melu clear [-m, --memory <name>] [-y, --yes]
```

| Option | Description |
|--------|-------------|
| `-y, --yes` | Skip confirmation prompt |

### `melu export`

Export the memory database to a portable `.memory` file for backup or sharing.

```bash
melu export -o <path> [-m, --memory <name>]
```

### `melu import <source>`

Import memories from an exported `.memory` file.

```bash
melu import <source-path> [-m, --memory <name>]
```

### `melu status`

Show current proxy status, memory count, and embedding model info.

```bash
melu status [-m, --memory <name>]
```

---

## Data & Privacy

**All data stays on your machine.**

```
~/.melu/
├── config.json                    # Configuration
├── memories/
│   └── default.memory             # SQLite memory database
├── models/
│   └── Qwen3-Embedding-0.6B-Q8_0.gguf  # Local embedding model
└── ...                            # Runtime files (sockets, queues, stats)
```

- No data is sent to any third-party service
- The proxy only forwards your original requests to Anthropic's API (with memories added to the system prompt)
- The embedding model runs 100% locally
- Memory extraction uses `claude -p`, which reuses your existing Claude authentication — no extra API keys needed

## Supported Languages

Melu's CLI supports 10 languages:

English, 简体中文, 繁體中文, 日本語, 한국어, Français, Русский, Deutsch, Español, Português

Choose your language during `melu init`, or change it anytime in `~/.melu/config.json`.

## Troubleshooting

**Proxy won't start?**
- Check if port 9800 is in use: `lsof -i :9800`
- Try a different port: `melu run -p 9801 -- claude`

**Model download fails?**
- Switch mirror: `melu init --mirror modelscope` (China) or `--mirror huggingface` (global)
- The model is ~600 MB — ensure a stable connection

**Memories not appearing?**
- A run summary is printed when Claude exits — check the extraction stats
- View memories: `melu list`
- The extractor needs a few seconds per message — give it a moment

**Claude not routing through proxy?**
- Melu automatically sets `ANTHROPIC_BASE_URL` for Claude — no manual config needed
- If you use custom Claude settings, make sure they don't override `ANTHROPIC_BASE_URL`

## License

[Apache-2.0](./LICENSE)

## Author

**Hong Yupeng** ([@hope666](https://www.npmjs.com/~hope666))
