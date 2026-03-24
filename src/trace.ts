import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { TRACES_DIR } from "./config.js";

const DASHBOARD_MAX_EVENTS = 200;

export type TraceDashboardLanguage = "en" | "zh-CN";
export type ProxyTraceEventType = "upload" | "receive_start" | "receive_end" | "receive_error";

export interface ProxyTracePromptSystemBlock {
  index: number;
  type: string;
  text: string;
}

export interface ProxyTracePromptMessage {
  index: number;
  role: string;
  contentTypes: string[];
  text: string;
  toolResultOnly: boolean;
}

export interface ProxyTracePromptSnapshot {
  systemBlocks: ProxyTracePromptSystemBlock[];
  messages: ProxyTracePromptMessage[];
  rawRequestBody: string;
  rawRequestTruncated?: boolean;
}

export interface ProxyTraceToolCall {
  id?: string | null;
  name: string;
  kind: string;
  input?: unknown;
}

export interface ProxyTraceEvent {
  seq: number;
  requestId: string;
  type: ProxyTraceEventType;
  timestamp: string;
  method: string;
  path: string;
  stream: boolean;
  model: string | null;
  requestBytes: number;
  status?: number;
  responseBytes?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  note?: string;
  promptSnapshot?: ProxyTracePromptSnapshot;
  toolCalls?: ProxyTraceToolCall[];
}

interface DashboardCopy {
  pageTitle: string;
  brand: string;
  edition: string;
  navOverview: string;
  navTerminals: string;
  navAgentTree: string;
  navSettings: string;
  navHelp: string;
  headline: string;
  subtitle: string;
  liveStatus: string;
  readyStatus: string;
  steadyStatus: string;
  highTrafficWarning: string;
  runLabel: string;
  commandLabel: string;
  cwdLabel: string;
  startLabel: string;
  statusLabel: string;
  totalRequests: string;
  inFlight: string;
  successRate: string;
  latency: string;
  uploaded: string;
  downloaded: string;
  p95Label: string;
  timelineTitle: string;
  timelineRange: string;
  filterAll: string;
  filterInFlight: string;
  filterError: string;
  filterCompleted: string;
  searchPlaceholder: string;
  tableSeq: string;
  tableRequestId: string;
  tableAgent: string;
  tableType: string;
  tablePath: string;
  tableModel: string;
  tableStream: string;
  tableStatus: string;
  tableUsage: string;
  tableDuration: string;
  tableBytes: string;
  emptyTitle: string;
  emptyBody: string;
  systemReady: string;
  traceFileLabel: string;
  refreshTime: string;
  footerPath: string;
  privacyWarning: string;
  systemLogs: string;
  drawerTitle: string;
  metadata: string;
  transportLayer: string;
  contentVisibility: string;
  systemAnalysis: string;
  protectedContentTitle: string;
  protectedContentBody: string;
  protectedContentAction: string;
  reservedMemoryInjection: string;
  reservedAgentLineage: string;
  reservedPromptDetails: string;
  reservedFuture: string;
  requestIdLabel: string;
  sequenceLabel: string;
  terminalNodeLabel: string;
  activeAgentLabel: string;
  totalDurationLabel: string;
  methodLabel: string;
  endpointPathLabel: string;
  statusCodeLabel: string;
  modelLabel: string;
  noteLabel: string;
  requestBytesLabel: string;
  responseBytesLabel: string;
  inputTokensLabel: string;
  outputTokensLabel: string;
  usageLabel: string;
  eventTypeLabel: string;
  timestampLabel: string;
  mainAgent: string;
  streamMode: string;
  bufferedMode: string;
  noRequestsFound: string;
  updated: string;
  marks: string;
  dashboardReadFailed: string;
  unableToRead: string;
  uploadLabel: string;
  uploadMain: string;
  receiveLabel: string;
  receiveMain: string;
  completeLabel: string;
  completeMain: string;
  errorLabel: string;
  errorMain: string;
  successBadge: string;
  errorBadge: string;
  inFlightBadge: string;
  completedBadge: string;
  averageLatency: string;
  actionRefresh: string;
  actionSettings: string;
  actionAlerts: string;
  disconnectedStatus: string;
  offlineSnapshot: string;
  timelineLegend: string;
  promptInsightTitle: string;
  promptStructureTitle: string;
  promptBlocksTitle: string;
  messageFlowTitle: string;
  rawPromptTitle: string;
  rawPromptAction: string;
  rawToolInputAction: string;
  noPromptSnapshot: string;
  noToolActivity: string;
  rawPromptTruncatedNotice: string;
  systemBlockLabel: string;
  messageLabel: string;
  headingCountLabel: string;
  xmlTagLabel: string;
  contentTypesLabel: string;
  toolInsightTitle: string;
  toolNativeDescriptionLabel: string;
  toolCategoryFiles: string;
  toolCategorySearch: string;
  toolCategoryExecution: string;
  toolCategoryNetwork: string;
  toolCategoryCollaboration: string;
  toolCategoryPlanning: string;
  toolCategorySkill: string;
  toolCategoryUnknown: string;
  promptMessagePreviewLabel: string;
  rawRequestPayloadLabel: string;
  rawToolInputLabel: string;
  promptGroupSystem: string;
  promptGroupMemory: string;
  promptGroupUser: string;
  promptGroupTags: string;
  promptItemMainSystem: string;
  promptItemSystemBlock: string;
  promptItemMemoryInjection: string;
  promptItemUserInput: string;
  promptItemToolResult: string;
  promptItemAssistantContext: string;
  promptItemTagContext: string;
  promptItemClaudeMd: string;
  promptItemSystemReminder: string;
  promptItemTaskNotification: string;
  promptItemDeferredTools: string;
  promptItemLocalCommand: string;
  promptItemCommandContext: string;
  countBlocks: string;
  countEntries: string;
  countMessages: string;
  countKinds: string;
  countChars: string;
  toolLabelOriginalName: string;
  toolLabelDescription: string;
  toolLabelPath: string;
  toolLabelPattern: string;
  toolLabelCommand: string;
  toolLabelScope: string;
  toolLabelType: string;
  toolLabelTask: string;
  toolLabelTimeout: string;
  toolLabelUrl: string;
  toolLabelCount: string;
  toolActionRead: string;
  toolActionWrite: string;
  toolActionEdit: string;
  toolActionBrowse: string;
  toolActionSearchFiles: string;
  toolActionSearchContent: string;
  toolActionRunCommand: string;
  toolActionWebSearch: string;
  toolActionWebFetch: string;
  toolActionAgent: string;
  toolActionTodo: string;
  toolActionAskUser: string;
  toolActionSkill: string;
  toolActionPlanExit: string;
  toolActionMcp: string;
  toolActionGeneric: string;
}

