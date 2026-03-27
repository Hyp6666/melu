[简体中文](./README.md)

# Melu

**Give Claude Code a local observability dashboard and optional long-term memory.**

Melu is a local proxy that sits between Claude Code and the Anthropic Messages API.  
It makes each request visible, shows how prompts are packaged, reveals tool-use chains, and can optionally inject relevant long-term memories into future sessions.

## Quick Start

```bash
npm install -g @hope666/melu
melu init
melu run -- claude
```

Recommended: `Node.js v22.22.2 LTS`.

After that, Melu will:

- start a local proxy without changing your normal Claude Code workflow
- open a local dashboard automatically
- optionally enable long-term memory for later sessions

## What Melu Does

Melu focuses on two things:

1. **Make Claude Code observable**
   You can see request status, latency, token usage, request chains, prompt packaging, and model answers.
2. **Add optional local long-term memory**
   You can turn memory on when you want it, or keep Melu as a pure observability layer.

## Core Features

### 1. Local Dashboard

- overview page for run status, request volume, success rate, token totals, and request density
- detail page for per-turn inspection
- `↑ · Prompt` shows how the uploaded prompt is packaged
- `↓ · Answer` shows model replies and tool instructions
- all observability data stays local

### 2. Request-Chain Visibility

- inspect what Claude Code is doing step by step instead of only seeing "how many requests happened"
- follow flows like task start, file search, command execution, analysis, and final answer assembly
- drill into each node to inspect Prompt / Answer details

### 3. Token And Cache Clarity

- compare per-turn input, output, cache hits, and latency side by side
- useful for understanding why a turn is expensive or unexpectedly slow

### 4. Optional Local Long-Term Memory

- memory is optional
- you can enable or disable it during setup
- you can toggle it later from config
- when enabled, Melu uses a local embedding model for retrieval

## Typical Workflow

```bash
melu init
melu run -- claude
```

If you want dashboard only:

```bash
melu config memory off
melu run -- claude
```

If you want memory back:

```bash
melu config memory on
```

If you do not want the dashboard to auto-open:

```bash
melu config dashboard off
```

## How It Works

- `melu run -- claude` starts a local proxy
- Claude Code requests go through Melu first
- Melu records local traces and shows them in the dashboard
- if memory is enabled, Melu retrieves and injects relevant memories
- a background worker extracts new durable memories into a local SQLite `.memory` file

## Common Commands

```bash
melu init
melu run -- claude
melu stop
melu status
melu list
melu config show
melu config memory on
melu config memory off
melu config dashboard on
melu config dashboard off
```

## Links

- npm: [@hope666/melu](https://www.npmjs.com/package/@hope666/melu)
- GitHub: [github.com/Hyp6666/melu](https://github.com/Hyp6666/melu)
- Issues: [github.com/Hyp6666/melu/issues](https://github.com/Hyp6666/melu/issues)

## License

[Apache-2.0](./LICENSE)
