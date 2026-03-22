**简体中文** | [English](./README.md)

# Melu

**透明的 AI 长期记忆代理。**

Melu 是一个本地 HTTP 代理，运行在 Claude Code 和 Anthropic API 之间。它自动从对话中提取持久记忆，并在未来的会话中注入相关记忆——让你的 AI 拥有跨会话的持久记忆，数据完全存储在本地。

“Melu” 这个名字来自 **Memory Luminous**，表达的是让记忆被点亮、可被召回，并在不同会话之间持续发挥作用。

## 快速开始

只需在终端中输入以下命令即可完成安装和初始化：

```bash
npm install -g @hope666/melu
melu init
```

然后 `cd` 到你的项目目录下，运行：

```bash
melu run -- claude
```

就这么简单。现在你可以像往常一样使用 Claude Code——唯一的区别是，Melu 在后台默默工作，帮助 Claude 在不同会话之间记住你。

> **API key 和 OAuth 登录均可使用。** 无论你是通过 API key 还是 OAuth（免费/Pro 计划）认证 Claude Code，Melu 都能正常工作。经过验证，搭配 [cc-switch](https://github.com/farion1231/cc-switch) 多账号切换工具使用，记忆提取也能正常运行。

### 查看记忆

```bash
melu list
```

---

## 为什么需要 Melu？

Claude Code 是无状态的——每次会话都从零开始。Melu 解决了这个问题：

- **记住你是谁**：你的名字、偏好、工作风格、项目上下文
- **完全透明**：它是一个你可以审查的本地代理，不是黑盒
- **数据本地化**：所有记忆存储在你机器上的 SQLite `.memory` 文件中——不会向任何第三方发送数据
- **全自动运行**：不需要手动标记，不需要"保存"命令——它自动工作

---

## 工作原理

当你运行 `melu run -- claude` 时，Melu 会在 Claude Code 旁边启动一个轻量的**三进程架构**：

```
melu run -- claude
  │
  ├── 进程 1: Embedder Daemon       ← 一次性加载 embedding 模型，通过 Unix socket 提供服务
  ├── 进程 2: Proxy（端口 9800）     ← 拦截 API 请求，注入记忆
  ├── 进程 3: Extractor Worker      ← 后台持续提取记忆
  └── Claude Code                   ← 前台正常运行，完全不受影响
```

### 代理——记忆如何被注入

每当 Claude Code 向 Anthropic API 发送请求时，Melu 代理会拦截这个请求：

```
你 ↔ Claude Code ──请求──► Melu Proxy ──► Anthropic API
                              │
                     1. 接收外发请求
                     2. 清洗用户消息（剥离系统标签）
                     3. 对消息做 embedding → 搜索相关记忆
                     4. 将匹配的记忆注入 system prompt
                     5. 将修改后的请求转发到 Anthropic
                     6. 流式透传响应（SSE passthrough）
                     7. 将清洗后的消息入队等待记忆提取
```

代理只是在 system prompt 中**添加**一小段相关记忆。你的原始请求被完整保留——响应直接来自 Anthropic 的 API，逐字节流式透传回来。

### 提取器——记忆如何被创建

在你工作的同时，Extractor Worker 在后台持续运行，处理你发送的每条消息：

```
Extractor Worker（后台持续运行）
  │
  ├── 从队列取一条消息（原子文件 rename）
  ├── 调用 claude -p + 提取提示词
  ├── 解析结构化结果（content, summary, category）
  ├── 通过 Embedder Daemon 生成 embedding 向量
  ├── 与现有记忆去重
  │     · 相似度 > 0.9 → 更新已有记忆
  │     · 相似度 > 0.7 → 降低旧记忆的置信度
  └── 存入 SQLite
```

每条消息**最多产生 1 条记忆**——只保留最有价值的洞察，防止记忆膨胀。

### Embedder——本地语义搜索

Embedder Daemon 在启动时加载一个本地 embedding 模型（[Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF)，Q8_0 量化，约 600 MB），常驻内存。代理和提取器通过 Unix socket 共享同一个实例——不会重复加载模型。

记忆检索使用 **余弦相似度** 比较 embedding 向量，因此 Melu 能找到语义相关的记忆，而不仅仅是关键词匹配。

### 优雅降级

如果 Embedder Daemon 暂时不可用，代理不会阻塞——会回退到注入最近 N 条记忆。你的工作流永远不会被打断。

---

## 资源开销

Melu 被设计为轻量运行。以下是预期的资源占用：

### 内存占用

| 组件 | 大约 RSS |
|------|---------|
| Embedder Daemon（GGUF 模型通过 mmap 加载） | ~300–500 MB |
| Proxy | ~30–50 MB |
| Extractor Worker | ~30–50 MB |
| **总计** | **~400–600 MB** |

embedding 模型使用 mmap 加载，操作系统会高效管理内存页——实际物理内存占用取决于系统负载，可能低于上述数字。

### Token 开销

Melu 在每次请求中额外增加少量 token 用于记忆注入：

- **每次请求**：在 system prompt 中额外增加约 2,000–3,000 token（注入的记忆块上限为 8,000 字符）
- **每条用户消息**：后台运行 1 次 `claude -p` 提取记忆——串行执行，并发度为 1，不会与你的主会话抢占速率限制

作为参考，很多 AI agent 包装器在每次请求中会注入 10,000+ token 的系统提示词和工具定义。Melu 的额外开销相当克制——大约相当于多加了一小段上下文。

### 磁盘占用

- Embedding 模型：约 600 MB（`melu init` 时一次性下载）
- 记忆数据库：通常几 KB 到几 MB，取决于积累的记忆数量

---

## 系统要求

- **Node.js** >= 20.0.0
- **Claude Code** 已安装并完成认证
- **平台**：macOS、Linux（arm64 / x64）
- 约 600 MB 磁盘空间用于 embedding 模型

---

## 命令参考

### `melu init`

初始化：创建目录、配置文件，下载 embedding 模型，创建默认记忆数据库。

```bash
melu init [--mirror <huggingface|modelscope>]
```

| 选项 | 说明 |
|------|------|
| `--mirror` | 模型下载源：`huggingface`（全球）或 `modelscope`（中国大陆） |

### `melu run <command...>`

以持久记忆模式运行任意命令。启动代理，拦截 Anthropic API 流量，自动注入和提取记忆。

```bash
melu run [options] -- <command...>
```

| 选项 | 说明 |
|------|------|
| `-m, --memory <name>` | 记忆文件名或路径（默认：`default`） |
| `--mirror <mirror>` | 模型缺失时的下载源 |
| `-p, --port <port>` | 代理端口（默认：`9800`） |

**示例：**

```bash
melu run -- claude                          # 标准用法
melu run -m work -- claude                  # 使用独立的 "work" 记忆库
melu run -p 9801 -- claude                  # 使用不同端口
melu run -- claude --model opus             # 传递参数给 Claude
```

### `melu stop`

停止后台代理进程。

```bash
melu stop
```

### `melu list`

列出所有记忆条目。

```bash
melu list [options]
```

| 选项 | 说明 |
|------|------|
| `-m, --memory <name>` | 指定记忆文件 |
| `-a, --all` | 包括已停用（被替代）的记忆 |

### `melu show <id>`

显示单条记忆的完整信息。支持 ID 前缀匹配。

```bash
melu show <id前缀> [-m, --memory <name>]
```

### `melu delete <id>`

按 ID 前缀删除一条记忆。

```bash
melu delete <id前缀> [-m, --memory <name>]
```

### `melu clear`

清空所有活跃记忆（需确认）。

```bash
melu clear [-m, --memory <name>] [-y, --yes]
```

| 选项 | 说明 |
|------|------|
| `-y, --yes` | 跳过确认提示 |

### `melu export`

导出记忆数据库到一个可移植的 `.memory` 文件，用于备份或分享。

```bash
melu export -o <路径> [-m, --memory <name>]
```

### `melu import <source>`

从导出的 `.memory` 文件导入记忆。

```bash
melu import <源文件路径> [-m, --memory <name>]
```

### `melu status`

查看当前代理状态、记忆数量和 embedding 模型信息。

```bash
melu status [-m, --memory <name>]
```

---

## 数据与隐私

**所有数据都在你的机器上。**

```
~/.melu/
├── config.json                    # 配置文件
├── memories/
│   └── default.memory             # SQLite 记忆数据库
├── models/
│   └── Qwen3-Embedding-0.6B-Q8_0.gguf  # 本地 embedding 模型
└── ...                            # 运行时文件（socket、队列、统计）
```

- 不会向任何第三方服务发送数据
- 代理只是把你的原始请求转发到 Anthropic API（在 system prompt 中加入记忆）
- embedding 模型 100% 本地运行
- 记忆提取使用 `claude -p`，复用你现有的 Claude 认证——不需要额外的 API key

## 支持的语言

Melu 的命令行界面支持 10 种语言：

English、简体中文、繁體中文、日本語、한국어、Français、Русский、Deutsch、Español、Português

在 `melu init` 时选择语言，也可以随时在 `~/.melu/config.json` 中修改。

## 常见问题

**代理启动不了？**
- 检查端口 9800 是否被占用：`lsof -i :9800`
- 换个端口：`melu run -p 9801 -- claude`

**模型下载失败？**
- 切换镜像：`melu init --mirror modelscope`（中国大陆）或 `--mirror huggingface`（全球）
- 模型文件约 600 MB，请确保网络稳定

**记忆没有出现？**
- 退出 Claude 时会打印本次运行摘要，查看提取状态
- 查看记忆：`melu list`
- 提取器每条消息需要几秒钟——稍等片刻

**Claude 没走代理？**
- Melu 会自动为 Claude 设置 `ANTHROPIC_BASE_URL`，不需要手动配置
- 如果使用了自定义 Claude 设置，确保没有覆盖 `ANTHROPIC_BASE_URL`

## 许可证

[Apache-2.0](./LICENSE)

## 作者

**Hong Yupeng** ([@hope666](https://www.npmjs.com/~hope666))