const DASHBOARD_COPY: Record<TraceDashboardLanguage, DashboardCopy> = {
  en: {
    pageTitle: "Melu Trace",
    brand: "Melu Editorial",
    edition: "Observability v1",
    navOverview: "Overview",
    navTerminals: "Details",
    navAgentTree: "Agent Tree",
    navSettings: "Settings",
    navHelp: "Help",
    headline: "Operational trace, kept local.",
    subtitle: "The dashboard observes request transport and timing only. Prompt details remain hidden by design.",
    liveStatus: "Live",
    readyStatus: "Ready",
    steadyStatus: "Stable",
    highTrafficWarning: "High traffic warning: concurrency is elevated",
    runLabel: "Run ID",
    commandLabel: "Command",
    cwdLabel: "Path",
    startLabel: "Start",
    statusLabel: "Status",
    totalRequests: "Total Requests",
    inFlight: "In-flight",
    successRate: "Success Rate",
    latency: "Tokens",
    uploaded: "Up",
    downloaded: "Down",
    p95Label: "P95",
    timelineTitle: "Recent Request Density",
    timelineRange: "last 48 requests",
    filterAll: "All",
    filterInFlight: "In-flight",
    filterError: "Error",
    filterCompleted: "Completed",
    searchPlaceholder: "Search request ID...",
    tableSeq: "Seq",
    tableRequestId: "Request ID",
    tableAgent: "Agent",
    tableType: "Type",
    tablePath: "Path",
    tableModel: "Model",
    tableStream: "Stream",
    tableStatus: "Status",
    tableUsage: "Tokens",
    tableDuration: "Duration",
    tableBytes: "Bytes",
    emptyTitle: "No traffic detected yet.",
    emptyBody: "The observability engine is primed and listening. Run a command in your local terminal to start real-time monitoring of Melu proxy traffic.",
    systemReady: "System Ready",
    traceFileLabel: "Trace File",
    refreshTime: "Refresh Time",
    footerPath: "Path",
    privacyWarning: "Privacy Warning",
    systemLogs: "System Logs",
    drawerTitle: "Request Detail",
    metadata: "Metadata",
    transportLayer: "Transport Layer",
    contentVisibility: "Content Visibility",
    systemAnalysis: "System Analysis",
    protectedContentTitle: "Protected content layer",
    protectedContentBody: "Prompt text is intentionally hidden for now. This panel stays at metadata and transport visibility only.",
    protectedContentAction: "Prompt details not enabled",
    reservedMemoryInjection: "Memory Injection",
    reservedAgentLineage: "Agent Lineage",
    reservedPromptDetails: "Prompt Details",
    reservedFuture: "Reserved for a later product decision.",
    requestIdLabel: "Request ID",
    sequenceLabel: "Sequence",
    terminalNodeLabel: "Terminal",
    activeAgentLabel: "Active Agent",
    totalDurationLabel: "Total Duration",
    methodLabel: "Method",
    endpointPathLabel: "Endpoint Path",
    statusCodeLabel: "Status Code",
    modelLabel: "Model",
    noteLabel: "Note",
    requestBytesLabel: "Request Bytes",
    responseBytesLabel: "Response Bytes",
    inputTokensLabel: "Input Tokens",
    outputTokensLabel: "Output Tokens",
    usageLabel: "Tokens",
    eventTypeLabel: "Event Type",
    timestampLabel: "Timestamp",
    mainAgent: "Main",
    streamMode: "stream",
    bufferedMode: "buffered",
    noRequestsFound: "No requests match the current filter.",
    updated: "Updated",
    marks: "marks",
    dashboardReadFailed: "Dashboard read failed",
    unableToRead: "Unable to read trace events.",
    uploadLabel: "upload",
    uploadMain: "Upload intercepted",
    receiveLabel: "receive",
    receiveMain: "Response stream opened",
    completeLabel: "complete",
    completeMain: "Response stream closed",
    errorLabel: "error",
    errorMain: "Response failed",
    successBadge: "Success",
    errorBadge: "Error",
    inFlightBadge: "In-flight",
    completedBadge: "Complete",
    averageLatency: "AVG",
    actionRefresh: "Refresh",
    actionSettings: "Settings",
    actionAlerts: "Alerts",
    disconnectedStatus: "Disconnected",
    offlineSnapshot: "Offline snapshot",
    timelineLegend: "Height = request duration (seconds, scaled relatively) · Color = model",
    promptInsightTitle: "Prompt Insight",
    promptStructureTitle: "Structured Summary",
    promptBlocksTitle: "System Blocks",
    messageFlowTitle: "Message Flow",
    rawPromptTitle: "Raw Prompt",
    rawPromptAction: "Open final raw payload",
    rawToolInputAction: "Open raw tool input",
    noPromptSnapshot: "No prompt snapshot was captured for this request.",
    noToolActivity: "No tool use was captured for this request.",
    rawPromptTruncatedNotice: "The raw payload was truncated locally for dashboard rendering.",
    systemBlockLabel: "system",
    messageLabel: "message",
    headingCountLabel: "headings",
    xmlTagLabel: "XML tags",
    contentTypesLabel: "Content types",
    toolInsightTitle: "Tool Activity",
    toolNativeDescriptionLabel: "Native description",
    toolCategoryFiles: "Files",
    toolCategorySearch: "Search",
    toolCategoryExecution: "Execution",
    toolCategoryNetwork: "Network",
    toolCategoryCollaboration: "Collaboration",
    toolCategoryPlanning: "Planning",
    toolCategorySkill: "Skill",
    toolCategoryUnknown: "Tool",
    promptMessagePreviewLabel: "Preview",
    rawRequestPayloadLabel: "Raw request payload",
    rawToolInputLabel: "Raw tool input",
    promptGroupSystem: "System",
    promptGroupMemory: "Memory",
    promptGroupUser: "User",
    promptGroupTags: "Added Context",
    promptItemMainSystem: "Main System",
    promptItemSystemBlock: "System Block",
    promptItemMemoryInjection: "Memory Injection",
    promptItemUserInput: "User Input",
    promptItemToolResult: "Tool Result",
    promptItemAssistantContext: "Assistant Context",
    promptItemTagContext: "Tagged Context",
    promptItemClaudeMd: "CLAUDE.md",
    promptItemSystemReminder: "System Reminder",
    promptItemTaskNotification: "Task Notification",
    promptItemDeferredTools: "Available Tools",
    promptItemLocalCommand: "Local Command Note",
    promptItemCommandContext: "Command Context",
    countBlocks: "blocks",
    countEntries: "entries",
    countMessages: "messages",
    countKinds: "kinds",
    countChars: "chars",
    toolLabelOriginalName: "Original tool",
    toolLabelDescription: "Description",
    toolLabelPath: "Path",
    toolLabelPattern: "Pattern",
    toolLabelCommand: "Command",
    toolLabelScope: "Scope",
    toolLabelType: "Type",
    toolLabelTask: "Task",
    toolLabelTimeout: "Timeout",
    toolLabelUrl: "URL",
    toolLabelCount: "Count",
    toolActionRead: "Read File",
    toolActionWrite: "Write File",
    toolActionEdit: "Edit File",
    toolActionBrowse: "Browse Files",
    toolActionSearchFiles: "Find Files",
    toolActionSearchContent: "Search Content",
    toolActionRunCommand: "Run Command",
    toolActionWebSearch: "Search Web",
    toolActionWebFetch: "Fetch Page",
    toolActionAgent: "Spawn Subagent",
    toolActionTodo: "Update Todo",
    toolActionAskUser: "Ask User",
    toolActionSkill: "Run Skill",
    toolActionPlanExit: "Exit Plan",
    toolActionMcp: "Call MCP",
    toolActionGeneric: "Use Tool",
  },
  "zh-CN": {
    pageTitle: "Melu Trace",
    brand: "Melu 观察台",
    edition: "Observability v1",
    navOverview: "总览",
    navTerminals: "细节",
    navAgentTree: "代理树",
    navSettings: "设置",
    navHelp: "帮助",
    headline: "本地运行轨迹，只看元信息。",
    subtitle: "页面只展示请求传输与时序信息；prompt 详情暂时保持隐藏。",
    liveStatus: "运行中",
    readyStatus: "已就绪",
    steadyStatus: "稳定",
    highTrafficWarning: "高流量提醒：当前并发已升高",
    runLabel: "运行 ID",
    commandLabel: "命令",
    cwdLabel: "路径",
    startLabel: "开始时间",
    statusLabel: "状态",
    totalRequests: "总请求数",
    inFlight: "进行中",
    successRate: "成功率",
    latency: "Tokens",
    uploaded: "上传",
    downloaded: "下载",
    p95Label: "P95",
    timelineTitle: "最近请求密度",
    timelineRange: "最近 48 条请求",
    filterAll: "全部",
    filterInFlight: "进行中",
    filterError: "错误",
    filterCompleted: "已完成",
    searchPlaceholder: "搜索请求 ID...",
    tableSeq: "序号",
    tableRequestId: "请求 ID",
    tableAgent: "代理",
    tableType: "类型",
    tablePath: "路径",
    tableModel: "模型",
    tableStream: "流式",
    tableStatus: "状态",
    tableUsage: "Tokens",
    tableDuration: "耗时",
    tableBytes: "字节",
    emptyTitle: "还没有检测到流量。",
    emptyBody: "观察面板已经就绪。请在本地终端运行命令，开始查看 Melu 代理的实时流量。",
    systemReady: "系统就绪",
    traceFileLabel: "追踪文件",
    refreshTime: "刷新时间",
    footerPath: "路径",
    privacyWarning: "隐私说明",
    systemLogs: "系统日志",
    drawerTitle: "请求详情",
    metadata: "元数据",
    transportLayer: "传输层",
    contentVisibility: "内容可见性",
    systemAnalysis: "系统分析",
    protectedContentTitle: "受保护的内容层",
    protectedContentBody: "当前版本有意不展示 prompt 原文。这里仅保留元数据与传输层可见性。",
    protectedContentAction: "暂不开放 prompt 详情",
    reservedMemoryInjection: "记忆注入",
    reservedAgentLineage: "代理谱系",
    reservedPromptDetails: "Prompt 详情",
    reservedFuture: "此区域保留给后续产品决策。",
    requestIdLabel: "请求 ID",
    sequenceLabel: "序号",
    terminalNodeLabel: "终端",
    activeAgentLabel: "当前代理",
    totalDurationLabel: "总耗时",
    methodLabel: "方法",
    endpointPathLabel: "接口路径",
    statusCodeLabel: "状态码",
    modelLabel: "模型",
    noteLabel: "备注",
    requestBytesLabel: "请求字节",
    responseBytesLabel: "响应字节",
    inputTokensLabel: "Input Tokens",
    outputTokensLabel: "Output Tokens",
    usageLabel: "Tokens",
    eventTypeLabel: "事件类型",
    timestampLabel: "时间",
    mainAgent: "主代理",
    streamMode: "流式",
    bufferedMode: "非流式",
    noRequestsFound: "当前筛选条件下没有请求。",
    updated: "更新于",
    marks: "条标记",
    dashboardReadFailed: "读取仪表盘失败",
    unableToRead: "无法读取 trace 事件。",
    uploadLabel: "上传",
    uploadMain: "请求进入代理",
    receiveLabel: "接收",
    receiveMain: "已收到上游响应头",
    completeLabel: "完成",
    completeMain: "响应结束",
    errorLabel: "错误",
    errorMain: "响应失败",
    successBadge: "成功",
    errorBadge: "错误",
    inFlightBadge: "进行中",
    completedBadge: "完成",
    averageLatency: "平均",
    actionRefresh: "刷新",
    actionSettings: "设置",
    actionAlerts: "提醒",
    disconnectedStatus: "已断开",
    offlineSnapshot: "离线快照",
    timelineLegend: "柱高 = 请求耗时（按秒相对缩放） · 颜色 = 模型",
    promptInsightTitle: "Prompt 透视",
    promptStructureTitle: "结构化摘要",
    promptBlocksTitle: "System Blocks",
    messageFlowTitle: "消息结构",
    rawPromptTitle: "原始 Prompt",
    rawPromptAction: "展开最终原始载荷",
    rawToolInputAction: "展开原始工具输入",
    noPromptSnapshot: "这条请求没有捕获到 prompt 快照。",
    noToolActivity: "这条请求没有捕获到工具调用。",
    rawPromptTruncatedNotice: "原始载荷过长，已在本地仪表板里截断展示。",
    systemBlockLabel: "system",
    messageLabel: "消息",
    headingCountLabel: "段标题",
    xmlTagLabel: "XML 标签",
    contentTypesLabel: "内容类型",
    toolInsightTitle: "工具调用",
    toolNativeDescriptionLabel: "原生说明",
    toolCategoryFiles: "文件",
    toolCategorySearch: "搜索",
    toolCategoryExecution: "执行",
    toolCategoryNetwork: "网络",
    toolCategoryCollaboration: "协作",
    toolCategoryPlanning: "规划",
    toolCategorySkill: "技能",
    toolCategoryUnknown: "工具",
    promptMessagePreviewLabel: "预览",
    rawRequestPayloadLabel: "原始请求载荷",
    rawToolInputLabel: "原始工具输入",
    promptGroupSystem: "系统",
    promptGroupMemory: "记忆",
    promptGroupUser: "用户",
    promptGroupTags: "附加标签",
    promptItemMainSystem: "主系统",
    promptItemSystemBlock: "系统块",
    promptItemMemoryInjection: "记忆注入",
    promptItemUserInput: "用户输入",
    promptItemToolResult: "工具结果",
    promptItemAssistantContext: "助手上下文",
    promptItemTagContext: "标签上下文",
    promptItemClaudeMd: "CLAUDE.md",
    promptItemSystemReminder: "系统提醒",
    promptItemTaskNotification: "任务通知",
    promptItemDeferredTools: "可用工具",
    promptItemLocalCommand: "本地命令说明",
    promptItemCommandContext: "命令上下文",
    countBlocks: "段",
    countEntries: "条",
    countMessages: "条",
    countKinds: "类",
    countChars: "字",
    toolLabelOriginalName: "原始工具",
    toolLabelDescription: "原生说明",
    toolLabelPath: "路径",
    toolLabelPattern: "关键词",
    toolLabelCommand: "命令",
    toolLabelScope: "范围",
    toolLabelType: "类型",
    toolLabelTask: "任务",
    toolLabelTimeout: "超时",
    toolLabelUrl: "地址",
    toolLabelCount: "数量",
    toolActionRead: "读取文件",
    toolActionWrite: "写入文件",
    toolActionEdit: "修改文件",
    toolActionBrowse: "浏览目录",
    toolActionSearchFiles: "搜索文件",
    toolActionSearchContent: "搜索内容",
    toolActionRunCommand: "执行命令",
    toolActionWebSearch: "联网搜索",
    toolActionWebFetch: "抓取网页",
    toolActionAgent: "派出子代理",
    toolActionTodo: "更新 Todo",
    toolActionAskUser: "请求输入",
    toolActionSkill: "调用技能",
    toolActionPlanExit: "结束规划",
    toolActionMcp: "调用 MCP",
    toolActionGeneric: "调用工具",
  },
};

function getTraceRunDir(runId: string): string {
  return join(TRACES_DIR, runId);
}

export function getTraceEventsPath(runId: string): string {
  return join(getTraceRunDir(runId), "events.jsonl");
}

function ensureTraceDir(runId: string): void {
  const dir = getTraceRunDir(runId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function appendProxyTraceEvent(runId: string, event: ProxyTraceEvent): void {
  ensureTraceDir(runId);
  appendFileSync(getTraceEventsPath(runId), `${JSON.stringify(event)}\n`, "utf-8");
}

export function readProxyTraceEvents(runId: string, limit = DASHBOARD_MAX_EVENTS): ProxyTraceEvent[] {
  const eventsPath = getTraceEventsPath(runId);
  if (!existsSync(eventsPath)) return [];

  try {
    const raw = readFileSync(eventsPath, "utf-8");
    const events = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as ProxyTraceEvent;
        } catch {
          return null;
        }
      })
      .filter((event): event is ProxyTraceEvent => event !== null);
    return events.slice(-limit);
  } catch {
    return [];
  }
}

export function buildProxyTraceDashboardHtml(
  runId: string,
  language: TraceDashboardLanguage = "en",
): string {
  const copy = DASHBOARD_COPY[language];
  const serializedRunId = JSON.stringify(runId);
  const serializedCopy = JSON.stringify(copy);
  const serializedTracePath = JSON.stringify(`~/.melu/traces/${runId}/events.jsonl`);

  return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${copy.pageTitle}</title>
  <style>
    :root {
      --bg: #fbf9f6;
      --bg-soft: #f3efe9;
      --paper: rgba(255, 255, 255, 0.86);
      --paper-strong: #ffffff;
      --ink: #171717;
      --muted: #6c685f;
      --line: rgba(41, 34, 26, 0.12);
      --line-soft: rgba(41, 34, 26, 0.06);
      --primary: #532aa8;
      --primary-soft: rgba(83, 42, 168, 0.12);
      --secondary: #735c00;
      --secondary-soft: rgba(115, 92, 0, 0.12);
      --success: #166534;
      --success-soft: rgba(22, 101, 52, 0.1);
      --error: #9d1f1f;
      --error-soft: rgba(157, 31, 31, 0.1);
      --haiku: #2ca56a;
      --haiku-soft: rgba(44, 165, 106, 0.18);
      --sonnet: #bbc91d;
      --sonnet-soft: rgba(187, 201, 29, 0.2);
      --opus: #ff8a1e;
      --opus-soft: rgba(255, 138, 30, 0.2);
      --shadow: 0 24px 60px rgba(47, 37, 28, 0.08);
      --serif: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      --sans: "Avenir Next", "Segoe UI", sans-serif;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }

    * {
      box-sizing: border-box;
    }

    html, body {
      margin: 0;
      min-height: 100%;
      background:
        linear-gradient(rgba(64, 50, 39, 0.028) 1px, transparent 1px),
        linear-gradient(90deg, rgba(64, 50, 39, 0.028) 1px, transparent 1px),
        linear-gradient(180deg, #fbf9f6 0%, #f7f4ee 100%);
      background-size: 28px 28px, 28px 28px, 100% 100%;
      color: var(--ink);
      font-family: var(--sans);
    }

    body {
      overflow: hidden;
    }

    button, input {
      font: inherit;
    }

    a {
      color: inherit;
      text-decoration: none;
    }

    [hidden] {
      display: none !important;
    }

    .app-shell {
      height: 100vh;
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr);
      grid-template-rows: 80px minmax(0, 1fr) 44px;
      grid-template-areas:
        "sidebar topbar"
        "sidebar main"
        "sidebar footer";
    }

    .sidebar {
      grid-area: sidebar;
      background: rgba(245, 241, 235, 0.92);
      border-right: 1px solid var(--line);
      padding: 36px 24px;
      display: flex;
      flex-direction: column;
      gap: 28px;
      backdrop-filter: blur(10px);
    }

    .brand-title {
      font-family: var(--serif);
      font-size: 29px;
      line-height: 1;
      letter-spacing: -0.03em;
    }

    .brand-subtitle {
      margin-top: 6px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.18em;
    }

    .nav-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 10px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      transition: background 140ms ease, color 140ms ease, transform 140ms ease;
    }

    .nav-item.active {
      color: var(--primary);
      background: rgba(83, 42, 168, 0.08);
      transform: translateX(3px);
    }

    .nav-item:hover {
      background: rgba(23, 23, 23, 0.04);
    }

    .nav-mark {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: currentColor;
      opacity: 0.8;
      flex: none;
    }

    .topbar {
      grid-area: topbar;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      padding: 0 32px;
      border-bottom: 1px solid var(--line);
      background: rgba(251, 249, 246, 0.92);
      backdrop-filter: blur(10px);
    }

    .topbar-left {
      min-width: 0;
      display: flex;
      align-items: baseline;
      gap: 14px;
    }

    .topbar-brand {
      font-family: var(--serif);
      font-size: 28px;
      line-height: 1;
      letter-spacing: -0.03em;
    }

    .topbar-meta {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
      letter-spacing: 0.01em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .topbar-tagline {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.4;
    }

    .topbar-actions {
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .action-chip {
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.72);
      color: var(--muted);
      padding: 10px 14px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      transition: border-color 140ms ease, color 140ms ease, transform 140ms ease;
    }

    .action-chip:hover {
      color: var(--primary);
      border-color: rgba(83, 42, 168, 0.3);
      transform: translateY(-1px);
    }

    .main {
      grid-area: main;
      overflow: auto;
      padding: 32px;
      scroll-behavior: smooth;
    }

    .main-inner {
      max-width: 1320px;
      margin: 0 auto;
      display: grid;
      gap: 28px;
    }

    .main-section {
      scroll-margin-top: 24px;
    }

    .warning-banner {
      display: none;
      align-items: center;
      gap: 10px;
      align-self: start;
      max-width: 360px;
      padding: 12px 14px;
      background: rgba(157, 31, 31, 0.08);
      border: 1px solid rgba(157, 31, 31, 0.18);
      border-radius: 14px;
      color: var(--error);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.15em;
    }

    .warning-banner.is-visible {
      display: inline-flex;
    }

    .warning-dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: currentColor;
      box-shadow: 0 0 12px rgba(157, 31, 31, 0.35);
      flex: none;
    }

    .session-strip {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, auto));
      gap: 0;
      border: 1px solid var(--line);
      background: var(--paper);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: var(--shadow);
    }

    .session-cell {
      padding: 18px 20px;
      border-right: 1px solid var(--line-soft);
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .session-cell:last-child {
      border-right: 0;
    }

    .session-label {
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      white-space: nowrap;
    }

    .session-value {
      min-width: 0;
      font-size: 12px;
      line-height: 1.5;
      color: var(--ink);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mono {
      font-family: var(--mono);
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--success);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.15em;
    }

    .status-pill[data-tone="ready"] {
      color: var(--muted);
    }

    .status-pill[data-tone="steady"] {
      color: var(--primary);
    }

    .status-pill[data-tone="warning"] {
      color: var(--secondary);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: currentColor;
      box-shadow: 0 0 12px currentColor;
      flex: none;
    }

    .empty-view,
    .page-view {
      display: none;
    }

    .empty-view.is-visible,
    .page-view.is-visible {
      display: grid;
    }

    .empty-view {
      min-height: 62vh;
      place-items: center;
      padding: 12px;
    }

    .empty-panel {
      width: min(720px, 100%);
      background: rgba(255, 255, 255, 0.82);
      border: 1px solid var(--line);
      border-radius: 28px;
      box-shadow: var(--shadow);
      padding: 40px 36px;
      text-align: center;
      display: grid;
      gap: 18px;
    }

    .empty-illustration {
      width: 168px;
      height: 168px;
      margin: 0 auto 4px;
      border-radius: 999px;
      position: relative;
      background:
        radial-gradient(circle at center, rgba(83, 42, 168, 0.12), transparent 58%),
        radial-gradient(circle at center, rgba(115, 92, 0, 0.08), transparent 76%);
    }

    .empty-illustration::before,
    .empty-illustration::after {
      content: "";
      position: absolute;
      inset: 18px;
      border: 1px solid rgba(23, 23, 23, 0.08);
      border-radius: 999px;
    }

    .empty-illustration::after {
      inset: 40px;
    }

    .empty-card {
      position: absolute;
      inset: 42px;
      border-radius: 24px;
      background: rgba(255, 255, 255, 0.88);
      border: 1px solid rgba(23, 23, 23, 0.08);
      display: grid;
      place-items: center;
      box-shadow: 0 10px 24px rgba(40, 30, 20, 0.08);
      font-size: 42px;
      color: rgba(83, 42, 168, 0.45);
      font-weight: 600;
    }

    .empty-title {
      margin: 0;
      font-family: var(--serif);
      font-size: 42px;
      line-height: 1.05;
      letter-spacing: -0.04em;
    }

    .empty-body {
      margin: 0 auto;
      max-width: 42ch;
      color: var(--muted);
      line-height: 1.8;
    }

    .empty-meta {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin: 0 auto;
      padding: 10px 14px;
      border-radius: 999px;
      background: rgba(23, 23, 23, 0.05);
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.15em;
    }

    .page-view {
      gap: 24px;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 18px;
    }

    .metric-card {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 22px;
      padding: 22px;
      box-shadow: var(--shadow);
    }

    .metric-label-row {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }

    .metric-label {
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.22em;
    }

    .metric-mark {
      width: 11px;
      height: 11px;
      border-radius: 999px;
      background: currentColor;
      opacity: 0.9;
      flex: none;
      box-shadow: 0 0 10px rgba(0, 0, 0, 0.08);
    }

    .metric-mark.primary {
      color: var(--primary);
    }

    .metric-mark.secondary {
      color: var(--secondary);
    }

    .metric-mark.success {
      color: var(--success);
    }

    .metric-mark.neutral {
      color: var(--muted);
    }

    .metric-value {
      font-family: var(--serif);
      font-size: clamp(34px, 4vw, 54px);
      line-height: 0.98;
      letter-spacing: -0.05em;
    }

    .metric-sub {
      margin-top: 12px;
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      color: var(--muted);
      font-size: 11px;
      font-family: var(--mono);
    }

    .panel {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .panel-head {
      padding: 16px 22px;
      border-bottom: 1px solid var(--line-soft);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      background: rgba(245, 241, 235, 0.45);
    }

    .panel-title {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      color: var(--muted);
    }

    .panel-meta {
      color: var(--muted);
      font-size: 11px;
      font-family: var(--mono);
    }

    .timeline-body {
      height: 210px;
      padding: 20px 22px 26px;
      display: flex;
      align-items: end;
      gap: 8px;
      overflow-x: auto;
    }

    .timeline-bar {
      appearance: none;
      border: 0;
      border-radius: 999px 999px 5px 5px;
      width: 12px;
      min-width: 12px;
      padding: 0;
      cursor: pointer;
      opacity: 0.92;
      transition: transform 140ms ease, opacity 140ms ease;
      background: rgba(83, 42, 168, 0.18);
      box-shadow: inset 0 0 0 1px rgba(83, 42, 168, 0.08);
    }

    .timeline-bar:hover {
      transform: translateY(-2px);
      opacity: 1;
    }

    .timeline-bar.done {
      background: linear-gradient(180deg, rgba(22, 101, 52, 0.92), rgba(22, 101, 52, 0.14));
      box-shadow: inset 0 0 0 1px rgba(22, 101, 52, 0.12);
    }

    .timeline-bar.error {
      background: linear-gradient(180deg, rgba(157, 31, 31, 0.92), rgba(157, 31, 31, 0.16));
      box-shadow: inset 0 0 0 1px rgba(157, 31, 31, 0.12);
    }

    .timeline-bar.in-flight {
      background: linear-gradient(180deg, rgba(115, 92, 0, 0.92), rgba(115, 92, 0, 0.14));
      box-shadow: inset 0 0 0 1px rgba(115, 92, 0, 0.12);
    }

    .controls {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      align-items: center;
    }

    .filter-group {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .filter-button {
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.72);
      color: var(--muted);
      padding: 10px 16px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      transition: color 140ms ease, border-color 140ms ease, background 140ms ease;
    }

    .filter-button:hover {
      border-color: rgba(83, 42, 168, 0.24);
      color: var(--primary);
    }

    .filter-button.active {
      background: var(--primary);
      border-color: var(--primary);
      color: #ffffff;
    }

    .search-wrap {
      min-width: min(340px, 100%);
      position: relative;
    }

    .search-wrap input {
      width: 100%;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.78);
      border-radius: 999px;
      padding: 12px 16px;
      color: var(--ink);
      outline: none;
    }

    .search-wrap input:focus {
      border-color: rgba(83, 42, 168, 0.28);
      box-shadow: 0 0 0 3px rgba(83, 42, 168, 0.07);
    }

    .request-table-wrap {
      overflow: auto;
    }

    .request-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      min-width: 980px;
    }

    .request-table thead th {
      position: sticky;
      top: 0;
      background: rgba(245, 241, 235, 0.9);
      border-bottom: 1px solid var(--line-soft);
      color: var(--muted);
      text-align: left;
      padding: 16px 20px;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.18em;
    }

    .request-table tbody td {
      padding: 16px 18px;
      border-bottom: 1px solid var(--line-soft);
      font-size: 12px;
      vertical-align: middle;
    }

    .request-row {
      cursor: pointer;
      transition: background 140ms ease;
    }

    .request-row:hover {
      background: rgba(23, 23, 23, 0.028);
    }

    .request-row.is-selected {
      background: rgba(83, 42, 168, 0.06);
    }

    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 88px;
      padding: 7px 10px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      border: 1px solid transparent;
    }

    .badge.success {
      background: rgba(22, 101, 52, 0.16);
      color: var(--success);
      border-color: rgba(22, 101, 52, 0.18);
    }

    .badge.error {
      background: rgba(157, 31, 31, 0.16);
      color: var(--error);
      border-color: rgba(157, 31, 31, 0.18);
    }

    .badge.in-flight {
      background: rgba(115, 92, 0, 0.16);
      color: var(--secondary);
      border-color: rgba(115, 92, 0, 0.18);
    }

    .type-chip {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.16em;
    }

    .model-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      max-width: 100%;
      padding: 8px 12px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.02em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border: 1px solid transparent;
    }

    .model-chip::before {
      content: "";
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: currentColor;
      box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.04);
      flex: none;
    }

    .model-chip.haiku {
      background: var(--haiku-soft);
      color: var(--haiku);
      border-color: rgba(44, 165, 106, 0.22);
    }

    .model-chip.sonnet {
      background: var(--sonnet-soft);
      color: #7f8600;
      border-color: rgba(187, 201, 29, 0.26);
    }

    .model-chip.opus {
      background: var(--opus-soft);
      color: #bf5b00;
      border-color: rgba(255, 138, 30, 0.28);
    }

    .model-chip.generic {
      background: rgba(23, 23, 23, 0.06);
      color: var(--muted);
      border-color: rgba(23, 23, 23, 0.08);
    }

    .timeline-bar.haiku {
      background: linear-gradient(180deg, rgba(44, 165, 106, 0.96), rgba(44, 165, 106, 0.16));
      box-shadow: inset 0 0 0 1px rgba(44, 165, 106, 0.16);
    }

    .timeline-bar.sonnet {
      background: linear-gradient(180deg, rgba(187, 201, 29, 0.96), rgba(187, 201, 29, 0.18));
      box-shadow: inset 0 0 0 1px rgba(187, 201, 29, 0.2);
    }

    .timeline-bar.opus {
      background: linear-gradient(180deg, rgba(255, 138, 30, 0.98), rgba(255, 138, 30, 0.18));
      box-shadow: inset 0 0 0 1px rgba(255, 138, 30, 0.22);
    }

    .timeline-bar.generic {
      background: linear-gradient(180deg, rgba(83, 42, 168, 0.92), rgba(83, 42, 168, 0.16));
      box-shadow: inset 0 0 0 1px rgba(83, 42, 168, 0.1);
    }

    .timeline-bar.is-error {
      outline: 2px solid rgba(157, 31, 31, 0.45);
      outline-offset: 2px;
    }

    .timeline-bar.is-in-flight {
      opacity: 0.88;
      animation: pulse-track 1.5s ease-in-out infinite;
    }

    @keyframes pulse-track {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-2px); }
    }

    .seq-stack {
      display: grid;
      gap: 6px;
    }

    .request-id-hint {
      color: var(--muted);
      font-size: 10px;
      line-height: 1.3;
      letter-spacing: 0.02em;
      max-width: 14ch;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      opacity: 0.88;
    }

    .table-subtle {
      color: var(--muted);
      font-size: 11px;
    }

    .drawer-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(20, 16, 12, 0.1);
      opacity: 0;
      z-index: 60;
      transition: opacity 220ms ease;
    }

    .drawer-backdrop.is-open {
      opacity: 1;
    }

    .drawer {
      position: fixed;
      top: clamp(22px, 5vh, 42px);
      left: 50%;
      bottom: clamp(22px, 5vh, 42px);
      width: min(1120px, calc(100vw - 88px));
      background: rgba(251, 249, 246, 0.98);
      border: 1px solid var(--line);
      border-radius: 28px;
      box-shadow: 0 24px 80px rgba(35, 29, 23, 0.18);
      z-index: 70;
      display: flex;
      flex-direction: column;
      transform: translate(-50%, 18px) scale(0.985);
      opacity: 0;
      transition: transform 220ms ease, opacity 220ms ease;
      backdrop-filter: blur(14px);
      overflow: hidden;
    }

    .drawer.is-open {
      transform: translate(-50%, 0) scale(1);
      opacity: 1;
    }

    .drawer-head {
      padding: 22px 26px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: rgba(245, 241, 235, 0.72);
    }

    .drawer-title {
      font-family: var(--mono);
      font-size: 12px;
      font-weight: 700;
      color: var(--ink);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .drawer-close {
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.84);
      color: var(--muted);
      border-radius: 999px;
      width: 36px;
      height: 36px;
      display: inline-grid;
      place-items: center;
      padding: 0;
      font-size: 22px;
      line-height: 1;
      font-weight: 500;
    }

    .drawer-body {
      flex: 1;
      overflow: auto;
      padding: 24px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 24px;
    }

    .detail-section {
      background: rgba(255, 255, 255, 0.68);
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 20px;
    }

    .detail-section-wide {
      grid-column: 1 / -1;
    }

    .detail-title {
      margin: 0 0 16px;
      font-family: var(--serif);
      font-size: 24px;
      line-height: 1;
      letter-spacing: -0.03em;
      color: var(--primary);
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px 16px;
    }

    .meta-label {
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      margin-bottom: 6px;
    }

    .meta-value {
      font-size: 12px;
      line-height: 1.6;
      color: var(--ink);
      word-break: break-word;
    }

    .meta-value.emphasis {
      color: var(--primary);
      font-weight: 700;
    }

    .transport-list {
      display: grid;
      gap: 12px;
    }

    .transport-row {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 18px;
      border-bottom: 1px solid var(--line-soft);
      padding-bottom: 12px;
    }

    .transport-row:last-child {
      border-bottom: 0;
      padding-bottom: 0;
    }

    .transport-label {
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.16em;
    }

    .transport-value {
      text-align: right;
      font-size: 12px;
      line-height: 1.6;
      color: var(--ink);
      max-width: 60%;
      word-break: break-word;
    }

    .insight-stack,
    .tool-stack {
      display: grid;
      gap: 14px;
    }

    .accordion-group,
    .tool-item,
    .nested-item,
    .raw-panel details {
      border: 1px solid var(--line-soft);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.58);
      overflow: hidden;
    }

    .accordion-group summary,
    .tool-item summary,
    .nested-item summary,
    .raw-panel summary {
      list-style: none;
      cursor: pointer;
    }

    .accordion-group summary::-webkit-details-marker,
    .tool-item summary::-webkit-details-marker,
    .nested-item summary::-webkit-details-marker,
    .raw-panel summary::-webkit-details-marker {
      display: none;
    }

    .accordion-summary {
      padding: 16px 18px;
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 16px;
    }

    .accordion-title-wrap {
      display: grid;
      gap: 6px;
      min-width: 0;
    }

    .accordion-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--ink);
      line-height: 1.3;
    }

    .tool-item .accordion-title {
      font-size: 18px;
      line-height: 1.2;
    }

    .accordion-note {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.7;
      word-break: break-word;
    }

    .accordion-badge {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 11px;
      border-radius: 999px;
      background: rgba(83, 42, 168, 0.08);
      color: var(--primary);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .accordion-group > summary::after,
    .tool-item > summary::after,
    .nested-item > summary::after,
    .raw-panel summary::after {
      content: "+";
      position: absolute;
      right: 18px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--primary);
      font-size: 18px;
      line-height: 1;
    }

    .accordion-group > summary,
    .tool-item > summary,
    .nested-item > summary,
    .raw-panel summary {
      position: relative;
      padding-right: 48px;
    }

    .accordion-group[open] > summary::after,
    .tool-item[open] > summary::after,
    .nested-item[open] > summary::after,
    .raw-panel details[open] summary::after {
      content: "−";
    }

    .accordion-body,
    .tool-body,
    .nested-body,
    .raw-panel-body {
      border-top: 1px solid var(--line-soft);
      padding: 0 18px 18px;
      display: grid;
      gap: 12px;
    }

    .accordion-body {
      padding-top: 16px;
    }

    .nested-list {
      display: grid;
      gap: 10px;
    }

    .nested-item {
      background: rgba(247, 244, 239, 0.72);
    }

    .nested-item .accordion-summary {
      padding: 13px 14px;
    }

    .nested-item .accordion-title {
      font-size: 13px;
    }

    .nested-item .accordion-note {
      font-size: 10px;
    }

    .block-meta,
    .detail-list {
      display: grid;
      gap: 8px;
    }

    .block-meta {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.7;
    }

    .block-content {
      font-size: 12px;
      line-height: 1.85;
      color: var(--ink);
      white-space: pre-wrap;
      word-break: break-word;
      background: rgba(255, 255, 255, 0.7);
      border-radius: 14px;
      padding: 14px 15px;
    }

    .detail-row {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 18px;
      border-bottom: 1px solid var(--line-soft);
      padding-bottom: 10px;
    }

    .detail-row:last-child {
      border-bottom: 0;
      padding-bottom: 0;
    }

    .detail-row-label {
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      flex: 0 0 auto;
    }

    .detail-row-value {
      color: var(--ink);
      font-size: 12px;
      line-height: 1.75;
      text-align: right;
      word-break: break-word;
      max-width: 70%;
    }

    .raw-panel {
      display: grid;
      gap: 14px;
    }

    .raw-panel summary {
      padding-right: 48px;
    }

    .raw-panel-body {
      padding-top: 16px;
    }

    .raw-note {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.7;
    }

    .raw-pre {
      margin: 0;
      padding: 14px;
      border-radius: 12px;
      background: rgba(23, 23, 23, 0.94);
      color: rgba(255, 255, 255, 0.9);
      font-size: 11px;
      line-height: 1.75;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: var(--mono);
    }

    .tool-meta {
      display: grid;
      gap: 8px;
    }

    .tool-empty,
    .insight-empty {
      padding: 14px 16px;
      border-radius: 16px;
      border: 1px dashed rgba(83, 42, 168, 0.18);
      background: rgba(255, 255, 255, 0.46);
      color: var(--muted);
      font-size: 12px;
      line-height: 1.8;
    }

    .footer {
      grid-area: footer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 0 32px;
      border-top: 1px solid var(--line);
      background: rgba(251, 249, 246, 0.92);
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.15em;
    }

    .footer-left,
    .footer-right {
      display: flex;
      align-items: center;
      gap: 18px;
      min-width: 0;
    }

    @media (max-width: 1100px) {
      .metric-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .session-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .hero {
        flex-direction: column;
        align-items: start;
      }
    }

    @media (max-width: 900px) {
      .app-shell {
        grid-template-columns: 1fr;
        grid-template-rows: 80px minmax(0, 1fr) 44px;
        grid-template-areas:
          "topbar"
          "main"
          "footer";
      }

      .sidebar {
        display: none;
      }

      .main {
        padding: 18px;
      }

      .topbar,
      .footer {
        padding-left: 18px;
        padding-right: 18px;
      }

      .metric-grid {
        grid-template-columns: 1fr;
      }

      .session-strip {
        grid-template-columns: 1fr;
      }

      .session-cell {
        border-right: 0;
        border-bottom: 1px solid var(--line-soft);
      }

      .session-cell:last-child {
        border-bottom: 0;
      }

      .meta-grid {
        grid-template-columns: 1fr;
      }

      .drawer {
        top: 10px;
        bottom: 10px;
        width: calc(100vw - 20px);
        border-radius: 22px;
      }

      .drawer-body {
        grid-template-columns: 1fr;
        padding: 18px;
      }

      .detail-section-wide {
        grid-column: auto;
      }
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <aside class="sidebar">
      <div>
        <div class="brand-title">${copy.brand}</div>
        <div class="brand-subtitle">${copy.edition}</div>
      </div>

      <div class="nav-group">
        <a class="nav-item active" href="#" data-view="overview"><span class="nav-mark"></span>${copy.navOverview}</a>
        <a class="nav-item" href="#" data-view="details"><span class="nav-mark"></span>${copy.navTerminals}</a>
      </div>

      <div class="nav-group" style="margin-top:auto;">
        <a class="nav-item" href="#"><span class="nav-mark"></span>${copy.navSettings}</a>
        <a class="nav-item" href="#"><span class="nav-mark"></span>${copy.navHelp}</a>
      </div>
    </aside>

    <header class="topbar">
      <div class="topbar-left">
        <div class="topbar-brand">${copy.brand}</div>
        <div class="topbar-meta">
          <span class="topbar-tagline">- ${copy.headline}</span>
        </div>
      </div>
      <div class="topbar-actions">
        <button id="refresh-button" class="action-chip">${copy.actionRefresh}</button>
        <button class="action-chip" type="button">${copy.actionSettings}</button>
        <button class="action-chip" type="button">${copy.actionAlerts}</button>
      </div>
    </header>

    <main class="main">
      <div class="main-inner">
        <section class="session-strip">
          <div class="session-cell">
            <span class="session-label">${copy.runLabel}</span>
            <span id="session-run-id" class="session-value mono request-id-hint"></span>
          </div>
          <div class="session-cell">
            <span class="session-label">${copy.commandLabel}</span>
            <span id="session-command" class="session-value mono"></span>
          </div>
          <div class="session-cell">
            <span class="session-label">${copy.cwdLabel}</span>
            <span id="session-cwd" class="session-value mono"></span>
          </div>
          <div class="session-cell">
            <span class="session-label">${copy.statusLabel}</span>
            <span id="session-status-pill" class="status-pill"><span class="status-dot"></span><span id="session-status-text"></span></span>
          </div>
          <div class="session-cell">
            <span class="session-label">${copy.startLabel}</span>
            <span id="session-start" class="session-value mono"></span>
          </div>
        </section>

        <div id="traffic-warning" class="warning-banner">
          <span class="warning-dot"></span>
          <span>${copy.highTrafficWarning}</span>
        </div>

        <section id="empty-state" class="empty-view">
          <div class="empty-panel">
            <div class="empty-illustration">
              <div class="empty-card">M</div>
            </div>
            <h2 id="empty-title" class="empty-title">${copy.emptyTitle}</h2>
            <p id="empty-body" class="empty-body">${copy.emptyBody}</p>
            <div class="empty-meta"><span class="status-dot" style="color:var(--success)"></span><span>${copy.systemReady}</span></div>
            <div id="empty-trace-path" class="mono" style="font-size:12px;color:var(--muted);word-break:break-word;"></div>
          </div>
        </section>

        <section id="overview-state" class="page-view is-visible">
          <section class="metric-grid">
            <article class="metric-card">
              <div class="metric-label-row">
                <span class="metric-label">${copy.totalRequests}</span>
                <span class="metric-mark primary"></span>
              </div>
              <div id="card-total" class="metric-value">0</div>
              <div class="metric-sub">
                <span id="card-up">${copy.uploadLabel} 0</span>
                <span id="card-down">${copy.receiveLabel} 0</span>
              </div>
            </article>

            <article class="metric-card">
              <div class="metric-label-row">
                <span class="metric-label">${copy.inFlight}</span>
                <span class="metric-mark secondary"></span>
              </div>
              <div id="card-inflight" class="metric-value">0</div>
              <div id="card-inflight-sub" class="metric-sub">${copy.readyStatus}</div>
            </article>

            <article class="metric-card">
              <div class="metric-label-row">
                <span class="metric-label">${copy.successRate}</span>
                <span class="metric-mark success"></span>
              </div>
              <div id="card-success-rate" class="metric-value">--</div>
              <div class="metric-sub">
                <span id="card-success-count">${copy.completedBadge}: 0</span>
                <span id="card-error-count">${copy.errorBadge}: 0</span>
              </div>
            </article>

            <article class="metric-card">
              <div class="metric-label-row">
                <span class="metric-label">${copy.latency}</span>
                <span class="metric-mark neutral"></span>
              </div>
              <div id="card-latency" class="metric-value">--</div>
              <div id="card-p95" class="metric-sub">${copy.inputTokensLabel}: --</div>
            </article>
          </section>

          <section class="panel">
            <div class="panel-head">
              <span class="panel-title">${copy.timelineTitle}</span>
              <span id="timeline-meta" class="panel-meta">${copy.timelineLegend}</span>
            </div>
            <div id="timeline-bars" class="timeline-body"></div>
          </section>
        </section>

        <section id="details-state" class="page-view">
          <section class="controls">
            <div class="filter-group" id="filter-group">
              <button class="filter-button active" data-filter="all">${copy.filterAll}</button>
              <button class="filter-button" data-filter="in_flight">${copy.filterInFlight}</button>
              <button class="filter-button" data-filter="error">${copy.filterError}</button>
              <button class="filter-button" data-filter="completed">${copy.filterCompleted}</button>
            </div>
            <label class="search-wrap">
              <input id="search-input" type="text" placeholder="${copy.searchPlaceholder}" />
            </label>
          </section>

          <section class="panel">
            <div class="request-table-wrap">
              <table class="request-table">
                <colgroup>
                  <col style="width:12%" />
                  <col style="width:9%" />
                  <col style="width:16%" />
                  <col style="width:24%" />
                  <col style="width:10%" />
                  <col style="width:10%" />
                  <col style="width:9%" />
                  <col style="width:10%" />
                </colgroup>
                <thead>
                  <tr>
                    <th>${copy.tableSeq}</th>
                    <th>${copy.tableAgent}</th>
                    <th>${copy.tablePath}</th>
                    <th>${copy.tableModel}</th>
                    <th>${copy.tableStream}</th>
                    <th>${copy.tableStatus}</th>
                    <th>${copy.tableUsage}</th>
                    <th>${copy.tableDuration}</th>
                  </tr>
                </thead>
                <tbody id="request-table-body"></tbody>
              </table>
            </div>
          </section>
        </section>
      </div>
    </main>

    <footer class="footer">
      <div class="footer-left">
        <span id="footer-refresh"></span>
        <span id="footer-path"></span>
      </div>
      <div class="footer-right">
        <a href="#">${copy.privacyWarning}</a>
        <a href="#">${copy.systemLogs}</a>
      </div>
    </footer>
  </div>

  <div id="drawer-backdrop" class="drawer-backdrop" hidden></div>
  <aside id="detail-drawer" class="drawer" hidden>
    <div class="drawer-head">
      <div id="drawer-request-title" class="drawer-title">${copy.drawerTitle}</div>
      <button id="drawer-close" class="drawer-close" type="button" aria-label="Close">×</button>
    </div>
    <div class="drawer-body">
      <section class="detail-section">
        <h3 class="detail-title">${copy.metadata}</h3>
        <div class="meta-grid">
          <div><div class="meta-label">${copy.requestIdLabel}</div><div id="drawer-request-id" class="meta-value mono"></div></div>
          <div><div class="meta-label">${copy.sequenceLabel}</div><div id="drawer-seq" class="meta-value mono"></div></div>
          <div><div class="meta-label">${copy.terminalNodeLabel}</div><div id="drawer-terminal" class="meta-value mono"></div></div>
          <div><div class="meta-label">${copy.activeAgentLabel}</div><div id="drawer-agent" class="meta-value emphasis"></div></div>
          <div><div class="meta-label">${copy.totalDurationLabel}</div><div id="drawer-duration" class="meta-value mono"></div></div>
          <div><div class="meta-label">${copy.timestampLabel}</div><div id="drawer-timestamp" class="meta-value mono"></div></div>
        </div>
      </section>

      <section class="detail-section">
        <h3 class="detail-title">${copy.transportLayer}</h3>
        <div class="transport-list">
          <div class="transport-row"><span class="transport-label">${copy.methodLabel}</span><span id="drawer-method" class="transport-value mono"></span></div>
          <div class="transport-row"><span class="transport-label">${copy.endpointPathLabel}</span><span id="drawer-path" class="transport-value mono"></span></div>
          <div class="transport-row"><span class="transport-label">${copy.statusCodeLabel}</span><span id="drawer-status" class="transport-value mono"></span></div>
          <div class="transport-row"><span class="transport-label">${copy.modelLabel}</span><span id="drawer-model" class="transport-value"></span></div>
          <div class="transport-row"><span class="transport-label">${copy.usageLabel}</span><span id="drawer-usage" class="transport-value mono"></span></div>
          <div class="transport-row"><span class="transport-label">${copy.inputTokensLabel}</span><span id="drawer-input-tokens" class="transport-value mono"></span></div>
          <div class="transport-row"><span class="transport-label">${copy.outputTokensLabel}</span><span id="drawer-output-tokens" class="transport-value mono"></span></div>
          <div class="transport-row"><span class="transport-label">${copy.requestBytesLabel}</span><span id="drawer-request-bytes" class="transport-value mono"></span></div>
          <div class="transport-row"><span class="transport-label">${copy.responseBytesLabel}</span><span id="drawer-response-bytes" class="transport-value mono"></span></div>
          <div class="transport-row"><span class="transport-label">${copy.eventTypeLabel}</span><span id="drawer-event-type" class="transport-value"></span></div>
          <div class="transport-row"><span class="transport-label">${copy.noteLabel}</span><span id="drawer-note" class="transport-value mono"></span></div>
        </div>
      </section>

      <section class="detail-section detail-section-wide">
        <h3 class="detail-title">${copy.promptInsightTitle}</h3>
        <div id="drawer-prompt-structure" class="insight-stack"></div>
        <div id="drawer-raw-prompt" class="raw-panel"></div>
      </section>

      <section class="detail-section detail-section-wide">
        <h3 class="detail-title">${copy.toolInsightTitle}</h3>
        <div id="drawer-tool-activity" class="tool-stack"></div>
      </section>
    </div>
  </aside>

  <script>
    const runId = ${serializedRunId};
    const text = ${serializedCopy};
    const tracePath = ${serializedTracePath};
    const endpoint = "/__melu/events";

    const elements = {
      mainScroll: document.querySelector(".main"),
      sessionRunId: document.getElementById("session-run-id"),
      sessionCommand: document.getElementById("session-command"),
      sessionCwd: document.getElementById("session-cwd"),
      sessionStart: document.getElementById("session-start"),
      sessionStatusPill: document.getElementById("session-status-pill"),
      sessionStatusText: document.getElementById("session-status-text"),
      trafficWarning: document.getElementById("traffic-warning"),
      emptyState: document.getElementById("empty-state"),
      emptyTitle: document.getElementById("empty-title"),
      emptyBody: document.getElementById("empty-body"),
      emptyTracePath: document.getElementById("empty-trace-path"),
      overviewState: document.getElementById("overview-state"),
      detailsState: document.getElementById("details-state"),
      cardTotal: document.getElementById("card-total"),
      cardUp: document.getElementById("card-up"),
      cardDown: document.getElementById("card-down"),
      cardInFlight: document.getElementById("card-inflight"),
      cardInFlightSub: document.getElementById("card-inflight-sub"),
      cardSuccessRate: document.getElementById("card-success-rate"),
      cardSuccessCount: document.getElementById("card-success-count"),
      cardErrorCount: document.getElementById("card-error-count"),
      cardLatency: document.getElementById("card-latency"),
      cardP95: document.getElementById("card-p95"),
      timelineMeta: document.getElementById("timeline-meta"),
      timelineBars: document.getElementById("timeline-bars"),
      requestTableBody: document.getElementById("request-table-body"),
      footerRefresh: document.getElementById("footer-refresh"),
      footerPath: document.getElementById("footer-path"),
      drawerBackdrop: document.getElementById("drawer-backdrop"),
      detailDrawer: document.getElementById("detail-drawer"),
      drawerClose: document.getElementById("drawer-close"),
      drawerRequestTitle: document.getElementById("drawer-request-title"),
      drawerRequestId: document.getElementById("drawer-request-id"),
      drawerSeq: document.getElementById("drawer-seq"),
      drawerTerminal: document.getElementById("drawer-terminal"),
      drawerAgent: document.getElementById("drawer-agent"),
      drawerDuration: document.getElementById("drawer-duration"),
      drawerTimestamp: document.getElementById("drawer-timestamp"),
      drawerMethod: document.getElementById("drawer-method"),
      drawerPath: document.getElementById("drawer-path"),
      drawerStatus: document.getElementById("drawer-status"),
      drawerModel: document.getElementById("drawer-model"),
      drawerUsage: document.getElementById("drawer-usage"),
      drawerInputTokens: document.getElementById("drawer-input-tokens"),
      drawerOutputTokens: document.getElementById("drawer-output-tokens"),
      drawerRequestBytes: document.getElementById("drawer-request-bytes"),
      drawerResponseBytes: document.getElementById("drawer-response-bytes"),
      drawerEventType: document.getElementById("drawer-event-type"),
      drawerNote: document.getElementById("drawer-note"),
      drawerPromptStructure: document.getElementById("drawer-prompt-structure"),
      drawerRawPrompt: document.getElementById("drawer-raw-prompt"),
      drawerToolActivity: document.getElementById("drawer-tool-activity"),
      refreshButton: document.getElementById("refresh-button"),
      searchInput: document.getElementById("search-input"),
      filterButtons: Array.from(document.querySelectorAll(".filter-button")),
      navItems: Array.from(document.querySelectorAll(".nav-item[data-view]"))
    };

    let lastRenderSignature = "";
    let activeFilter = "all";
    let searchTerm = "";
    let selectedRequestId = null;
    let currentView = "overview";
    let isOffline = false;
    let lastSuccessfulRefreshAt = null;
    const snapshotStorageKey = "melu-trace-snapshot:" + runId;
    let latestState = {
      events: [],
      requests: [],
      stats: null,
      generatedAt: null
    };

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function formatTime(timestamp) {
      if (!timestamp) return "--";
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour12: false });
    }

    function formatDateTime(timestamp) {
      if (!timestamp) return "--";
      const date = new Date(timestamp);
      return date.toLocaleString([], {
        hour12: false,
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    }

    function formatBytes(value) {
      if (typeof value !== "number" || Number.isNaN(value)) return "--";
      if (value < 1024) return value + " B";
      if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
      return (value / (1024 * 1024)).toFixed(2) + " MB";
    }

    function formatDuration(value) {
      if (typeof value !== "number" || Number.isNaN(value)) return "--";
      const totalSeconds = Math.max(0, Math.round(value / 1000));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      if (hours > 0) {
        return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
      }
      return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
    }

    function compactRunId(value) {
      if (!value) return "--";
      const parts = String(value).split("-");
      if (parts.length >= 2) return "…" + parts[parts.length - 1];
      return String(value).slice(-10);
    }

    function compactRequestId(value) {
      if (!value) return "--";
      const parts = String(value).split("-");
      if (parts.length >= 2) return parts.slice(-2).join("-");
      return String(value).slice(-14);
    }

    function formatTokenCount(value) {
      if (typeof value !== "number" || Number.isNaN(value)) return "--";
      return value.toLocaleString("en-US");
    }

    function modelTone(model) {
      const lower = String(model || "").toLowerCase();
      if (lower.includes("haiku")) return "haiku";
      if (lower.includes("sonnet")) return "sonnet";
      if (lower.includes("opus")) return "opus";
      return "generic";
    }

    function modelDisplayLabel(model) {
      const tone = modelTone(model);
      if (tone === "haiku") return "haiku";
      if (tone === "sonnet") return "sonnet";
      if (tone === "opus") return "opus";
      return truncatePreview(model || "--", 18);
    }

    function renderModelChip(model) {
      const rawLabel = model || "--";
      const tone = modelTone(rawLabel);
      const displayLabel = modelDisplayLabel(rawLabel);
      return '<span class="model-chip ' + tone + '" title="' + escapeHtml(rawLabel) + '">' + escapeHtml(displayLabel) + '</span>';
    }

    function totalUsage(request) {
      const input = typeof request.inputTokens === "number" ? request.inputTokens : 0;
      const output = typeof request.outputTokens === "number" ? request.outputTokens : 0;
      if (!input && !output) return null;
      return input + output;
    }

    function truncatePreview(value, limit) {
      const textValue = String(value || "");
      if (textValue.length <= limit) return textValue;
      return textValue.slice(0, limit) + "…";
    }

    function safeJson(value) {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }

    function extractMarkdownHeadings(value) {
      const headings = [];
      const regex = /^# (.+)$/gm;
      let match;
      while ((match = regex.exec(String(value || "")))) {
        headings.push(match[1].trim());
      }
      return headings;
    }

    function extractXmlTags(value) {
      const tags = [];
      const regex = /<([a-zA-Z0-9:_-]+)(?:\\s[^>]*)?>|<\\/([a-zA-Z0-9:_-]+)>/g;
      const seen = new Set();
      let match;
      while ((match = regex.exec(String(value || "")))) {
        const name = (match[1] || match[2] || "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        tags.push(name);
      }
      return tags;
    }

    function countMeluMemoryEntries(value) {
      const matches = String(value || "").match(/<entry\\b/gi);
      return matches ? matches.length : 0;
    }

    function formatCountSummary(count, unit) {
      return String(count) + " " + unit;
    }

    function formatCharCount(count) {
      return formatCountSummary(count, text.countChars);
    }

    function firstContentLine(value) {
      return String(value || "")
        .split(/\\r?\\n/)
        .map(function (line) { return line.trim(); })
        .find(Boolean) || "";
    }

    function compactPath(value) {
      const raw = String(value || "--");
      if (raw.length <= 44) return raw;
      const parts = raw.split("/").filter(Boolean);
      if (parts.length >= 3) {
        return "…/" + parts.slice(-3).join("/");
      }
      return truncatePreview(raw, 44);
    }

    function inferPromptTagTitle(tags, fallbackIndex) {
      if (tags.includes("system-reminder")) {
        return { key: "system-reminder", title: text.promptItemSystemReminder };
      }
      if (tags.includes("task-notification")) {
        return { key: "task-notification", title: text.promptItemTaskNotification };
      }
      if (tags.includes("available-deferred-tools")) {
        return { key: "available-deferred-tools", title: text.promptItemDeferredTools };
      }
      if (tags.includes("local-command-caveat")) {
        return { key: "local-command-caveat", title: text.promptItemLocalCommand };
      }
      if (tags.includes("command-name") || tags.includes("command-args") || tags.includes("command-message")) {
        return { key: "command-context", title: text.promptItemCommandContext };
      }
      return {
        key: "tag-context",
        title: text.promptItemTagContext + " " + fallbackIndex
      };
    }

    function promptBlockTitle(block, visibleIndex) {
      if (!block || !block.text) {
        return text.promptItemSystemBlock + " " + visibleIndex;
      }
      const raw = String(block.text);
      if (raw.includes("<melu-memory>")) return text.promptItemMemoryInjection;
      if (raw.includes("CLAUDE.md")) return text.promptItemClaudeMd;
      if (block.index === 0) return text.promptItemMainSystem;
      return text.promptItemSystemBlock + " " + visibleIndex;
    }

    function promptBlockMeta(block) {
      const meta = [];
      if (block && block.type) meta.push(String(block.type));
      if (block && typeof block.text === "string") meta.push(formatCharCount(block.text.length));
      return meta.join(" · ");
    }

    function promptMessageMeta(message) {
      const meta = [];
      if (message && message.role) meta.push(String(message.role));
      if (Array.isArray(message && message.contentTypes) && message.contentTypes.length) {
        meta.push(message.contentTypes.join(", "));
      }
      if (message && typeof message.text === "string") {
        meta.push(formatCharCount(message.text.length));
      }
      return meta.join(" · ");
    }

    function buildPromptGroups(snapshot) {
      const groups = [];
      const systemBlocks = Array.isArray(snapshot.systemBlocks) ? snapshot.systemBlocks : [];
      const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
      const systemItems = [];
      const memoryItems = [];
      const userItems = [];
      const extraItems = [];
      const extraKinds = new Set();
      let systemIndex = 0;
      let userIndex = 0;
      let toolResultIndex = 0;
      let assistantIndex = 0;
      let tagIndex = 0;
      let memoryEntries = 0;

      systemBlocks.forEach(function (block) {
        const rawText = String(block && block.text ? block.text : "");
        const item = {
          title: promptBlockTitle(block, block && block.index === 0 ? 0 : systemIndex + 1),
          meta: promptBlockMeta(block),
          content: rawText || "--"
        };

        if (rawText.includes("<melu-memory>")) {
          memoryEntries += countMeluMemoryEntries(rawText);
          memoryItems.push(item);
          return;
        }

        systemIndex += 1;
        item.title = promptBlockTitle(block, systemIndex);
        systemItems.push(item);
      });

      messages.forEach(function (message) {
        const rawText = String(message && message.text ? message.text : "");
        if (!rawText.trim()) return;

        if (message.role === "user" && !message.toolResultOnly) {
          userIndex += 1;
          userItems.push({
            title: text.promptItemUserInput + " " + userIndex,
            meta: promptMessageMeta(message),
            content: rawText
          });
          return;
        }

        if (message.toolResultOnly) {
          toolResultIndex += 1;
          extraKinds.add("tool-result");
          extraItems.push({
            title: text.promptItemToolResult + " " + toolResultIndex,
            meta: promptMessageMeta(message),
            content: rawText
          });
          return;
        }

        const tags = extractXmlTags(rawText);
        if (tags.length) {
          tagIndex += 1;
          const tagInfo = inferPromptTagTitle(tags, tagIndex);
          extraKinds.add(tagInfo.key);
          extraItems.push({
            title: tagInfo.title,
            meta: promptMessageMeta(message),
            content: rawText
          });
          return;
        }

        assistantIndex += 1;
        extraKinds.add(message.role || "assistant");
        extraItems.push({
          title: text.promptItemAssistantContext + " " + assistantIndex,
          meta: promptMessageMeta(message),
          content: rawText
        });
      });

      if (systemItems.length) {
        groups.push({
          title: text.promptGroupSystem,
          summary: formatCountSummary(systemItems.length, text.countBlocks),
          items: systemItems
        });
      }
      if (memoryItems.length) {
        groups.push({
          title: text.promptGroupMemory,
          summary: formatCountSummary(memoryEntries || memoryItems.length, memoryEntries ? text.countEntries : text.countBlocks),
          items: memoryItems
        });
      }
      if (userItems.length) {
        groups.push({
          title: text.promptGroupUser,
          summary: formatCountSummary(userItems.length, text.countMessages),
          items: userItems
        });
      }
      if (extraItems.length) {
        groups.push({
          title: text.promptGroupTags,
          summary: formatCountSummary(extraKinds.size || extraItems.length, text.countKinds),
          items: extraItems
        });
      }

      return groups;
    }

    function toolNativeDescription(tool) {
      if (!tool || !tool.input || typeof tool.input !== "object") return "";
      const input = tool.input;
      if (typeof input.description === "string" && input.description.trim()) {
        return input.description.trim();
      }
      return "";
    }

    function toolActionTitle(tool) {
      const name = String(tool && tool.name ? tool.name : "");
      if (name === "Read" || name === "NotebookRead") return text.toolActionRead;
      if (name === "Write") return text.toolActionWrite;
      if (name === "Edit" || name === "MultiEdit" || name === "NotebookEdit") return text.toolActionEdit;
      if (name === "LS") return text.toolActionBrowse;
      if (name === "Glob") return text.toolActionSearchFiles;
      if (name === "Grep") return text.toolActionSearchContent;
      if (name === "Bash") return text.toolActionRunCommand;
      if (name === "WebSearch") return text.toolActionWebSearch;
      if (name === "WebFetch") return text.toolActionWebFetch;
      if (name === "Agent") return text.toolActionAgent;
      if (name === "TodoWrite") return text.toolActionTodo;
      if (name === "AskUserQuestion") return text.toolActionAskUser;
      if (name === "Skill") return text.toolActionSkill;
      if (name === "ExitPlanMode") return text.toolActionPlanExit;
      if (/^mcp__/i.test(name)) return text.toolActionMcp;
      return text.toolActionGeneric;
    }

    function toolActionSummary(tool) {
      const name = String(tool && tool.name ? tool.name : "");
      const input = tool && tool.input && typeof tool.input === "object" ? tool.input : {};
      const nativeDescription = toolNativeDescription(tool);

      if (name === "Read") return compactPath(input.file_path || input.path || "--");
      if (name === "NotebookRead") return compactPath(input.notebook_path || "--");
      if (name === "Write") return compactPath(input.file_path || "--");
      if (name === "Edit") return compactPath(input.file_path || "--");
      if (name === "MultiEdit") return compactPath(input.file_path || "--");
      if (name === "NotebookEdit") return compactPath(input.notebook_path || "--");
      if (name === "LS") return compactPath(input.path || ".");
      if (name === "Glob") return input.pattern || "--";
      if (name === "Grep") return input.pattern || "--";
      if (name === "Bash") return truncatePreview(nativeDescription || input.command || "--", 90);
      if (name === "WebSearch") return truncatePreview(input.query || "--", 90);
      if (name === "WebFetch") {
        try {
          return new URL(String(input.url || "")).hostname || String(input.url || "--");
        } catch {
          return truncatePreview(String(input.url || "--"), 90);
        }
      }
      if (name === "Agent") {
        const agentType = input.subagent_type ? String(input.subagent_type) : "--";
        const task = nativeDescription || input.description || input.prompt || "";
        return task ? agentType + " · " + truncatePreview(String(task), 64) : agentType;
      }
      if (name === "TodoWrite") {
        const todoCount = Array.isArray(input.todos) ? input.todos.length : 0;
        return formatCountSummary(todoCount, text.countEntries);
      }
      if (name === "AskUserQuestion") {
        const question = Array.isArray(input.questions) && input.questions[0] && input.questions[0].question
          ? input.questions[0].question
          : "--";
        return truncatePreview(question, 90);
      }
      if (name === "Skill") return "/" + String(input.skill || "--");
      if (name === "ExitPlanMode") return "--";
      if (/^mcp__/i.test(name)) return name.split("__").slice(1).join(" / ") || name;
      return truncatePreview(name || "--", 90);
    }

    function toolKeyFields(tool) {
      const name = String(tool && tool.name ? tool.name : "");
      const input = tool && tool.input && typeof tool.input === "object" ? tool.input : {};
      const fields = [];

      if (name === "Read") {
        fields.push([text.toolLabelPath, input.file_path || input.path || "--"]);
        if (typeof input.offset === "number" || typeof input.limit === "number") {
          const rangeStart = typeof input.offset === "number" ? input.offset : 0;
          const rangeEnd = typeof input.limit === "number" ? rangeStart + input.limit : null;
          fields.push([text.toolLabelScope, rangeEnd === null ? String(rangeStart) : String(rangeStart) + "-" + String(rangeEnd)]);
        }
      } else if (name === "NotebookRead" || name === "NotebookEdit") {
        fields.push([text.toolLabelPath, input.notebook_path || "--"]);
      } else if (name === "Write" || name === "Edit" || name === "MultiEdit") {
        fields.push([text.toolLabelPath, input.file_path || "--"]);
      } else if (name === "LS") {
        fields.push([text.toolLabelPath, input.path || "."]);
      } else if (name === "Glob") {
        fields.push([text.toolLabelPattern, input.pattern || "--"]);
        if (input.path) fields.push([text.toolLabelScope, input.path]);
      } else if (name === "Grep") {
        fields.push([text.toolLabelPattern, input.pattern || "--"]);
        if (input.glob || input.path) fields.push([text.toolLabelScope, input.glob || input.path]);
      } else if (name === "Bash") {
        if (input.command) fields.push([text.toolLabelCommand, input.command]);
        if (typeof input.timeout === "number") fields.push([text.toolLabelTimeout, String(input.timeout) + " ms"]);
      } else if (name === "WebSearch") {
        fields.push([text.toolLabelPattern, input.query || "--"]);
      } else if (name === "WebFetch") {
        fields.push([text.toolLabelUrl, input.url || "--"]);
      } else if (name === "Agent") {
        if (input.subagent_type) fields.push([text.toolLabelType, input.subagent_type]);
        if (input.description || input.prompt) fields.push([text.toolLabelTask, input.description || input.prompt]);
      } else if (name === "TodoWrite") {
        fields.push([text.toolLabelCount, Array.isArray(input.todos) ? String(input.todos.length) : "0"]);
      } else if (name === "AskUserQuestion") {
        const question = Array.isArray(input.questions) && input.questions[0] && input.questions[0].question
          ? input.questions[0].question
          : "--";
        fields.push([text.toolLabelTask, question]);
      } else if (name === "Skill") {
        fields.push([text.toolLabelType, input.skill || "--"]);
        if (input.args) fields.push([text.toolLabelTask, input.args]);
      } else if (/^mcp__/i.test(name)) {
        fields.push([text.toolLabelType, name]);
      }

      return fields.filter(function (entry) {
        return entry[1] !== undefined && entry[1] !== null && String(entry[1]).trim() !== "";
      });
    }

    function readCachedSnapshot() {
      try {
        const raw = window.localStorage.getItem(snapshotStorageKey);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }

    function writeCachedSnapshot(payload) {
      try {
        window.localStorage.setItem(snapshotStorageKey, JSON.stringify(payload));
      } catch {
        // ignore storage failures
      }
    }

    function percentile(values, percentileValue) {
      if (!values.length) return null;
      const sorted = values.slice().sort(function (a, b) { return a - b; });
      const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1));
      return sorted[index];
    }

    function mean(values) {
      if (!values.length) return null;
      return values.reduce(function (sum, value) { return sum + value; }, 0) / values.length;
    }

    function formatEventType(eventType) {
      if (eventType === "upload") return { label: text.uploadLabel, main: text.uploadMain };
      if (eventType === "receive_start") return { label: text.receiveLabel, main: text.receiveMain };
      if (eventType === "receive_end") return { label: text.completeLabel, main: text.completeMain };
      return { label: text.errorLabel, main: text.errorMain };
    }

    function summarizeRequests(events) {
      const byRequest = new Map();

      events.forEach(function (event) {
        let entry = byRequest.get(event.requestId);
        if (!entry) {
          entry = {
            requestId: event.requestId,
            seq: event.seq,
            startedAt: event.timestamp,
            lastAt: event.timestamp,
            method: event.method || "POST",
            path: event.path || "/v1/messages",
            stream: Boolean(event.stream),
            model: event.model || null,
            requestBytes: typeof event.requestBytes === "number" ? event.requestBytes : 0,
            status: typeof event.status === "number" ? event.status : null,
            responseBytes: typeof event.responseBytes === "number" ? event.responseBytes : null,
            durationMs: typeof event.durationMs === "number" ? event.durationMs : null,
            inputTokens: typeof event.inputTokens === "number" ? event.inputTokens : null,
            outputTokens: typeof event.outputTokens === "number" ? event.outputTokens : null,
            note: event.note || null,
            promptSnapshot: event.promptSnapshot || null,
            toolCalls: Array.isArray(event.toolCalls) ? event.toolCalls : [],
            lastEventType: event.type,
            state: "in_flight"
          };
          byRequest.set(event.requestId, entry);
        }

        entry.lastAt = event.timestamp;
        entry.method = event.method || entry.method;
        entry.path = event.path || entry.path;
        entry.stream = Boolean(event.stream);
        entry.model = event.model || entry.model;
        if (typeof event.requestBytes === "number") entry.requestBytes = event.requestBytes;
        if (typeof event.status === "number") entry.status = event.status;
        if (typeof event.responseBytes === "number") entry.responseBytes = event.responseBytes;
        if (typeof event.durationMs === "number") entry.durationMs = event.durationMs;
        if (typeof event.inputTokens === "number") entry.inputTokens = event.inputTokens;
        if (typeof event.outputTokens === "number") entry.outputTokens = event.outputTokens;
        if (event.note) entry.note = event.note;
        if (event.promptSnapshot) entry.promptSnapshot = event.promptSnapshot;
        if (Array.isArray(event.toolCalls) && event.toolCalls.length) entry.toolCalls = event.toolCalls;
        entry.lastEventType = event.type;

        if (event.type === "upload") {
          entry.startedAt = event.timestamp;
          entry.state = "in_flight";
        } else if (event.type === "receive_end") {
          entry.state = typeof event.status === "number" && event.status >= 400 ? "error" : "completed";
        } else if (event.type === "receive_error") {
          entry.state = "error";
        } else if (entry.state !== "completed" && entry.state !== "error") {
          entry.state = "in_flight";
        }
      });

      return Array.from(byRequest.values()).sort(function (a, b) { return b.seq - a.seq; });
    }

    function buildStats(requests, events) {
      const completed = requests.filter(function (request) { return request.state === "completed"; });
      const failed = requests.filter(function (request) { return request.state === "error"; });
      const inFlight = requests.filter(function (request) { return request.state === "in_flight"; });
      const uploadEvents = events.filter(function (event) { return event.type === "upload"; }).length;
      const receiveStartEvents = events.filter(function (event) { return event.type === "receive_start"; }).length;
      const totalInputTokens = requests.reduce(function (sum, request) {
        return sum + (typeof request.inputTokens === "number" ? request.inputTokens : 0);
      }, 0);
      const totalOutputTokens = requests.reduce(function (sum, request) {
        return sum + (typeof request.outputTokens === "number" ? request.outputTokens : 0);
      }, 0);
      const latencySource = completed.length ? completed : requests.filter(function (request) {
        return request.state === "completed" || request.state === "error";
      });
      const finishedDurations = latencySource
        .map(function (request) { return request.durationMs; })
        .filter(function (value) { return typeof value === "number"; });
      const closedCount = completed.length + failed.length;

      return {
        totalRequests: requests.length,
        completed: completed.length,
        failed: failed.length,
        inFlight: inFlight.length,
        uploadEvents: uploadEvents,
        receiveStartEvents: receiveStartEvents,
        totalInputTokens: totalInputTokens,
        totalOutputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        successRate: closedCount ? Math.round((completed.length / closedCount) * 100) : null,
        averageLatencyMs: mean(finishedDurations),
        p95LatencyMs: percentile(finishedDurations, 95),
        firstSeenAt: events.length ? events[0].timestamp : null,
        highTraffic: inFlight.length >= 5 || requests.length >= 80
      };
    }

    function getStatusPresentation(stats) {
      if (!stats.totalRequests) {
        return { label: text.readyStatus, tone: "ready" };
      }
      if (stats.highTraffic) {
        return { label: text.liveStatus, tone: "warning" };
      }
      if (stats.inFlight > 0) {
        return { label: text.liveStatus, tone: "live" };
      }
      return { label: text.steadyStatus, tone: "steady" };
    }

    function applyFilters(requests) {
      const normalizedSearch = searchTerm.trim().toLowerCase();
      return requests.filter(function (request) {
        if (activeFilter !== "all" && request.state !== activeFilter) return false;
        if (!normalizedSearch) return true;
        return request.requestId.toLowerCase().includes(normalizedSearch)
          || request.path.toLowerCase().includes(normalizedSearch)
          || String(request.seq).includes(normalizedSearch)
          || String(request.model || "").toLowerCase().includes(normalizedSearch);
      });
    }

    function renderHeader(stats) {
      const status = getStatusPresentation(stats);
      elements.sessionRunId.textContent = compactRunId(runId);
      elements.sessionRunId.title = runId;
      elements.sessionCommand.textContent = "melu run -- claude";
      elements.sessionCwd.textContent = window.location.pathname || "/__melu";
      elements.sessionStart.textContent = formatTime(stats.firstSeenAt);
      elements.sessionStatusText.textContent = isOffline ? text.disconnectedStatus : status.label;
      elements.sessionStatusPill.dataset.tone = isOffline ? "ready" : status.tone;

      if (stats.highTraffic) {
        elements.trafficWarning.classList.add("is-visible");
      } else {
        elements.trafficWarning.classList.remove("is-visible");
      }

      elements.emptyTracePath.textContent = text.traceFileLabel + ": " + tracePath;
      elements.footerPath.textContent = text.footerPath + ": " + tracePath;
    }

    function renderCards(stats) {
      elements.cardTotal.textContent = String(stats.totalRequests);
      elements.cardUp.textContent = text.uploadLabel + " " + stats.uploadEvents;
      elements.cardDown.textContent = text.receiveLabel + " " + stats.receiveStartEvents;
      elements.cardInFlight.textContent = String(stats.inFlight);
      elements.cardInFlightSub.textContent = stats.inFlight > 0 ? text.liveStatus : text.completedBadge;
      elements.cardSuccessRate.textContent = stats.successRate === null ? "--" : stats.successRate + "%";
      elements.cardSuccessCount.textContent = text.completedBadge + ": " + stats.completed;
      elements.cardErrorCount.textContent = text.errorBadge + ": " + stats.failed;
      elements.cardLatency.textContent = stats.totalTokens ? formatTokenCount(stats.totalTokens) : "--";
      elements.cardP95.textContent = text.inputTokensLabel + ": " + formatTokenCount(stats.totalInputTokens) + " · " + text.outputTokensLabel + ": " + formatTokenCount(stats.totalOutputTokens);
    }

    function renderTimeline(requests) {
      const recent = requests.slice().reverse().slice(-48);
      elements.timelineMeta.textContent = text.timelineRange + " · " + recent.length + " · " + text.timelineLegend;

      if (!recent.length) {
        elements.timelineBars.innerHTML = '<div style="color:var(--muted);font-size:12px;">' + escapeHtml(text.noRequestsFound) + '</div>';
        return;
      }

      const maxDuration = recent.reduce(function (maxValue, request) {
        const duration = typeof request.durationMs === "number" ? request.durationMs : 400;
        return Math.max(maxValue, duration);
      }, 400);

      elements.timelineBars.innerHTML = recent.map(function (request) {
        const duration = typeof request.durationMs === "number" ? request.durationMs : 320;
        const height = Math.max(22, Math.round((duration / maxDuration) * 130));
        const tone = modelTone(request.model);
        const stateClass = request.state === "error" ? " is-error" : request.state === "in_flight" ? " is-in-flight" : "";
        return '<button class="timeline-bar ' + tone + stateClass + '" style="height:' + height + 'px" data-request-id="' + escapeHtml(request.requestId) + '" title="' + escapeHtml(request.requestId + " · " + formatDuration(request.durationMs)) + '"></button>';
      }).join("");
    }

    function statusBadge(request) {
      if (request.state === "completed") {
        return '<span class="badge success">' + escapeHtml(text.successBadge) + '</span>';
      }
      if (request.state === "error") {
        return '<span class="badge error">' + escapeHtml(text.errorBadge) + '</span>';
      }
      return '<span class="badge in-flight">' + escapeHtml(text.inFlightBadge) + '</span>';
    }

    function renderTable(requests) {
      if (!requests.length) {
        elements.requestTableBody.innerHTML = '<tr><td colspan="8" style="padding:28px 20px;color:var(--muted);text-align:center;">' + escapeHtml(text.noRequestsFound) + '</td></tr>';
        return;
      }

      elements.requestTableBody.innerHTML = requests.map(function (request) {
        const selected = request.requestId === selectedRequestId ? " is-selected" : "";
        return '<tr class="request-row' + selected + '" data-request-id="' + escapeHtml(request.requestId) + '">'
          + '<td><div class="seq-stack"><div class="mono">' + escapeHtml(String(request.seq)) + '</div><div class="request-id-hint mono" title="' + escapeHtml(request.requestId) + '">' + escapeHtml(compactRequestId(request.requestId)) + '</div></div></td>'
          + '<td>' + escapeHtml(text.mainAgent) + '</td>'
          + '<td class="mono table-subtle">' + escapeHtml(request.path) + '</td>'
          + '<td>' + renderModelChip(request.model || "--") + '</td>'
          + '<td class="table-subtle">' + escapeHtml(request.stream ? text.streamMode : text.bufferedMode) + '</td>'
          + '<td>' + statusBadge(request) + '</td>'
          + '<td class="mono">' + escapeHtml(formatTokenCount(totalUsage(request))) + '</td>'
          + '<td class="mono">' + escapeHtml(formatDuration(request.durationMs)) + '</td>'
          + '</tr>';
      }).join("");
    }

    function renderNestedPromptItem(item, index) {
      return '<details class="nested-item">'
        + '<summary><div class="accordion-summary"><div class="accordion-title-wrap"><div class="accordion-title">'
        + escapeHtml(item.title || ("Block " + (index + 1)))
        + '</div></div></div></summary>'
        + '<div class="nested-body">'
        + (item.meta ? '<div class="block-meta">' + escapeHtml(item.meta) + '</div>' : '')
        + '<div class="block-content">' + escapeHtml(item.content || "--") + '</div>'
        + '</div>'
        + '</details>';
    }

    function renderPromptStructure(request) {
      const snapshot = request.promptSnapshot;
      if (!snapshot) {
        elements.drawerPromptStructure.innerHTML = '<div class="insight-empty">' + escapeHtml(text.noPromptSnapshot) + '</div>';
        elements.drawerRawPrompt.innerHTML = "";
        return;
      }

      const groups = buildPromptGroups(snapshot);
      if (!groups.length) {
        elements.drawerPromptStructure.innerHTML = '<div class="insight-empty">' + escapeHtml(text.noPromptSnapshot) + '</div>';
      } else {
        elements.drawerPromptStructure.innerHTML = groups.map(function (group) {
          return '<details class="accordion-group">'
            + '<summary><div class="accordion-summary">'
            + '<div class="accordion-title-wrap">'
            + '<div class="accordion-title">' + escapeHtml(group.title) + '</div>'
            + '</div>'
            + '<span class="accordion-badge">' + escapeHtml(group.summary) + '</span>'
            + '</div></summary>'
            + '<div class="accordion-body"><div class="nested-list">'
            + group.items.map(function (item, index) { return renderNestedPromptItem(item, index); }).join("")
            + '</div></div>'
            + '</details>';
        }).join("");
      }

      elements.drawerRawPrompt.innerHTML =
        '<details class="accordion-group">'
        + '<summary><div class="accordion-summary">'
        + '<div class="accordion-title-wrap">'
        + '<div class="accordion-title">' + escapeHtml(text.rawPromptTitle) + '</div>'
        + '<div class="accordion-note">' + escapeHtml(text.rawRequestPayloadLabel) + '</div>'
        + '</div>'
        + '</div></summary>'
        + '<div class="raw-panel-body">'
        + (snapshot.rawRequestTruncated ? '<div class="raw-note">' + escapeHtml(text.rawPromptTruncatedNotice) + '</div>' : '')
        + '<pre class="raw-pre">' + escapeHtml(snapshot.rawRequestBody || "--") + '</pre>'
        + '</div>'
        + '</details>';
    }

    function renderToolActivity(request) {
      const toolCalls = Array.isArray(request.toolCalls) ? request.toolCalls : [];
      if (!toolCalls.length) {
        elements.drawerToolActivity.innerHTML = '<div class="tool-empty">' + escapeHtml(text.noToolActivity) + '</div>';
        return;
      }

      elements.drawerToolActivity.innerHTML = toolCalls.map(function (tool, index) {
        const nativeDescription = toolNativeDescription(tool);
        const keyFields = toolKeyFields(tool);
        const inputPayload = safeJson(tool.input);
        const detailsHtml = keyFields.map(function (entry) {
          return '<div class="detail-row">'
            + '<div class="detail-row-label">' + escapeHtml(entry[0]) + '</div>'
            + '<div class="detail-row-value">' + escapeHtml(String(entry[1])) + '</div>'
            + '</div>';
        }).join("");

        return '<details class="tool-item">'
          + '<summary><div class="accordion-summary">'
          + '<div class="accordion-title-wrap">'
          + '<div class="accordion-title">' + escapeHtml(toolActionTitle(tool)) + '</div>'
          + '<div class="accordion-note">' + escapeHtml(toolActionSummary(tool)) + '</div>'
          + '</div>'
          + '<span class="accordion-badge">' + escapeHtml(tool.name || "Tool") + '</span>'
          + '</div></summary>'
          + '<div class="tool-body">'
          + (nativeDescription
            ? '<div class="detail-row"><div class="detail-row-label">' + escapeHtml(text.toolLabelDescription) + '</div><div class="detail-row-value">' + escapeHtml(nativeDescription) + '</div></div>'
            : '')
          + (detailsHtml ? '<div class="detail-list">' + detailsHtml + '</div>' : '')
          + '<div class="detail-row"><div class="detail-row-label">' + escapeHtml(text.toolLabelOriginalName) + '</div><div class="detail-row-value">' + escapeHtml(tool.name || "--") + '</div></div>'
          + '<div class="raw-panel"><details>'
          + '<summary>' + escapeHtml(text.rawToolInputAction + " #" + (index + 1)) + '</summary>'
          + '<div class="raw-panel-body">'
          + '<div class="raw-note">' + escapeHtml(text.rawToolInputLabel) + '</div>'
          + '<pre class="raw-pre">' + escapeHtml(inputPayload || "--") + '</pre>'
          + '</div>'
          + '</details></div>'
          + '</div>'
          + '</details>';
      }).join("");
    }

    function openDrawer() {
      const request = latestState.requests.find(function (item) { return item.requestId === selectedRequestId; });
      if (!request) {
        closeDrawer(false);
        return;
      }

      const typeInfo = formatEventType(request.lastEventType);
      elements.drawerRequestTitle.textContent = text.drawerTitle;
      elements.drawerRequestId.textContent = request.requestId;
      elements.drawerSeq.textContent = String(request.seq);
      elements.drawerTerminal.textContent = runId;
      elements.drawerAgent.textContent = text.mainAgent;
      elements.drawerDuration.textContent = formatDuration(request.durationMs);
      elements.drawerTimestamp.textContent = formatDateTime(request.startedAt);
      elements.drawerMethod.textContent = request.method;
      elements.drawerPath.textContent = request.path;
      elements.drawerStatus.textContent = request.status === null ? "--" : String(request.status);
      elements.drawerModel.innerHTML = renderModelChip(request.model || "--");
      elements.drawerUsage.textContent = formatTokenCount(totalUsage(request));
      elements.drawerInputTokens.textContent = formatTokenCount(request.inputTokens);
      elements.drawerOutputTokens.textContent = formatTokenCount(request.outputTokens);
      elements.drawerRequestBytes.textContent = formatBytes(request.requestBytes);
      elements.drawerResponseBytes.textContent = formatBytes(request.responseBytes);
      elements.drawerEventType.textContent = typeInfo.main;
      elements.drawerNote.textContent = request.note || "--";
      renderPromptStructure(request);
      renderToolActivity(request);

      elements.drawerBackdrop.hidden = false;
      elements.detailDrawer.hidden = false;
      requestAnimationFrame(function () {
        elements.drawerBackdrop.classList.add("is-open");
        elements.detailDrawer.classList.add("is-open");
      });
    }

    function closeDrawer(clearSelection) {
      if (clearSelection !== false) {
        selectedRequestId = null;
      }
      elements.drawerBackdrop.classList.remove("is-open");
      elements.detailDrawer.classList.remove("is-open");
      setTimeout(function () {
        if (!elements.detailDrawer.classList.contains("is-open")) {
          elements.drawerBackdrop.hidden = true;
          elements.detailDrawer.hidden = true;
        }
      }, 220);
      if (latestState.requests.length) {
        renderTable(applyFilters(latestState.requests));
      }
    }

    function setActiveNav(viewId) {
      elements.navItems.forEach(function (item) {
        item.classList.toggle("active", item.dataset.view === viewId);
      });
    }

    function switchView(viewId) {
      currentView = viewId === "details" ? "details" : "overview";
      setActiveNav(currentView);
      if (!latestState.requests.length) return;
      elements.overviewState.classList.toggle("is-visible", currentView === "overview");
      elements.detailsState.classList.toggle("is-visible", currentView === "details");
    }

    function bindNav() {
      elements.navItems.forEach(function (item) {
        item.addEventListener("click", function (event) {
          event.preventDefault();
          switchView(item.dataset.view || "overview");
        });
      });
      switchView(currentView);
    }

    function renderMainView() {
      renderHeader(latestState.stats);
      elements.emptyTitle.textContent = text.emptyTitle;
      elements.emptyBody.textContent = text.emptyBody;

      if (!latestState.requests.length) {
        elements.emptyState.classList.add("is-visible");
        elements.overviewState.classList.remove("is-visible");
        elements.detailsState.classList.remove("is-visible");
        closeDrawer();
        return;
      }

      elements.emptyState.classList.remove("is-visible");
      renderCards(latestState.stats);
      renderTimeline(latestState.requests);
      renderTable(applyFilters(latestState.requests));
      switchView(currentView);

      if (selectedRequestId) {
        openDrawer();
      }
    }

    function updateRefreshMeta(generatedAt) {
      latestState.generatedAt = generatedAt;
      elements.footerRefresh.textContent = text.refreshTime + ": " + formatDateTime(generatedAt);
    }

    async function refresh() {
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }

        const payload = await response.json();
        const signature = JSON.stringify(payload.events);
        isOffline = false;
        lastSuccessfulRefreshAt = payload.generatedAt;
        writeCachedSnapshot(payload);
        updateRefreshMeta(payload.generatedAt);

        if (signature !== lastRenderSignature) {
          lastRenderSignature = signature;
          const requests = summarizeRequests(payload.events);
          latestState = {
            events: payload.events,
            requests: requests,
            stats: buildStats(requests, payload.events),
            generatedAt: payload.generatedAt
          };
          renderMainView();
        } else {
          renderHeader(latestState.stats);
        }
      } catch (error) {
        isOffline = true;
        if (latestState.requests.length) {
          renderHeader(latestState.stats);
          elements.footerRefresh.textContent = text.refreshTime + ": " + formatDateTime(lastSuccessfulRefreshAt) + " · " + text.offlineSnapshot;
          return;
        }

        const cached = readCachedSnapshot();
        if (cached && Array.isArray(cached.events)) {
          lastRenderSignature = JSON.stringify(cached.events);
          const requests = summarizeRequests(cached.events);
          latestState = {
            events: cached.events,
            requests: requests,
            stats: buildStats(requests, cached.events),
            generatedAt: cached.generatedAt || null
          };
          lastSuccessfulRefreshAt = cached.generatedAt || null;
          renderMainView();
          elements.footerRefresh.textContent = text.refreshTime + ": " + formatDateTime(lastSuccessfulRefreshAt) + " · " + text.offlineSnapshot;
          return;
        }

        elements.emptyState.classList.add("is-visible");
        elements.overviewState.classList.remove("is-visible");
        elements.detailsState.classList.remove("is-visible");
        elements.emptyTitle.textContent = text.dashboardReadFailed;
        elements.emptyBody.textContent = text.unableToRead + " " + String(error);
      }
    }

    elements.refreshButton.addEventListener("click", function () {
      void refresh();
    });

    elements.searchInput.addEventListener("input", function (event) {
      searchTerm = event.target.value || "";
      renderTable(applyFilters(latestState.requests));
    });

    elements.filterButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        activeFilter = button.dataset.filter || "all";
        elements.filterButtons.forEach(function (item) {
          item.classList.toggle("active", (item.dataset.filter || "") === activeFilter);
        });
        renderTable(applyFilters(latestState.requests));
      });
    });

    elements.requestTableBody.addEventListener("click", function (event) {
      const row = event.target.closest("tr[data-request-id]");
      if (!row) return;
      selectedRequestId = row.getAttribute("data-request-id");
      renderTable(applyFilters(latestState.requests));
      openDrawer();
    });

    elements.timelineBars.addEventListener("click", function (event) {
      const bar = event.target.closest("button[data-request-id]");
      if (!bar) return;
      selectedRequestId = bar.getAttribute("data-request-id");
      renderTable(applyFilters(latestState.requests));
      openDrawer();
    });

    elements.drawerClose.addEventListener("click", function () {
      closeDrawer();
    });

    elements.drawerBackdrop.addEventListener("click", function () {
      closeDrawer();
    });

    bindNav();
    updateRefreshMeta(new Date().toISOString());
    const emptyStats = {
      totalRequests: 0,
      completed: 0,
      failed: 0,
      inFlight: 0,
      uploadEvents: 0,
      receiveStartEvents: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      successRate: null,
      averageLatencyMs: null,
      p95LatencyMs: null,
      firstSeenAt: null,
      highTraffic: false
    };
    renderHeader(emptyStats);
    elements.emptyState.classList.add("is-visible");
    elements.emptyTracePath.textContent = text.traceFileLabel + ": " + tracePath;
    const cached = readCachedSnapshot();
    if (cached && Array.isArray(cached.events) && cached.events.length) {
      lastRenderSignature = JSON.stringify(cached.events);
      const requests = summarizeRequests(cached.events);
      latestState = {
        events: cached.events,
        requests: requests,
        stats: buildStats(requests, cached.events),
        generatedAt: cached.generatedAt || null
      };
      lastSuccessfulRefreshAt = cached.generatedAt || null;
      isOffline = true;
      renderMainView();
      elements.footerRefresh.textContent = text.refreshTime + ": " + formatDateTime(lastSuccessfulRefreshAt) + " · " + text.offlineSnapshot;
    }
    void refresh();
    setInterval(refresh, 1500);
  </script>
</body>
</html>`;
}
