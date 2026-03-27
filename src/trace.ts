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
  cleanedText?: string;
  hasSystemTags?: boolean;
}

export interface ProxyTracePromptSnapshot {
  systemBlocks: ProxyTracePromptSystemBlock[];
  messages: ProxyTracePromptMessage[];
  rawRequestBody: string;
  rawRequestTruncated?: boolean;
}

export interface ProxyTraceResponseBlock {
  index: number;
  type: string;
  text: string;
  id?: string | null;
  name?: string;
}

export interface ProxyTraceResponseSnapshot {
  role: string;
  blocks: ProxyTraceResponseBlock[];
  stopReason?: string | null;
  truncated?: boolean;
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
  requestKind?: string;
  turnId?: string;
  turnSeq?: number;
  turnPreview?: string;
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
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  note?: string;
  promptSnapshot?: ProxyTracePromptSnapshot;
  responseSnapshot?: ProxyTraceResponseSnapshot;
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
  tablePrompt: string;
  tableRequests: string;
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
  settingsTitle: string;
  settingsLanguageLabel: string;
  settingsMirrorLabel: string;
  settingsMemoryLabel: string;
  settingsMemoryTooltip: string;
  settingsMemoryReady: string;
  settingsMemoryMissing: string;
  settingsAutoOpenLabel: string;
  settingsAutoOpenTooltip: string;
  settingsNextRunBadge: string;
  settingsSaveAction: string;
  settingsSaving: string;
  settingsSaved: string;
  openTraceAction: string;
  disconnectedStatus: string;
  offlineSnapshot: string;
  timelineLegend: string;
  timelineRequestUnit: string;
  turnLabel: string;
  turnRailTitle: string;
  turnRailRequest: string;
  turnFallbackPreview: string;
  promptInsightTitle: string;
  answerInsightTitle: string;
  promptStructureTitle: string;
  promptBlocksTitle: string;
  messageFlowTitle: string;
  rawPromptTitle: string;
  rawPromptAction: string;
  rawToolInputAction: string;
  noPromptSnapshot: string;
  noAnswerSnapshot: string;
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
  answerGroupReply: string;
  answerGroupThinking: string;
  answerGroupTools: string;
  promptItemMainSystem: string;
  promptItemSystemBlock: string;
  promptItemMemoryInjection: string;
  promptItemUserInput: string;
  promptItemToolResult: string;
  promptItemAssistantContext: string;
  promptItemTagContext: string;
  answerItemReply: string;
  answerItemThinking: string;
  answerItemTool: string;
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
  toolActionReadConfig: string;
  toolActionReadDocs: string;
  toolActionReadNotebook: string;
  toolActionWrite: string;
  toolActionWriteConfig: string;
  toolActionWriteDocs: string;
  toolActionEdit: string;
  toolActionEditConfig: string;
  toolActionEditDocs: string;
  toolActionEditNotebook: string;
  toolActionBatchEdit: string;
  toolActionBrowse: string;
  toolActionSearchFiles: string;
  toolActionSearchSource: string;
  toolActionSearchDocs: string;
  toolActionSearchContent: string;
  toolActionRunCommand: string;
  toolActionScanFiles: string;
  toolActionCountFiles: string;
  toolActionRunTests: string;
  toolActionBuildProject: string;
  toolActionStartService: string;
  toolActionInstallDeps: string;
  toolActionCheckStatus: string;
  toolActionGit: string;
  toolActionWebSearch: string;
  toolActionWebFetch: string;
  toolActionAgent: string;
  toolActionTodo: string;
  toolActionAskUser: string;
  toolActionSkill: string;
  toolActionPlanExit: string;
  toolActionMcp: string;
  toolActionGeneric: string;
  debugTitle: string;
  debugNote: string;
  inputShortLabel: string;
  outputShortLabel: string;
  requestShortLabel: string;
  responseShortLabel: string;
  copyAction: string;
  copiedAction: string;
  closeAction: string;
  cacheCreationLabel: string;
  cacheReadLabel: string;
  cacheHitLabel: string;
  newTokensLabel: string;
  cachedTokensLabel: string;
  sentTokensLabel: string;
  railUserInput: string;
  railFinalResponse: string;
  railTaskStart: string;
  railAnalyzeResults: string;
  railComposeAnswer: string;
  railConnectivityCheck: string;
  deltaSame: string;
  deltaNew: string;
  deltaChanged: string;
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
    searchPlaceholder: "Search prompt or turn...",
    tableSeq: "Seq",
    tablePrompt: "User Prompt",
    tableRequests: "Requests",
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
    settingsTitle: "Settings",
    settingsLanguageLabel: "Language",
    settingsMirrorLabel: "Download Source",
    settingsMemoryLabel: "Load Memories",
    settingsMemoryTooltip: "Applies on the next melu run. When enabled, Melu starts the embedding runtime and re-enables memory retrieval and extraction. If the model is missing, saving will prepare it with the selected source.",
    settingsMemoryReady: "Model ready",
    settingsMemoryMissing: "Model missing",
    settingsAutoOpenLabel: "Auto-open Dashboard",
    settingsAutoOpenTooltip: "Applies on the next melu run. When startup succeeds, Melu will open the local dashboard in your browser automatically.",
    settingsNextRunBadge: "Next run",
    settingsSaveAction: "Save",
    settingsSaving: "Saving...",
    settingsSaved: "Saved. Reloading...",
    openTraceAction: "Open trace file",
    disconnectedStatus: "Disconnected",
    offlineSnapshot: "Offline snapshot",
    timelineLegend: "Color = model",
    timelineRequestUnit: "requests",
    turnLabel: "Turn",
    turnRailTitle: "Requests",
    turnRailRequest: "Request",
    turnFallbackPreview: "Ungrouped request",
    promptInsightTitle: "↑ · Prompt",
    answerInsightTitle: "↓ · Answer",
    promptStructureTitle: "Structured Summary",
    promptBlocksTitle: "System Blocks",
    messageFlowTitle: "Message Flow",
    rawPromptTitle: "Raw Payload",
    rawPromptAction: "Open raw payload",
    rawToolInputAction: "Open raw tool input",
    noPromptSnapshot: "No prompt snapshot was captured for this request.",
    noAnswerSnapshot: "No model answer was captured for this request.",
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
    promptGroupSystem: "System Prompt",
    promptGroupMemory: "Memory",
    promptGroupUser: "User Input",
    promptGroupTags: "Runtime Context",
    answerGroupReply: "Text Reply",
    answerGroupThinking: "Thinking",
    answerGroupTools: "Tool Instructions",
    promptItemMainSystem: "Base System",
    promptItemSystemBlock: "System Segment",
    promptItemMemoryInjection: "Memory Injection",
    promptItemUserInput: "User Input",
    promptItemToolResult: "Tool Result",
    promptItemAssistantContext: "Assistant Message",
    promptItemTagContext: "Runtime Context",
    answerItemReply: "Reply",
    answerItemThinking: "Thinking",
    answerItemTool: "Tool Call",
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
    toolActionReadConfig: "Read Config",
    toolActionReadDocs: "Read Docs",
    toolActionReadNotebook: "Read Notebook",
    toolActionWrite: "Write File",
    toolActionWriteConfig: "Write Config",
    toolActionWriteDocs: "Write Docs",
    toolActionEdit: "Edit File",
    toolActionEditConfig: "Edit Config",
    toolActionEditDocs: "Edit Docs",
    toolActionEditNotebook: "Edit Notebook",
    toolActionBatchEdit: "Batch Edit",
    toolActionBrowse: "Browse Files",
    toolActionSearchFiles: "Find Files",
    toolActionSearchSource: "Find Source",
    toolActionSearchDocs: "Find Docs",
    toolActionSearchContent: "Search Content",
    toolActionRunCommand: "Run Command",
    toolActionScanFiles: "Scan Files",
    toolActionCountFiles: "Count Files",
    toolActionRunTests: "Run Tests",
    toolActionBuildProject: "Build Project",
    toolActionStartService: "Start Service",
    toolActionInstallDeps: "Install Deps",
    toolActionCheckStatus: "Check Status",
    toolActionGit: "Git Action",
    toolActionWebSearch: "Search Web",
    toolActionWebFetch: "Fetch Page",
    toolActionAgent: "Spawn Subagent",
    toolActionTodo: "Update Todo",
    toolActionAskUser: "Ask User",
    toolActionSkill: "Run Skill",
    toolActionPlanExit: "Exit Plan",
    toolActionMcp: "Call MCP",
    toolActionGeneric: "Use Tool",
    debugTitle: "Debug",
    debugNote: "Low-priority transport and runtime fields",
    inputShortLabel: "in",
    outputShortLabel: "out",
    requestShortLabel: "req",
    responseShortLabel: "resp",
    copyAction: "Copy",
    copiedAction: "Copied",
    closeAction: "Close",
    cacheCreationLabel: "Cache Write",
    cacheReadLabel: "Cache Read",
    cacheHitLabel: "hit",
    newTokensLabel: "new",
    cachedTokensLabel: "cached",
    sentTokensLabel: "sent",
    railUserInput: "User Input",
    railFinalResponse: "Response",
    railTaskStart: "Task Start",
    railAnalyzeResults: "Analyze Results",
    railComposeAnswer: "Compose Answer",
    railConnectivityCheck: "Connectivity Check",
    deltaSame: "= same",
    deltaNew: "new",
    deltaChanged: "changed",
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
    searchPlaceholder: "搜索用户输入或轮次...",
    tableSeq: "序号",
    tablePrompt: "用户输入",
    tableRequests: "请求数",
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
    settingsTitle: "设置",
    settingsLanguageLabel: "语言",
    settingsMirrorLabel: "下载源",
    settingsMemoryLabel: "加载运行记忆",
    settingsMemoryTooltip: "对下一次 melu run 生效。开启后会重新启用 embedding 运行时、记忆检索和记忆提取；如果模型尚未下载，保存时会按当前下载源先准备模型。",
    settingsMemoryReady: "模型已下载",
    settingsMemoryMissing: "模型未下载",
    settingsAutoOpenLabel: "自动打开观察台",
    settingsAutoOpenTooltip: "对下一次 melu run 生效。启动成功后，Melu 会自动在浏览器里打开本地观察台页面。",
    settingsNextRunBadge: "下次运行生效",
    settingsSaveAction: "保存",
    settingsSaving: "保存中...",
    settingsSaved: "已保存，正在刷新...",
    openTraceAction: "打开 trace 文件",
    disconnectedStatus: "已断开",
    offlineSnapshot: "离线快照",
    timelineLegend: "颜色 = 模型",
    timelineRequestUnit: "条请求",
    turnLabel: "轮次",
    turnRailTitle: "请求链",
    turnRailRequest: "请求",
    turnFallbackPreview: "未归组请求",
    promptInsightTitle: "↑ · Prompt",
    answerInsightTitle: "↓ · Answer",
    promptStructureTitle: "结构化摘要",
    promptBlocksTitle: "System Blocks",
    messageFlowTitle: "消息结构",
    rawPromptTitle: "原始信息",
    rawPromptAction: "查看原始信息",
    rawToolInputAction: "展开原始工具输入",
    noPromptSnapshot: "这条请求没有捕获到 prompt 快照。",
    noAnswerSnapshot: "这条请求没有捕获到模型响应。",
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
    promptGroupSystem: "系统提示",
    promptGroupMemory: "记忆",
    promptGroupUser: "用户输入",
    promptGroupTags: "运行时上下文",
    answerGroupReply: "文本回复",
    answerGroupThinking: "思考片段",
    answerGroupTools: "工具指令",
    promptItemMainSystem: "基础系统",
    promptItemSystemBlock: "系统段",
    promptItemMemoryInjection: "记忆注入",
    promptItemUserInput: "用户输入",
    promptItemToolResult: "工具结果",
    promptItemAssistantContext: "助手消息",
    promptItemTagContext: "运行时上下文",
    answerItemReply: "回复",
    answerItemThinking: "思考",
    answerItemTool: "工具调用",
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
    toolActionReadConfig: "读取配置",
    toolActionReadDocs: "读取文档",
    toolActionReadNotebook: "读取笔记",
    toolActionWrite: "写入文件",
    toolActionWriteConfig: "写入配置",
    toolActionWriteDocs: "写入文档",
    toolActionEdit: "修改文件",
    toolActionEditConfig: "修改配置",
    toolActionEditDocs: "修改文档",
    toolActionEditNotebook: "修改笔记",
    toolActionBatchEdit: "批量改写",
    toolActionBrowse: "浏览目录",
    toolActionSearchFiles: "搜索文件",
    toolActionSearchSource: "搜索源码",
    toolActionSearchDocs: "搜索文档",
    toolActionSearchContent: "搜索内容",
    toolActionRunCommand: "执行命令",
    toolActionScanFiles: "扫描文件",
    toolActionCountFiles: "统计文件",
    toolActionRunTests: "运行测试",
    toolActionBuildProject: "构建项目",
    toolActionStartService: "启动服务",
    toolActionInstallDeps: "安装依赖",
    toolActionCheckStatus: "检查状态",
    toolActionGit: "Git 操作",
    toolActionWebSearch: "联网搜索",
    toolActionWebFetch: "抓取网页",
    toolActionAgent: "派出子代理",
    toolActionTodo: "更新 Todo",
    toolActionAskUser: "请求输入",
    toolActionSkill: "调用技能",
    toolActionPlanExit: "结束规划",
    toolActionMcp: "调用 MCP",
    toolActionGeneric: "调用工具",
    debugTitle: "Debug",
    debugNote: "低优先级传输与运行字段",
    inputShortLabel: "输入",
    outputShortLabel: "输出",
    requestShortLabel: "请求",
    responseShortLabel: "响应",
    copyAction: "复制",
    copiedAction: "已复制",
    closeAction: "关闭",
    cacheCreationLabel: "缓存写入",
    cacheReadLabel: "缓存命中",
    cacheHitLabel: "命中",
    newTokensLabel: "新增",
    cachedTokensLabel: "缓存",
    sentTokensLabel: "发送",
    railUserInput: "用户输入",
    railFinalResponse: "回复",
    railTaskStart: "任务启动",
    railAnalyzeResults: "分析结果",
    railComposeAnswer: "整理答复",
    railConnectivityCheck: "连通测试",
    deltaSame: "= 同上",
    deltaNew: "新增",
    deltaChanged: "变动",
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
  const serializedTraceFileHref = JSON.stringify("/__melu/trace-file");
  const iconMetadata = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.5h10M3 8h10M3 12.5h10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.4"/><circle cx="4" cy="3.5" r="1" fill="currentColor"/><circle cx="12" cy="8" r="1" fill="currentColor"/><circle cx="7" cy="12.5" r="1" fill="currentColor"/></svg>';
  const iconTransport = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5h7m0 0-2-2m2 2-2 2M13 11H6m0 0 2-2m-2 2 2 2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4"/></svg>';
  const iconPrompt = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3 2.8 8 6 13M10 3l3.2 5L10 13M8.8 2.5 7.2 13.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4"/></svg>';
  const iconCopy = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="3.5" width="7" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.5 10.5V5.5A1.5 1.5 0 0 1 5 4h4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
  const iconCheck = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.4 2.8 2.8 6.2-6.4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6"/></svg>';
  const iconPending = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v4l2.8 1.8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/><circle cx="8" cy="8" r="5.1" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  const iconClose = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.4"/></svg>';
  const serializedIconCopy = JSON.stringify(iconCopy);
  const serializedIconCheck = JSON.stringify(iconCheck);
  const serializedIconPending = JSON.stringify(iconPending);
  const serializedIconClose = JSON.stringify(iconClose);

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
      color: var(--ink);
      border-color: rgba(23, 23, 23, 0.18);
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
      color: var(--ink);
    }

    .status-pill[data-tone="warning"] {
      color: var(--secondary);
    }

    .status-pill[data-tone="live"] {
      color: var(--success);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: currentColor;
      box-shadow: 0 0 12px currentColor;
      flex: none;
    }

    .session-status-wrap {
      min-width: 0;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .live-indicator {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(115, 92, 0, 0.12);
      color: var(--secondary);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      animation: live-pill-pulse 1.35s ease-in-out infinite;
    }

    .live-indicator.is-visible {
      display: inline-flex;
    }

    @keyframes live-pill-pulse {
      0%, 100% { opacity: 0.72; transform: translateY(0); }
      50% { opacity: 1; transform: translateY(-1px); }
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
      grid-template-columns: repeat(3, minmax(0, 1fr));
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
      color: var(--ink);
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

    .metric-breakdown {
      margin-top: 14px;
      display: grid;
      gap: 8px;
      font-family: var(--mono);
      font-size: 11px;
      color: var(--muted);
    }

    .metric-breakdown-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding-top: 8px;
      border-top: 1px solid var(--line-soft);
    }

    .metric-breakdown-row strong {
      color: var(--ink);
      font-weight: 700;
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
      position: relative;
      height: 226px;
      overflow: hidden;
    }

    .timeline-stage {
      position: absolute;
      left: 22px;
      right: 22px;
      top: 18px;
      bottom: 34px;
    }

    .timeline-grid-line {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 1px;
      background: rgba(23, 23, 23, 0.06);
      pointer-events: none;
    }

    .timeline-baseline {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 1px;
      background: rgba(23, 23, 23, 0.12);
      pointer-events: none;
    }

    .timeline-axis {
      position: absolute;
      left: 22px;
      right: 22px;
      bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      pointer-events: none;
    }

    .timeline-axis-label {
      color: var(--muted);
      font-size: 10px;
      line-height: 1;
      font-family: var(--mono);
      letter-spacing: 0.02em;
    }

    .timeline-empty {
      position: absolute;
      left: 22px;
      right: 22px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--muted);
      font-size: 12px;
      text-align: left;
    }

    .timeline-bar {
      appearance: none;
      position: absolute;
      left: 0;
      bottom: 0;
      border: 0;
      border-radius: 999px 999px 5px 5px;
      width: 12px;
      min-width: 12px;
      padding: 0;
      cursor: pointer;
      opacity: 0.92;
      transform: translateX(-50%);
      transition: transform 140ms ease, opacity 140ms ease;
      background: rgba(23, 23, 23, 0.14);
      box-shadow: inset 0 0 0 1px rgba(23, 23, 23, 0.08);
    }

    .timeline-bar:hover {
      transform: translate(-50%, -2px);
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
      border-color: rgba(23, 23, 23, 0.16);
      color: var(--ink);
    }

    .filter-button.active {
      background: var(--ink);
      border-color: var(--ink);
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
      border-color: rgba(23, 23, 23, 0.18);
      box-shadow: 0 0 0 3px rgba(23, 23, 23, 0.06);
    }

    .request-panel {
      overflow: visible;
    }

    .request-table-wrap {
      overflow-x: auto;
      overflow-y: visible;
      position: relative;
      z-index: 0;
    }

    .request-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      min-width: 760px;
    }

    .request-table thead th {
      position: sticky;
      top: 0;
      z-index: 2;
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
      position: relative;
      z-index: 1;
      padding: 16px 18px;
      border-bottom: 1px solid var(--line-soft);
      font-size: 12px;
      vertical-align: middle;
    }

    .request-table tbody td.request-token-cell:hover,
    .request-table tbody td.request-token-cell:focus-within {
      z-index: 5004;
    }

    .request-table thead th:nth-child(2),
    .request-table tbody td:nth-child(2) {
      padding-left: 8px;
    }

    .request-row {
      cursor: pointer;
      transition: background 140ms ease;
    }

    .request-row:hover {
      background: rgba(23, 23, 23, 0.028);
    }

    .request-row.is-selected {
      background: rgba(23, 23, 23, 0.045);
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
      background: linear-gradient(180deg, rgba(23, 23, 23, 0.82), rgba(23, 23, 23, 0.14));
      box-shadow: inset 0 0 0 1px rgba(23, 23, 23, 0.1);
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
      0%, 100% { transform: translateX(-50%) translateY(0); }
      50% { transform: translateX(-50%) translateY(-2px); }
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

    .turn-prompt {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      line-height: 1.55;
    }

    .duration-cell {
      position: relative;
      z-index: 1;
      display: grid;
      gap: 8px;
      min-width: 0;
    }

    .duration-cell.has-tooltip:hover,
    .duration-cell.has-tooltip:focus-within {
      z-index: 5002;
    }

    .duration-track {
      position: relative;
      width: 100%;
      height: 6px;
      border-radius: 999px;
      background: rgba(23, 23, 23, 0.08);
      overflow: hidden;
    }

    .duration-bar {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: rgba(23, 23, 23, 0.42);
    }

    .duration-bar.is-error {
      background: rgba(157, 31, 31, 0.7);
    }

    .duration-bar.is-in-flight {
      background: rgba(115, 92, 0, 0.72);
    }

    .table-token-fill {
      display: block;
      height: 100%;
    }

    .table-token-fill > .token-meter-bar {
      width: 100%;
      height: 100%;
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

    .detail-cluster {
      position: fixed;
      top: clamp(22px, 5vh, 42px);
      left: 50%;
      bottom: clamp(22px, 5vh, 42px);
      width: min(480px, calc(100vw - 32px));
      z-index: 80;
      pointer-events: none;
      --drag-x: 0px;
      --drag-y: 0px;
      transform: translate(calc(-50% + var(--drag-x)), calc(18px + var(--drag-y))) scale(0.985);
      opacity: 0;
      transition: transform 220ms ease, opacity 220ms ease;
      overflow: visible;
    }

    .detail-cluster.is-open {
      transform: translate(calc(-50% + var(--drag-x)), var(--drag-y)) scale(1);
      opacity: 1;
    }

    .detail-cluster.is-dragging,
    .drawer.is-dragging,
    .detail-rail-panel.is-dragging,
    .floating-window.is-dragging,
    .prompt-item-panel.is-dragging,
    .drawer-overlay.is-dragging {
      transition: none;
    }

    .detail-cluster > * {
      pointer-events: auto;
    }

    .drawer {
      position: absolute;
      inset: 0;
      width: 100%;
      background: rgba(251, 249, 246, 0.98);
      border: 1px solid var(--line);
      border-radius: 28px;
      box-shadow: 0 24px 80px rgba(35, 29, 23, 0.18);
      z-index: 1;
      display: flex;
      flex-direction: column;
      backdrop-filter: blur(14px);
      overflow: hidden;
      --drag-x: 0px;
      --drag-y: 0px;
      transform: translate(var(--drag-x), var(--drag-y));
    }

    .drawer-head {
      padding: 22px 26px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: rgba(245, 241, 235, 0.72);
      cursor: grab;
      user-select: none;
      touch-action: none;
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
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-gutter: stable;
      padding: 18px;
      display: grid;
      grid-template-columns: 1fr;
      gap: 18px;
      align-content: start;
    }

    .drawer-detail-stack {
      display: grid;
      gap: 18px;
      min-width: 0;
    }

    .detail-rail-panel {
      position: fixed;
      top: 0;
      left: 0;
      width: 220px;
      max-height: min(560px, calc(100vh - 40px));
      padding: 14px 12px 16px;
      border-radius: 20px;
      border: 1px solid var(--line);
      background: rgba(247, 243, 238, 0.98);
      box-shadow: 0 18px 48px rgba(35, 29, 23, 0.14);
      display: flex;
      flex-direction: column;
      gap: 10px;
      z-index: 130;
      backdrop-filter: blur(12px);
      overflow: visible;
      --drag-x: 0px;
      --drag-y: 0px;
      transform: translate(var(--drag-x), var(--drag-y));
    }

    .detail-rail-label {
      color: var(--muted);
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      text-align: center;
      flex: 0 0 auto;
      cursor: grab;
      user-select: none;
      touch-action: none;
    }

    .detail-rail-list {
      display: grid;
      gap: 0;
      position: relative;
      justify-items: stretch;
      align-content: start;
      padding: 4px 0;
      overflow-y: auto;
      overflow-x: visible;
      scrollbar-gutter: stable;
    }

    .rail-node {
      position: relative;
      z-index: 1;
      width: 100%;
      border: 1px solid rgba(23, 23, 23, 0.08);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.82);
      color: var(--muted);
      display: flex;
      flex-direction: column;
      gap: 0;
      padding: 12px 13px;
      text-align: left;
      cursor: pointer;
      box-shadow: 0 10px 24px rgba(35, 29, 23, 0.05);
      transition: background 140ms ease, color 140ms ease, border-color 140ms ease, transform 140ms ease, box-shadow 140ms ease;
    }

    .rail-node:hover {
      background: rgba(255, 255, 255, 0.96);
      border-color: rgba(23, 23, 23, 0.14);
      color: var(--ink);
      transform: translateY(-1px);
    }

    .rail-node.is-active {
      background: rgba(83, 42, 168, 0.06);
      border-color: rgba(83, 42, 168, 0.18);
      box-shadow: 0 14px 28px rgba(83, 42, 168, 0.08);
      color: var(--ink);
    }

    .rail-node.is-error {
      color: var(--error);
    }

    .rail-node.is-error.is-active {
      background: rgba(157, 31, 31, 0.08);
    }

    .rail-node.is-in-flight {
      color: var(--secondary);
    }

    .rail-node.is-in-flight.is-active {
      background: rgba(115, 92, 0, 0.08);
    }

    .rail-node-head {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .rail-node-seq {
      color: var(--primary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      font-weight: 700;
      line-height: 1;
      flex: 0 0 auto;
    }

    .rail-node.is-error .rail-node-seq {
      color: var(--error);
    }

    .rail-node.is-in-flight .rail-node-seq {
      color: var(--secondary);
    }

    .rail-node-label {
      font-size: 12px;
      font-weight: 700;
      line-height: 1.25;
      white-space: normal;
      overflow: hidden;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      min-width: 0;
    }

    .rail-token-meter,
    .token-meter-bar {
      height: 6px;
      border-radius: 999px;
      background: var(--line-soft);
      overflow: hidden;
      display: flex;
    }

    .token-meter-segment {
      height: 100%;
      min-width: 2px;
    }

    .token-meter-segment.is-new {
      background: linear-gradient(90deg, rgba(83, 42, 168, 0.88), rgba(83, 42, 168, 1));
    }

    .token-meter-segment.is-cached {
      background: rgba(83, 42, 168, 0.18);
    }

    .rail-connector {
      width: 1px;
      height: 6px;
      background: var(--line);
      margin: 0 auto;
      flex: 0 0 auto;
    }

    .drawer-summary-strip {
      grid-column: 1 / -1;
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 18px;
      padding: 14px 16px;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: rgba(245, 241, 235, 0.68);
    }

    .drawer-summary-main {
      min-width: 0;
      display: grid;
      gap: 12px;
      flex: 1 1 auto;
    }

    .summary-route {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.4;
      letter-spacing: 0.02em;
      word-break: break-word;
    }

    .summary-route:empty {
      display: none;
    }

    .summary-chip-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .drawer-toolbar,
    .section-actions,
    .drawer-overlay-actions,
    .prompt-item-panel-actions {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
    }

    .icon-button {
      width: 38px;
      height: 38px;
      border-radius: 999px;
      border: 1px solid rgba(23, 23, 23, 0.12);
      background: rgba(23, 23, 23, 0.06);
      color: var(--ink);
      display: inline-grid;
      place-items: center;
      padding: 0;
      transition: color 140ms ease, border-color 140ms ease, background 140ms ease, transform 140ms ease;
    }

    .icon-button:hover:not(:disabled) {
      color: var(--ink);
      border-color: rgba(23, 23, 23, 0.16);
      background: rgba(255, 255, 255, 0.98);
      transform: translateY(-1px);
    }

    .icon-button:disabled {
      opacity: 0.36;
      cursor: default;
    }

    .icon-button.is-active {
      color: var(--ink);
      background: rgba(23, 23, 23, 0.12);
      border-color: rgba(23, 23, 23, 0.22);
    }

    .icon-button.is-confirmed {
      color: var(--success);
      border-color: rgba(22, 101, 52, 0.18);
      background: rgba(22, 101, 52, 0.08);
    }

    .icon-button svg {
      width: 16px;
      height: 16px;
      display: block;
    }

    #drawer-transport-button {
      color: var(--secondary);
      background: rgba(115, 92, 0, 0.1);
      border-color: rgba(115, 92, 0, 0.18);
    }

    #prompt-raw-button {
      color: var(--primary);
      background: rgba(83, 42, 168, 0.1);
      border-color: rgba(83, 42, 168, 0.18);
    }

    .summary-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      padding: 8px 12px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.74);
      color: var(--ink);
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: 0.03em;
      white-space: nowrap;
      max-width: 100%;
      transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
    }

    .has-tooltip {
      position: relative;
      cursor: default;
      z-index: 0;
    }

    .has-tooltip:hover,
    .has-tooltip:focus-visible {
      z-index: 4000;
    }

    .has-tooltip::before,
    .has-tooltip::after {
      position: absolute;
      left: 50%;
      opacity: 0;
      pointer-events: none;
      transition: opacity 140ms ease, transform 140ms ease;
      z-index: 4001;
    }

    .has-tooltip::before {
      content: "";
      bottom: calc(100% + 4px);
      transform: translateX(-50%) translateY(4px);
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-top: 6px solid rgba(23, 23, 23, 0.92);
    }

    .has-tooltip::after {
      content: attr(data-tooltip);
      bottom: calc(100% + 10px);
      transform: translateX(-50%) translateY(4px);
      min-width: 96px;
      max-width: 240px;
      padding: 8px 10px;
      border-radius: 12px;
      background: rgba(23, 23, 23, 0.92);
      color: rgba(255, 255, 255, 0.94);
      font-size: 11px;
      line-height: 1.45;
      text-align: left;
      white-space: normal;
      box-shadow: 0 12px 28px rgba(23, 23, 23, 0.2);
    }

    .has-tooltip.is-left::before,
    .has-tooltip.is-left::after {
      left: auto;
      right: calc(100% + 10px);
    }

    .has-tooltip.is-left::before {
      top: 50%;
      bottom: auto;
      transform: translateX(4px) translateY(-50%);
      border-top: 6px solid transparent;
      border-bottom: 6px solid transparent;
      border-left: 6px solid rgba(23, 23, 23, 0.92);
      border-right: 0;
    }

    .has-tooltip.is-left::after {
      top: 50%;
      bottom: auto;
      transform: translateX(4px) translateY(-50%);
      max-width: 220px;
      white-space: pre-line;
    }

    .has-tooltip:hover::before,
    .has-tooltip:hover::after,
    .has-tooltip:focus-visible::before,
    .has-tooltip:focus-visible::after {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }

    .has-tooltip.is-left:hover::before,
    .has-tooltip.is-left:hover::after,
    .has-tooltip.is-left:focus-visible::before,
    .has-tooltip.is-left:focus-visible::after {
      transform: translateX(0) translateY(-50%);
    }

    .drawer-summary-strip .has-tooltip::before {
      top: calc(100% + 4px);
      bottom: auto;
      transform: translateX(-50%) translateY(-4px);
      border-top: 0;
      border-bottom: 6px solid rgba(23, 23, 23, 0.92);
    }

    .drawer-summary-strip .has-tooltip::after {
      top: calc(100% + 10px);
      bottom: auto;
      transform: translateX(-50%) translateY(-4px);
    }

    .drawer-summary-strip .has-tooltip:hover::before,
    .drawer-summary-strip .has-tooltip:hover::after,
    .drawer-summary-strip .has-tooltip:focus-visible::before,
    .drawer-summary-strip .has-tooltip:focus-visible::after {
      transform: translateX(-50%) translateY(0);
    }

    .summary-chip:hover,
    .summary-chip-row .model-chip:hover {
      transform: translateY(-1px);
      box-shadow: 0 8px 20px rgba(35, 29, 23, 0.08);
    }

    .summary-chip.is-icon {
      min-width: 40px;
      padding: 8px 10px;
    }

    .summary-chip-symbol {
      width: 16px;
      height: 16px;
      display: inline-grid;
      place-items: center;
    }

    .summary-chip-symbol svg {
      width: 16px;
      height: 16px;
      display: block;
    }

    .summary-chip.is-success {
      color: var(--success);
      border-color: rgba(22, 101, 52, 0.16);
      background: rgba(22, 101, 52, 0.08);
    }

    .summary-chip.is-warning {
      color: var(--secondary);
      border-color: rgba(115, 92, 0, 0.16);
      background: rgba(115, 92, 0, 0.08);
    }

    .summary-chip.is-error {
      color: var(--error);
      border-color: rgba(157, 31, 31, 0.16);
      background: rgba(157, 31, 31, 0.08);
    }

    .summary-token-chip {
      min-width: 176px;
      padding: 10px 12px;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.78);
      display: grid;
      gap: 7px;
    }

    .summary-token-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 11px;
      font-weight: 700;
      color: var(--ink);
    }

    .summary-token-title,
    .summary-token-note {
      white-space: nowrap;
    }

    .summary-token-note {
      color: var(--muted);
      font-size: 10px;
    }

    .summary-token-bar {
      width: 100%;
    }

    .detail-section {
      background: rgba(255, 255, 255, 0.68);
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 20px;
    }

    .section-head {
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .detail-section-wide {
      grid-column: 1 / -1;
    }

    .detail-title {
      margin: 0;
      font-family: var(--serif);
      font-size: 24px;
      line-height: 1;
      letter-spacing: -0.03em;
      color: var(--ink);
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
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
      color: var(--ink);
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
    .raw-panel details {
      border: 1px solid var(--line-soft);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.58);
      overflow: hidden;
    }

    .accordion-group.group-user {
      border-color: rgba(255, 138, 30, 0.2);
      background: rgba(255, 248, 242, 0.82);
    }

    .accordion-group.group-user > summary {
      background: rgba(255, 248, 242, 0.78);
    }

    .accordion-group.group-user .accordion-title {
      color: #9a4e00;
    }

    .accordion-group.group-user .accordion-badge {
      background: rgba(255, 138, 30, 0.14);
      color: #9a4e00;
    }

    .accordion-group summary,
    .tool-item summary,
    .raw-panel summary {
      list-style: none;
      cursor: pointer;
    }

    .accordion-group summary::-webkit-details-marker,
    .tool-item summary::-webkit-details-marker,
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
      background: rgba(23, 23, 23, 0.05);
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .accordion-summary-side {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }

    .accordion-delta {
      display: inline-flex;
      align-items: center;
      padding: 7px 11px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .accordion-delta.is-same {
      background: rgba(23, 23, 23, 0.04);
      color: var(--muted);
    }

    .accordion-delta.is-new {
      background: rgba(22, 101, 52, 0.08);
      color: var(--success);
    }

    .accordion-delta.is-changed {
      background: rgba(115, 92, 0, 0.08);
      color: var(--secondary);
    }

    .accordion-group > summary::after,
    .tool-item > summary::after,
    .raw-panel summary::after {
      content: "+";
      position: absolute;
      right: 18px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--ink);
      font-size: 18px;
      line-height: 1;
    }

    .accordion-group > summary,
    .tool-item > summary,
    .raw-panel summary {
      position: relative;
      padding-right: 48px;
    }

    .accordion-group[open] > summary::after,
    .tool-item[open] > summary::after,
    .raw-panel details[open] summary::after {
      content: "−";
    }

    .accordion-body,
    .tool-body,
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

    .prompt-item-card {
      width: 100%;
      border: 1px solid var(--line-soft);
      border-radius: 18px;
      background: rgba(247, 244, 239, 0.72);
      padding: 13px 14px;
      text-align: left;
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 12px;
      transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
    }

    .prompt-item-card:hover {
      transform: translateY(-1px);
      border-color: rgba(23, 23, 23, 0.14);
      background: rgba(255, 255, 255, 0.9);
      box-shadow: 0 10px 24px rgba(35, 29, 23, 0.06);
    }

    .prompt-item-card.is-active {
      border-color: rgba(83, 42, 168, 0.16);
      background: rgba(83, 42, 168, 0.06);
      box-shadow: 0 12px 28px rgba(83, 42, 168, 0.08);
    }

    .prompt-item-card-main {
      min-width: 0;
      display: grid;
      gap: 6px;
    }

    .prompt-item-card .accordion-title {
      font-size: 13px;
    }

    .prompt-item-card .accordion-note {
      font-size: 10px;
    }

    .prompt-item-card-mark {
      flex: 0 0 auto;
      width: 28px;
      height: 28px;
      border-radius: 999px;
      border: 1px solid rgba(23, 23, 23, 0.08);
      background: rgba(255, 255, 255, 0.82);
      color: var(--muted);
      display: inline-grid;
      place-items: center;
      font-size: 16px;
      line-height: 1;
    }

    .tool-card {
      width: 100%;
      border: 1px solid var(--line-soft);
      border-radius: 22px;
      background: rgba(247, 244, 239, 0.76);
      padding: 16px 18px;
      text-align: left;
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 14px;
      transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
    }

    .tool-card:hover {
      transform: translateY(-1px);
      border-color: rgba(23, 23, 23, 0.14);
      background: rgba(255, 255, 255, 0.92);
      box-shadow: 0 12px 28px rgba(35, 29, 23, 0.06);
    }

    .tool-card.is-active {
      border-color: rgba(83, 42, 168, 0.16);
      background: rgba(83, 42, 168, 0.05);
      box-shadow: 0 14px 30px rgba(83, 42, 168, 0.08);
    }

    .tool-card-main {
      min-width: 0;
      display: grid;
      gap: 8px;
      flex: 1 1 auto;
    }

    .tool-card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .tool-card-title {
      font-size: 14px;
      font-weight: 700;
      line-height: 1.25;
      color: var(--ink);
    }

    .tool-card-note {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.6;
      word-break: break-word;
    }

    .tool-card-side {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      gap: 10px;
    }

    .tool-card-badge {
      display: inline-flex;
      align-items: center;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(23, 23, 23, 0.05);
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .tool-card-mark {
      width: 26px;
      height: 26px;
      border-radius: 999px;
      border: 1px solid rgba(23, 23, 23, 0.08);
      background: rgba(255, 255, 255, 0.82);
      color: var(--muted);
      display: inline-grid;
      place-items: center;
      font-size: 16px;
      line-height: 1;
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

    .prompt-item-panel {
      position: absolute;
      top: 118px;
      left: calc(100% + 14px);
      width: min(420px, 38vw);
      max-height: calc(100% - 138px);
      border-radius: 24px;
      border: 1px solid var(--line);
      background: rgba(251, 249, 246, 0.98);
      box-shadow: 0 22px 56px rgba(35, 29, 23, 0.16);
      backdrop-filter: blur(12px);
      overflow: hidden;
      --drag-x: 0px;
      --drag-y: 0px;
      transform: translate(calc(10px + var(--drag-x)), var(--drag-y)) scale(0.985);
      opacity: 0;
      pointer-events: none;
      transition: transform 180ms ease, opacity 180ms ease;
      z-index: 1;
    }

    .prompt-item-panel.is-open {
      transform: translate(var(--drag-x), var(--drag-y)) scale(1);
      opacity: 1;
      pointer-events: auto;
    }

    .prompt-item-panel-head {
      padding: 18px 20px;
      border-bottom: 1px solid var(--line-soft);
      background: rgba(245, 241, 235, 0.74);
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 12px;
      cursor: grab;
      user-select: none;
      touch-action: none;
    }

    .prompt-item-panel-copy {
      min-width: 0;
      display: grid;
      gap: 6px;
    }

    .prompt-item-panel-group {
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .prompt-item-panel-title {
      font-size: 18px;
      font-weight: 700;
      line-height: 1.2;
      color: var(--ink);
    }

    .prompt-item-panel-meta {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.6;
    }

    .prompt-item-panel-body {
      max-height: calc(100% - 96px);
      overflow: auto;
      scrollbar-gutter: stable;
      padding: 18px 20px 20px;
      display: grid;
      gap: 12px;
    }

    .tool-meta {
      display: grid;
      gap: 8px;
    }

    .tool-empty,
    .insight-empty {
      padding: 14px 16px;
      border-radius: 16px;
      border: 1px dashed rgba(23, 23, 23, 0.14);
      background: rgba(255, 255, 255, 0.46);
      color: var(--muted);
      font-size: 12px;
      line-height: 1.8;
    }

    .drawer-overlay-backdrop {
      position: absolute;
      inset: 82px 0 0;
      background: rgba(22, 18, 14, 0.12);
      opacity: 0;
      pointer-events: none;
      transition: opacity 180ms ease;
      z-index: 2;
    }

    .drawer-overlay-backdrop.is-open {
      opacity: 1;
      pointer-events: auto;
    }

    .drawer-overlay {
      position: absolute;
      top: 94px;
      right: 14px;
      width: min(432px, calc(100% - 28px));
      max-height: calc(100% - 118px);
      display: flex;
      flex-direction: column;
      border-radius: 24px;
      border: 1px solid var(--line);
      background: rgba(251, 249, 246, 0.98);
      box-shadow: 0 28px 72px rgba(35, 29, 23, 0.2);
      --drag-x: 0px;
      --drag-y: 0px;
      transform: translate(var(--drag-x), calc(8px + var(--drag-y))) scale(0.985);
      opacity: 0;
      pointer-events: none;
      transition: transform 180ms ease, opacity 180ms ease;
      z-index: 3;
      overflow: hidden;
    }

    .drawer-overlay.is-open {
      transform: translate(var(--drag-x), var(--drag-y)) scale(1);
      opacity: 1;
      pointer-events: auto;
    }

    .drawer-overlay-head {
      padding: 18px 20px;
      border-bottom: 1px solid var(--line-soft);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: rgba(245, 241, 235, 0.74);
      cursor: grab;
      user-select: none;
      touch-action: none;
    }

    .drawer-overlay-title {
      font-family: var(--mono);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--ink);
    }

    .drawer-overlay-body {
      padding: 18px 20px 20px;
      overflow: auto;
      scrollbar-gutter: stable;
      display: grid;
      gap: 12px;
    }

    .floating-window-host {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 90;
      overflow: visible;
    }

    .floating-window {
      position: absolute;
      width: min(420px, calc(100vw - 44px));
      max-height: min(560px, calc(100% - 116px));
      display: flex;
      flex-direction: column;
      border-radius: 24px;
      border: 1px solid var(--line);
      background: rgba(251, 249, 246, 0.98);
      box-shadow: 0 24px 64px rgba(35, 29, 23, 0.18);
      backdrop-filter: blur(12px);
      overflow: hidden;
      pointer-events: auto;
      --drag-x: 0px;
      --drag-y: 0px;
      transform: translate(var(--drag-x), var(--drag-y)) scale(0.985);
      opacity: 0;
      transition: transform 180ms ease, opacity 180ms ease, box-shadow 180ms ease;
    }

    .floating-window.is-open {
      transform: translate(var(--drag-x), var(--drag-y)) scale(1);
      opacity: 1;
    }

    .floating-window.is-active {
      box-shadow: 0 28px 80px rgba(35, 29, 23, 0.24);
    }

    .floating-window.is-wide {
      width: min(432px, calc(100vw - 44px));
    }

    .floating-window-head {
      padding: 18px 20px;
      border-bottom: 1px solid var(--line-soft);
      background: rgba(245, 241, 235, 0.74);
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 12px;
      cursor: grab;
      user-select: none;
      touch-action: none;
    }

    .floating-window-copy {
      min-width: 0;
      display: grid;
      gap: 6px;
    }

    .floating-window-group {
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .floating-window-title {
      font-size: 18px;
      font-weight: 700;
      line-height: 1.2;
      color: var(--ink);
    }

    .floating-window-title.is-mono {
      font-family: var(--mono);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .floating-window-meta {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.6;
    }

    .floating-window-actions {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
    }

    .floating-window-body {
      padding: 18px 20px 20px;
      overflow: auto;
      scrollbar-gutter: stable;
      display: grid;
      gap: 12px;
    }

    .overlay-note {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.7;
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

    .footer-path-link {
      color: inherit;
      text-decoration: none;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .footer-path-link:hover {
      color: var(--ink);
      text-decoration: underline;
    }

    .settings-stack {
      display: grid;
      gap: 14px;
    }

    .settings-field {
      display: grid;
      gap: 8px;
      padding: 14px 16px;
      border: 1px solid var(--line-soft);
      border-radius: 18px;
      background: rgba(247, 244, 239, 0.72);
    }

    .settings-label {
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.16em;
    }

    .settings-select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.92);
      color: var(--ink);
      font-size: 13px;
      padding: 12px 14px;
    }

    .settings-card {
      padding: 16px;
      border: 1px solid var(--line-soft);
      border-radius: 18px;
      background: rgba(247, 244, 239, 0.72);
    }

    .settings-card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .settings-card-copy {
      min-width: 0;
      display: grid;
      gap: 10px;
    }

    .settings-card-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .settings-card-title {
      color: var(--ink);
      font-size: 14px;
      font-weight: 700;
      line-height: 1.3;
    }

    .settings-card-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .settings-status-pill {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.84);
      border: 1px solid rgba(23, 23, 23, 0.08);
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .settings-status-pill.is-ready {
      color: var(--success);
      border-color: rgba(22, 101, 52, 0.14);
      background: rgba(22, 101, 52, 0.08);
    }

    .settings-status-pill.is-pending {
      color: var(--secondary);
      border-color: rgba(115, 92, 0, 0.14);
      background: rgba(115, 92, 0, 0.08);
    }

    .settings-info {
      width: 24px;
      height: 24px;
      border-radius: 999px;
      border: 1px solid rgba(23, 23, 23, 0.1);
      background: rgba(255, 255, 255, 0.86);
      color: var(--muted);
      display: inline-grid;
      place-items: center;
      padding: 0;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
    }

    .settings-switch {
      position: relative;
      width: 52px;
      height: 32px;
      flex: 0 0 auto;
      display: inline-block;
    }

    .settings-switch input {
      position: absolute;
      inset: 0;
      opacity: 0;
      margin: 0;
      cursor: pointer;
    }

    .settings-switch-track {
      position: absolute;
      inset: 0;
      border-radius: 999px;
      background: rgba(23, 23, 23, 0.12);
      border: 1px solid rgba(23, 23, 23, 0.08);
      transition: background 140ms ease, border-color 140ms ease;
    }

    .settings-switch-track::after {
      content: "";
      position: absolute;
      top: 4px;
      left: 4px;
      width: 22px;
      height: 22px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 6px 14px rgba(23, 23, 23, 0.14);
      transition: transform 140ms ease;
    }

    .settings-switch input:checked + .settings-switch-track {
      background: rgba(83, 42, 168, 0.18);
      border-color: rgba(83, 42, 168, 0.26);
    }

    .settings-switch input:checked + .settings-switch-track::after {
      transform: translateX(20px);
    }

    .settings-switch input:focus-visible + .settings-switch-track {
      box-shadow: 0 0 0 3px rgba(83, 42, 168, 0.12);
    }

    .settings-note {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.7;
    }

    .settings-actions {
      display: flex;
      justify-content: flex-end;
    }

    .settings-save {
      border: 1px solid rgba(83, 42, 168, 0.18);
      background: rgba(83, 42, 168, 0.1);
      color: var(--primary);
      border-radius: 999px;
      padding: 10px 16px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .settings-save:disabled {
      opacity: 0.5;
    }

    .settings-feedback {
      color: var(--muted);
      font-size: 11px;
      min-height: 1.4em;
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

      .prompt-item-panel {
        width: min(340px, calc(100vw - 150px));
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
        border-radius: 22px;
      }

      .detail-cluster {
        top: 10px;
        bottom: 10px;
        width: calc(100vw - 20px);
      }

      .drawer-body {
        grid-template-columns: 1fr;
        padding: 96px 18px 18px;
      }

      .drawer-summary-strip {
        flex-direction: column;
        align-items: stretch;
      }

      .detail-rail-panel {
        top: 94px;
        right: 14px;
        left: 14px;
        bottom: auto;
        width: auto;
        max-height: 220px;
        padding: 12px 14px;
        border-radius: 18px;
        flex-direction: column;
        gap: 8px;
      }

      .detail-rail-list {
        overflow-y: auto;
        overflow-x: hidden;
        padding-bottom: 2px;
      }

      .rail-connector {
        height: 4px;
      }

      .prompt-item-panel {
        top: 112px;
        right: 14px;
        left: 14px;
        width: auto;
        max-height: calc(100% - 132px);
      }

      .detail-rail-list::before {
        display: none;
      }

      .drawer-toolbar {
        justify-content: flex-end;
      }

      .drawer-overlay {
        top: 88px;
        right: 10px;
        left: 10px;
        width: auto;
        max-height: calc(100% - 108px);
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
        <a id="nav-settings-button" class="nav-item" href="#"><span class="nav-mark"></span>${copy.navSettings}</a>
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
        <button id="settings-button" class="action-chip" type="button">${copy.actionSettings}</button>
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
            <span class="session-status-wrap">
              <span id="session-status-pill" class="status-pill"><span class="status-dot"></span><span id="session-status-text"></span></span>
              <span id="session-inflight-indicator" class="live-indicator"></span>
            </span>
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
              <div class="metric-breakdown">
                <div id="card-input-tokens" class="metric-breakdown-row"></div>
                <div id="card-output-tokens" class="metric-breakdown-row"></div>
              </div>
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

          <section class="panel request-panel">
            <div class="request-table-wrap">
              <table class="request-table">
                <colgroup>
                  <col style="width:14%" />
                  <col style="width:42%" />
                  <col style="width:16%" />
                  <col style="width:14%" />
                  <col style="width:14%" />
                </colgroup>
                <thead>
                  <tr>
                    <th>${copy.tableSeq}</th>
                    <th>${copy.tablePrompt}</th>
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
        <a id="footer-path" class="footer-path-link mono" href="#" target="_blank" rel="noreferrer">${copy.openTraceAction}</a>
      </div>
    </footer>
  </div>

  <div id="drawer-backdrop" class="drawer-backdrop" hidden></div>
  <aside id="detail-rail-panel" class="detail-rail-panel" aria-label="${copy.turnRailTitle}" hidden>
    <div class="detail-rail-label">${copy.turnRailTitle}</div>
    <div id="drawer-turn-rail" class="detail-rail-list"></div>
  </aside>
  <div id="detail-cluster" class="detail-cluster" hidden>
    <aside id="detail-drawer" class="drawer">
      <div class="drawer-head">
        <div id="drawer-request-title" class="drawer-title">${copy.drawerTitle}</div>
        <button id="drawer-close" class="drawer-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="drawer-body">
        <div class="drawer-summary-strip">
          <div class="drawer-summary-main">
            <div id="drawer-request-route" class="summary-route"></div>
            <div class="summary-chip-row">
              <span id="drawer-summary-model"></span>
              <span id="drawer-summary-status"></span>
              <span id="drawer-summary-duration"></span>
              <span id="drawer-summary-tokens"></span>
            </div>
          </div>
          <div class="drawer-toolbar">
            <button id="drawer-metadata-button" class="icon-button" type="button" title="${copy.metadata}" aria-label="${copy.metadata}">${iconMetadata}</button>
            <button id="drawer-transport-button" class="icon-button" type="button" title="${copy.transportLayer}" aria-label="${copy.transportLayer}">${iconTransport}</button>
          </div>
        </div>
        <div class="drawer-detail-stack">
          <section class="detail-section detail-section-wide">
            <div class="section-head">
              <h3 class="detail-title">${copy.promptInsightTitle}</h3>
              <div class="section-actions">
                <button id="prompt-raw-button" class="icon-button" type="button" title="${copy.rawPromptAction}" aria-label="${copy.rawPromptAction}">${iconPrompt}</button>
              </div>
            </div>
            <div id="drawer-prompt-structure" class="insight-stack"></div>
          </section>

          <section class="detail-section detail-section-wide">
            <div class="section-head">
              <h3 class="detail-title">${copy.answerInsightTitle}</h3>
            </div>
            <div id="drawer-answer-structure" class="insight-stack"></div>
          </section>
        </div>
      </div>
      <div id="drawer-overlay-backdrop" class="drawer-overlay-backdrop" hidden></div>
      <section id="drawer-overlay" class="drawer-overlay" hidden>
        <div class="drawer-overlay-head">
          <div id="drawer-overlay-title" class="drawer-overlay-title"></div>
          <div class="drawer-overlay-actions">
            <button id="drawer-overlay-copy" class="icon-button" type="button" title="${copy.copyAction}" aria-label="${copy.copyAction}" hidden>${iconCopy}</button>
            <button id="drawer-overlay-close" class="icon-button" type="button" title="${copy.closeAction}" aria-label="${copy.closeAction}">${iconClose}</button>
          </div>
        </div>
        <div id="drawer-overlay-body" class="drawer-overlay-body"></div>
      </section>
    </aside>
    <aside id="prompt-item-panel" class="prompt-item-panel" hidden>
      <div class="prompt-item-panel-head">
        <div class="prompt-item-panel-copy">
          <div id="prompt-item-panel-group" class="prompt-item-panel-group"></div>
          <div id="prompt-item-panel-title" class="prompt-item-panel-title"></div>
          <div id="prompt-item-panel-meta" class="prompt-item-panel-meta"></div>
        </div>
        <div class="prompt-item-panel-actions">
          <button id="prompt-item-panel-copy" class="icon-button" type="button" title="${copy.copyAction}" aria-label="${copy.copyAction}" hidden>${iconCopy}</button>
          <button id="prompt-item-panel-close" class="icon-button" type="button" title="${copy.closeAction}" aria-label="${copy.closeAction}">${iconClose}</button>
        </div>
      </div>
      <div id="prompt-item-panel-body" class="prompt-item-panel-body"></div>
    </aside>
  </div>
  <div id="floating-window-host" class="floating-window-host"></div>

  <script>
    const runId = ${serializedRunId};
    const text = ${serializedCopy};
    const tracePath = ${serializedTracePath};
    const traceFileHref = ${serializedTraceFileHref};
    const endpoint = "/__melu/events";
    const copyIconMarkup = ${serializedIconCopy};
    const copiedIconMarkup = ${serializedIconCheck};
    const pendingIconMarkup = ${serializedIconPending};
    const closeIconMarkup = ${serializedIconClose};

    const elements = {
      mainScroll: document.querySelector(".main"),
      sessionRunId: document.getElementById("session-run-id"),
      sessionCommand: document.getElementById("session-command"),
      sessionCwd: document.getElementById("session-cwd"),
      sessionStart: document.getElementById("session-start"),
      sessionStatusPill: document.getElementById("session-status-pill"),
      sessionStatusText: document.getElementById("session-status-text"),
      sessionInflightIndicator: document.getElementById("session-inflight-indicator"),
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
      cardSuccessRate: document.getElementById("card-success-rate"),
      cardSuccessCount: document.getElementById("card-success-count"),
      cardErrorCount: document.getElementById("card-error-count"),
      cardLatency: document.getElementById("card-latency"),
      cardInputTokens: document.getElementById("card-input-tokens"),
      cardOutputTokens: document.getElementById("card-output-tokens"),
      timelineMeta: document.getElementById("timeline-meta"),
      timelineBars: document.getElementById("timeline-bars"),
      requestTableBody: document.getElementById("request-table-body"),
      footerRefresh: document.getElementById("footer-refresh"),
      footerPath: document.getElementById("footer-path"),
      drawerBackdrop: document.getElementById("drawer-backdrop"),
      detailCluster: document.getElementById("detail-cluster"),
      detailRailPanel: document.getElementById("detail-rail-panel"),
      detailDrawer: document.getElementById("detail-drawer"),
      floatingWindowHost: document.getElementById("floating-window-host"),
      drawerClose: document.getElementById("drawer-close"),
      drawerRequestTitle: document.getElementById("drawer-request-title"),
      drawerRequestRoute: document.getElementById("drawer-request-route"),
      drawerSummaryModel: document.getElementById("drawer-summary-model"),
      drawerSummaryStatus: document.getElementById("drawer-summary-status"),
      drawerSummaryDuration: document.getElementById("drawer-summary-duration"),
      drawerSummaryTokens: document.getElementById("drawer-summary-tokens"),
      drawerTurnRail: document.getElementById("drawer-turn-rail"),
      drawerMetadataButton: document.getElementById("drawer-metadata-button"),
      drawerTransportButton: document.getElementById("drawer-transport-button"),
      promptRawButton: document.getElementById("prompt-raw-button"),
      drawerOverlayBackdrop: document.getElementById("drawer-overlay-backdrop"),
      drawerOverlay: document.getElementById("drawer-overlay"),
      drawerOverlayTitle: document.getElementById("drawer-overlay-title"),
      drawerOverlayBody: document.getElementById("drawer-overlay-body"),
      drawerOverlayCopy: document.getElementById("drawer-overlay-copy"),
      drawerOverlayClose: document.getElementById("drawer-overlay-close"),
      drawerPromptStructure: document.getElementById("drawer-prompt-structure"),
      drawerAnswerStructure: document.getElementById("drawer-answer-structure"),
      promptItemPanel: document.getElementById("prompt-item-panel"),
      promptItemPanelGroup: document.getElementById("prompt-item-panel-group"),
      promptItemPanelTitle: document.getElementById("prompt-item-panel-title"),
      promptItemPanelMeta: document.getElementById("prompt-item-panel-meta"),
      promptItemPanelBody: document.getElementById("prompt-item-panel-body"),
      promptItemPanelCopy: document.getElementById("prompt-item-panel-copy"),
      promptItemPanelClose: document.getElementById("prompt-item-panel-close"),
      refreshButton: document.getElementById("refresh-button"),
      settingsButton: document.getElementById("settings-button"),
      navSettingsButton: document.getElementById("nav-settings-button"),
      searchInput: document.getElementById("search-input"),
      filterButtons: Array.from(document.querySelectorAll(".filter-button")),
      navItems: Array.from(document.querySelectorAll(".nav-item[data-view]"))
    };

    let lastRenderSignature = "";
    let activeFilter = "all";
    let searchTerm = "";
    let selectedTurnId = null;
    let selectedRequestId = null;
    let currentView = "overview";
    let isOffline = false;
    let lastSuccessfulRefreshAt = null;
    let activeOverlayKind = null;
    let overlayCopyText = "";
    let overlayCopyResetTimer = null;
    let activePromptPanelKind = null;
    let activePromptItemId = null;
    let promptPanelCopyText = "";
    let promptPanelCopyResetTimer = null;
    let promptItemRegistry = new Map();
    let answerItemRegistry = new Map();
    let settingsLoadPromise = null;
    const floatingWindows = new Map();
    let floatingWindowZ = 20;
    const snapshotStorageKey = "melu-trace-snapshot:" + runId;
    let latestState = {
      events: [],
      requests: [],
      turns: [],
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
      const safeValue = Math.max(0, value);
      if (safeValue < 1000) return Math.round(safeValue) + "ms";
      if (safeValue < 60_000) {
        const seconds = safeValue / 1000;
        const precision = seconds >= 10 ? 0 : 1;
        return seconds.toFixed(precision).replace(/\\.0$/, "") + "s";
      }

      const totalSeconds = Math.round(safeValue / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      if (hours > 0) {
        return hours + "h " + String(minutes).padStart(2, "0") + "m";
      }
      return minutes + "m " + String(seconds).padStart(2, "0") + "s";
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

    function renderModelChip(model, tooltip) {
      const rawLabel = model || "--";
      const tone = modelTone(rawLabel);
      const displayLabel = modelDisplayLabel(rawLabel);
      return '<span class="model-chip ' + tone + (tooltip ? ' has-tooltip' : '') + '"'
        + (tooltip ? ' data-tooltip="' + escapeHtml(tooltip) + '"' : '')
        + '>'
        + escapeHtml(displayLabel)
        + '</span>';
    }

    function totalUsage(request) {
      const cache = cacheUsageInfo(request);
      const output = typeof request.outputTokens === "number" ? request.outputTokens : 0;
      const total = cache.totalPromptTokens + output;
      return total > 0 ? total : null;
    }

    function cacheUsageInfo(request) {
      const inputTokens = typeof request.inputTokens === "number" ? request.inputTokens : 0;
      const cacheCreationTokens = typeof request.cacheCreationTokens === "number" ? request.cacheCreationTokens : 0;
      const cachedTokens = typeof request.cacheReadTokens === "number" ? request.cacheReadTokens : 0;
      const newTokens = inputTokens + cacheCreationTokens;
      const totalPromptTokens = newTokens + cachedTokens;
      const hitPct = totalPromptTokens > 0 ? Math.round((cachedTokens / totalPromptTokens) * 100) : 0;
      return {
        inputTokens: inputTokens,
        cacheCreationTokens: cacheCreationTokens,
        cachedTokens: cachedTokens,
        newTokens: newTokens,
        totalPromptTokens: totalPromptTokens,
        hitPct: hitPct
      };
    }

    function aggregateRequestUsage(requests) {
      const totals = {
        newTokens: 0,
        cachedTokens: 0,
        promptTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        hitPct: 0
      };

      (Array.isArray(requests) ? requests : []).forEach(function (request) {
        const cache = cacheUsageInfo(request);
        totals.newTokens += cache.newTokens;
        totals.cachedTokens += cache.cachedTokens;
        totals.promptTokens += cache.totalPromptTokens;
        totals.outputTokens += typeof request.outputTokens === "number" ? request.outputTokens : 0;
      });

      totals.totalTokens = totals.promptTokens + totals.outputTokens;
      totals.hitPct = totals.promptTokens > 0
        ? Math.round((totals.cachedTokens / totals.promptTokens) * 100)
        : 0;
      return totals;
    }

    function tokenBreakdownParts(request) {
      const cache = cacheUsageInfo(request);
      const parts = [];
      if (cache.inputTokens > 0) {
        parts.push(text.inputTokensLabel + " " + formatTokenCount(cache.inputTokens));
      }
      if (cache.cacheCreationTokens > 0) {
        parts.push(text.cacheCreationLabel + " " + formatTokenCount(cache.cacheCreationTokens));
      }
      if (cache.cachedTokens > 0 || cache.totalPromptTokens > 0) {
        parts.push(text.cacheReadLabel + " " + formatTokenCount(cache.cachedTokens));
      }
      if (typeof request.outputTokens === "number") {
        parts.push(text.outputTokensLabel + " " + formatTokenCount(request.outputTokens));
      }
      return parts;
    }

    function tokenMeterPercents(cache) {
      if (!cache.totalPromptTokens) {
        return { newPct: 0, cachedPct: 0 };
      }

      let newPct = Math.round((cache.newTokens / cache.totalPromptTokens) * 100);
      let cachedPct = 100 - newPct;

      if (cache.newTokens > 0 && newPct === 0) {
        newPct = 1;
        cachedPct = 99;
      }
      if (cache.cachedTokens > 0 && cachedPct === 0) {
        cachedPct = 1;
        newPct = 99;
      }

      return { newPct: newPct, cachedPct: cachedPct };
    }

    function renderTokenMeterBar(cache, className) {
      if (!cache || !cache.totalPromptTokens) return "";
      const widths = tokenMeterPercents(cache);
      return '<div class="' + escapeHtml(className || "token-meter-bar") + ' token-meter-bar">'
        + (cache.newTokens > 0 ? '<span class="token-meter-segment is-new" style="width:' + widths.newPct + '%"></span>' : '')
        + (cache.cachedTokens > 0 ? '<span class="token-meter-segment is-cached" style="width:' + widths.cachedPct + '%"></span>' : '')
        + '</div>';
    }

    function renderSummaryTokenMeter(request) {
      const cache = cacheUsageInfo(request);
      const tooltip = tokenBreakdownParts(request).join(" · ");

      if (!cache.totalPromptTokens) {
        return renderSummaryChip(
          escapeHtml(typeof request.outputTokens === "number" ? formatTokenCount(request.outputTokens) + " " + text.outputTokensLabel : "--"),
          "",
          false,
          tooltip || text.usageLabel + " --"
        );
      }

      return '<span class="summary-token-chip has-tooltip" data-tooltip="' + escapeHtml(tooltip || "--") + '">'
        + '<span class="summary-token-head">'
        + '<span class="summary-token-title">' + escapeHtml("+" + formatTokenCount(cache.newTokens) + " " + text.newTokensLabel) + '</span>'
        + '<span class="summary-token-note">' + escapeHtml(cache.hitPct + "% " + text.cacheHitLabel) + '</span>'
        + '</span>'
        + renderTokenMeterBar(cache, "summary-token-bar")
        + '</span>';
    }

    function formatTokenSummary(request) {
      const cache = cacheUsageInfo(request);
      const output = typeof request.outputTokens === "number" ? request.outputTokens : 0;
      const total = totalUsage(request);
      if (total === null) return "--";

      const details = [];
      if (cache.newTokens > 0) {
        details.push(text.newTokensLabel + " " + formatTokenCount(cache.newTokens));
      }
      if (cache.cachedTokens > 0 || cache.totalPromptTokens > 0) {
        details.push(text.cachedTokensLabel + " " + formatTokenCount(cache.cachedTokens));
      }
      if (output > 0) {
        details.push(text.outputShortLabel + " " + formatTokenCount(output));
      }

      return formatTokenCount(total) + (details.length ? " · " + details.join(" / ") : "");
    }

    function formatByteSummary(request) {
      const details = [];
      if (typeof request.requestBytes === "number") {
        details.push(text.requestShortLabel + " " + formatBytes(request.requestBytes));
      }
      if (typeof request.responseBytes === "number") {
        details.push(text.responseShortLabel + " " + formatBytes(request.responseBytes));
      }
      return details.length ? details.join(" · ") : "--";
    }

    function truncatePreview(value, limit) {
      const textValue = String(value || "");
      if (textValue.length <= limit) return textValue;
      return textValue.slice(0, limit) + "…";
    }

    function isCommandTranscriptText(value) {
      const normalized = String(value || "").trim();
      return normalized.startsWith("Command: ") && normalized.includes("\\nOutput:");
    }

    function isPolicySpecText(value) {
      const normalized = String(value || "").trim();
      return normalized.startsWith("<policy_spec>")
        && normalized.includes("The user has allowed certain command prefixes")
        && normalized.includes("ONLY return the prefix.");
    }

    function extractPromptRealUsers(snapshot) {
      if (!snapshot || !Array.isArray(snapshot.messages)) return [];
      return snapshot.messages
        .filter(function (message) {
          return message && message.role === "user" && !message.toolResultOnly;
        })
        .map(function (message) {
          return {
            index: typeof message.index === "number" ? message.index : -1,
            text: String(typeof message.cleanedText === "string" ? message.cleanedText : message.text || "").trim()
          };
        })
        .filter(function (message) { return message.text.length > 0; });
    }

    function readPromptMaxTokens(snapshot) {
      if (!snapshot || typeof snapshot.rawRequestBody !== "string") return null;
      const match = snapshot.rawRequestBody.match(/"max_tokens"\\s*:\\s*(\\d+)/);
      if (!match) return null;
      const parsed = Number(match[1]);
      return Number.isFinite(parsed) ? parsed : null;
    }

    function inferRequestKindFromSnapshot(request) {
      const previewText = String(request.turnPreview || "").trim();
      const snapshot = request.promptSnapshot;
      const users = extractPromptRealUsers(snapshot);
      const latestUser = users[users.length - 1] || null;
      const latestText = latestUser ? latestUser.text : previewText;
      const maxTokens = readPromptMaxTokens(snapshot);
      if (maxTokens === 1 && latestText.toLowerCase() === "quota") {
        return "probe";
      }
      if (isPolicySpecText(latestText) || isPolicySpecText(previewText)) {
        return "continuation";
      }
      if (typeof request.requestKind === "string" && request.requestKind) {
        return request.requestKind;
      }
      if (latestText.startsWith("[SUGGESTION MODE:")) {
        return "suggestion_mode";
      }
      if (isCommandTranscriptText(latestText)) {
        return "continuation";
      }
      const systemText = snapshot && Array.isArray(snapshot.systemBlocks)
        ? snapshot.systemBlocks.map(function (block) { return String(block.text || ""); }).join("\\n")
        : "";
      if (systemText.includes("Analyze if this message indicates a new conversation topic.")) {
        return "topic_analysis";
      }
      const hasLaterMessages = snapshot
        && Array.isArray(snapshot.messages)
        && latestUser
        && latestUser.index >= 0
        && latestUser.index < snapshot.messages.length - 1;
      if (hasLaterMessages) {
        return "continuation";
      }
      return "user_turn";
    }

    function deriveTurnAnchorFromSnapshot(request) {
      const snapshot = request.promptSnapshot;
      const users = extractPromptRealUsers(snapshot);
      const latestUser = users[users.length - 1] || null;
      const previousUser = users.length > 1 ? users[users.length - 2] : null;
      const latestText = latestUser ? latestUser.text : "";
      const previousText = previousUser ? previousUser.text : "";
      const previewText = String(request.turnPreview || "").trim();
      if (request.requestKind === "probe") return "";
      if (isPolicySpecText(latestText) || isPolicySpecText(previewText)) {
        return previousText;
      }
      if (isCommandTranscriptText(latestText)) {
        return previousText || (isPolicySpecText(previewText) ? "" : previewText);
      }
      if (request.requestKind === "suggestion_mode") {
        return previousText || (isPolicySpecText(previewText) ? "" : previewText);
      }
      return latestText || previewText;
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

    function promptMessageMeta(message, contentOverride) {
      const meta = [];
      if (message && message.role) meta.push(String(message.role));
      if (Array.isArray(message && message.contentTypes) && message.contentTypes.length) {
        meta.push(message.contentTypes.join(", "));
      }
      const textValue = typeof contentOverride === "string"
        ? contentOverride
        : message && typeof message.text === "string"
          ? message.text
          : "";
      if (textValue) {
        meta.push(formatCharCount(textValue.length));
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
          const cleanedUserText = String(message && typeof message.cleanedText === "string" ? message.cleanedText : rawText).trim();
          if (cleanedUserText) {
            userIndex += 1;
            userItems.push({
              title: text.promptItemUserInput + " " + userIndex,
              meta: promptMessageMeta(message, cleanedUserText),
              content: cleanedUserText
            });
            return;
          }
        }

        if (message.toolResultOnly) {
          toolResultIndex += 1;
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
          extraItems.push({
            title: tagInfo.title,
            meta: promptMessageMeta(message),
            content: rawText
          });
          return;
        }

        assistantIndex += 1;
        extraItems.push({
          title: text.promptItemAssistantContext + " " + assistantIndex,
          meta: promptMessageMeta(message),
          content: rawText
        });
      });

      if (systemItems.length) {
        groups.push({
          kind: "system",
          title: text.promptGroupSystem,
          summary: formatCountSummary(systemItems.length, text.countBlocks),
          compareCount: systemItems.length,
          items: systemItems
        });
      }
      if (userItems.length) {
        groups.push({
          kind: "user",
          title: text.promptGroupUser,
          summary: formatCountSummary(userItems.length, text.countMessages),
          compareCount: userItems.length,
          items: userItems
        });
      }
      if (memoryItems.length) {
        const memoryCount = memoryEntries || memoryItems.length;
        groups.push({
          kind: "memory",
          title: text.promptGroupMemory,
          summary: formatCountSummary(memoryCount, text.countEntries),
          compareCount: memoryCount,
          items: memoryItems
        });
      }
      if (extraItems.length) {
        groups.push({
          kind: "runtime",
          title: text.promptGroupTags,
          summary: formatCountSummary(extraItems.length, text.countMessages),
          compareCount: extraItems.length,
          items: extraItems
        });
      }

      groups.sort(function (a, b) {
        const order = { user: 0, system: 1, memory: 2, runtime: 3 };
        return (order[a.kind] ?? 99) - (order[b.kind] ?? 99);
      });

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

    function toolInputObject(tool) {
      return tool && tool.input && typeof tool.input === "object" ? tool.input : {};
    }

    function detectPathKind(value) {
      const raw = String(value || "").toLowerCase();
      if (!raw) return "file";
      const fileName = raw.split("/").pop() || raw;
      if (
        fileName === "package.json"
        || fileName === "package-lock.json"
        || fileName === "pnpm-lock.yaml"
        || fileName === "yarn.lock"
        || fileName === "bun.lockb"
        || fileName === "tsconfig.json"
        || fileName === "jsconfig.json"
        || fileName === ".env"
        || fileName === ".env.local"
        || fileName === ".gitignore"
        || fileName === "dockerfile"
        || fileName === "docker-compose.yml"
        || fileName.endsWith(".config.js")
        || fileName.endsWith(".config.cjs")
        || fileName.endsWith(".config.mjs")
        || fileName.endsWith(".config.ts")
        || raw.includes("/.github/")
      ) {
        return "config";
      }
      if (fileName.endsWith(".ipynb")) return "notebook";
      if (
        fileName.endsWith(".md")
        || fileName.endsWith(".mdx")
        || fileName === "readme"
        || fileName === "readme.md"
        || fileName === "changelog.md"
        || fileName === "license"
        || fileName === "license.md"
        || raw.includes("/docs/")
      ) {
        return "docs";
      }
      return "file";
    }

    function detectPatternKind(value) {
      const raw = String(value || "").toLowerCase();
      if (!raw) return "generic";
      if (/\.(ts|tsx|js|jsx|py|rs|go|java|kt|swift|c|cpp|h|hpp)\b/.test(raw)) {
        return "source";
      }
      if (/\.(md|mdx|rst|txt)\b/.test(raw) || raw.includes("readme") || raw.includes("docs")) {
        return "docs";
      }
      return "generic";
    }

    function detectBashAction(command) {
      const raw = String(command || "").trim();
      const lower = raw.toLowerCase();
      if (!lower) return text.toolActionRunCommand;
      if (/(^|\s)git(\s|$)/.test(lower)) return text.toolActionGit;
      if (/(^|\s)(pytest|vitest|jest|mocha|ava|cargo test|go test|npm test|pnpm test|yarn test|bun test)(\s|$)/.test(lower)
        || /\b(npm|pnpm|yarn|bun)\s+run\s+test\b/.test(lower)) {
        return text.toolActionRunTests;
      }
      if (/\b(vite build|next build|tsc\b|cargo build|go build)\b/.test(lower)
        || /\b(npm|pnpm|yarn|bun)\s+(run\s+)?build\b/.test(lower)) {
        return text.toolActionBuildProject;
      }
      if (/\b(npm|pnpm|yarn|bun)\s+(install|add)\b/.test(lower)
        || /\b(pip|pip3|uv)\s+install\b/.test(lower)
        || /\bcargo add\b/.test(lower)
        || /\bgo get\b/.test(lower)) {
        return text.toolActionInstallDeps;
      }
      if (/\b(npm|pnpm|yarn|bun)\s+(run\s+)?dev\b/.test(lower)
        || /\b(npm|pnpm|yarn|bun)\s+start\b/.test(lower)
        || /\b(vite|next|uvicorn|python -m http\.server|serve)\b/.test(lower)) {
        return text.toolActionStartService;
      }
      if (/\b(ps|top|lsof|ss|netstat|status)\b/.test(lower)) {
        return text.toolActionCheckStatus;
      }
      if (/\b(find|fd|rg --files|rg\b|grep\b|glob\b)\b/.test(lower)) {
        return /\bwc -l\b/.test(lower) ? text.toolActionCountFiles : text.toolActionScanFiles;
      }
      return text.toolActionRunCommand;
    }

    function toolActionTitle(tool) {
      const name = String(tool && tool.name ? tool.name : "");
      const input = toolInputObject(tool);
      const pathKind = detectPathKind(input.file_path || input.path || input.notebook_path || "");
      if (name === "Read") {
        if (pathKind === "config") return text.toolActionReadConfig;
        if (pathKind === "docs") return text.toolActionReadDocs;
        return text.toolActionRead;
      }
      if (name === "NotebookRead") return text.toolActionReadNotebook;
      if (name === "Write") {
        if (pathKind === "config") return text.toolActionWriteConfig;
        if (pathKind === "docs") return text.toolActionWriteDocs;
        return text.toolActionWrite;
      }
      if (name === "Edit") {
        if (pathKind === "config") return text.toolActionEditConfig;
        if (pathKind === "docs") return text.toolActionEditDocs;
        return text.toolActionEdit;
      }
      if (name === "MultiEdit") return text.toolActionBatchEdit;
      if (name === "NotebookEdit") return text.toolActionEditNotebook;
      if (name === "LS") return text.toolActionBrowse;
      if (name === "Glob") {
        const patternKind = detectPatternKind(input.pattern || input.path || "");
        if (patternKind === "docs") return text.toolActionSearchDocs;
        if (patternKind === "source") return text.toolActionSearchSource;
        return text.toolActionSearchFiles;
      }
      if (name === "Grep") {
        const patternKind = detectPatternKind(input.glob || input.path || input.pattern || "");
        if (patternKind === "source") return text.toolActionSearchSource;
        return text.toolActionSearchContent;
      }
      if (name === "Bash") return detectBashAction(input.command || "");
      if (name === "WebSearch") return text.toolActionWebSearch;
      if (name === "WebFetch") return text.toolActionWebFetch;
      if (name === "Agent" || name === "Task") return text.toolActionAgent;
      if (name === "TodoWrite") return text.toolActionTodo;
      if (name === "AskUserQuestion") return text.toolActionAskUser;
      if (name === "Skill") return text.toolActionSkill;
      if (name === "ExitPlanMode") return text.toolActionPlanExit;
      if (/^mcp__/i.test(name)) {
        if (/^mcp__figma__/i.test(name)) return "Figma";
        if (/^mcp__playwright__/i.test(name)) return "Browser";
        return text.toolActionMcp;
      }
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
      if (name === "Agent" || name === "Task") {
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

    function toolBadgeLabel(tool) {
      const name = String(tool && tool.name ? tool.name : "Tool");
      if (/^mcp__/i.test(name)) return "MCP";
      return truncatePreview(name.toUpperCase(), 12);
    }

    function toolPanelKey(requestId, index) {
      return "tool:" + requestId + ":" + index;
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
      } else if (name === "Agent" || name === "Task") {
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

    function renderSummaryChip(value, tone, mono, tooltip) {
      return '<span class="summary-chip'
        + (tone ? ' is-' + tone : '')
        + (mono ? ' mono' : '')
        + (tooltip ? ' has-tooltip' : '')
        + '"'
        + (tooltip ? ' data-tooltip="' + escapeHtml(tooltip) + '"' : '')
        + '>' + value + '</span>';
    }

    function renderStatusSummaryChip(request) {
      const statusText = typeof request.status === "number"
        ? String(request.status)
        : request.state === "in_flight"
          ? text.inFlightBadge
          : request.state === "error"
            ? text.errorBadge
            : text.successBadge;
      const tone = request.state === "error"
        ? "error"
        : request.state === "in_flight"
          ? "warning"
          : "success";
      const iconMarkup = request.state === "error"
        ? closeIconMarkup
        : request.state === "in_flight"
          ? pendingIconMarkup
          : copiedIconMarkup;
      return '<span class="summary-chip is-icon is-' + tone + ' has-tooltip" data-tooltip="' + escapeHtml(text.statusCodeLabel + " " + statusText) + '"><span class="summary-chip-symbol" aria-hidden="true">' + iconMarkup + "</span></span>";
    }

    function applyDrawerSummary(request) {
      const tokenBreakdown = tokenBreakdownParts(request);
      elements.drawerRequestRoute.textContent = "";
      elements.drawerRequestRoute.title = "";
      elements.drawerSummaryModel.innerHTML = renderModelChip(request.model || "--", text.modelLabel + " " + (request.model || "--"));
      elements.drawerSummaryStatus.innerHTML = renderStatusSummaryChip(request);
      elements.drawerSummaryDuration.innerHTML = renderSummaryChip(
        escapeHtml(formatDuration(request.durationMs)),
        "",
        true,
        text.totalDurationLabel + " " + formatDuration(request.durationMs)
      );
      elements.drawerSummaryTokens.innerHTML = renderSummaryTokenMeter(request);
      elements.drawerSummaryTokens.title = tokenBreakdown.join(" · ");
    }

    function renderDetailRows(rows) {
      return rows.map(function (row) {
        return '<div class="detail-row">'
          + '<div class="detail-row-label">' + escapeHtml(row.label) + '</div>'
          + '<div class="detail-row-value' + (row.mono ? ' mono' : '') + '">' + escapeHtml(row.value) + '</div>'
          + '</div>';
      }).join("");
    }

    function summarizeTurns(requests) {
      const orderedRequests = requests.slice().sort(function (a, b) { return a.seq - b.seq; });
      const turns = [];
      const turnsById = new Map();
      let currentTurn = null;
      let visibleTurnSeq = 0;

      function attachRequest(turn, request) {
        turn.requests.push(request);
        if (new Date(request.startedAt).getTime() < new Date(turn.startedAt).getTime()) {
          turn.startedAt = request.startedAt;
        }
        const requestEndedAt = request.lastAt || request.startedAt;
        if (new Date(requestEndedAt).getTime() > new Date(turn.endedAt).getTime()) {
          turn.endedAt = requestEndedAt;
        }
        if (request.seq > turn.latestSeq) {
          turn.latestSeq = request.seq;
        }
      }

      function ensureExplicitTurn(request) {
        const explicitTurnId = typeof request.turnId === "string" && request.turnId.trim() ? request.turnId.trim() : "";
        if (!explicitTurnId) return null;

        let turn = turnsById.get(explicitTurnId) || null;
        const explicitTurnSeq = typeof request.turnSeq === "number" ? request.turnSeq : null;
        const preview = String(request.turnPreview || request.turnAnchor || "").trim() || text.turnFallbackPreview;

        if (!turn) {
          if (explicitTurnSeq !== null) {
            visibleTurnSeq = Math.max(visibleTurnSeq, explicitTurnSeq);
          }
          turn = {
            turnId: explicitTurnId,
            turnSeq: explicitTurnSeq !== null ? explicitTurnSeq : ++visibleTurnSeq,
            preview: preview,
            anchorText: String(request.turnPreview || request.turnAnchor || "").trim(),
            pendingStarter: false,
            requests: [],
            startedAt: request.startedAt,
            endedAt: request.lastAt || request.startedAt,
            latestSeq: request.seq,
          };
          turnsById.set(explicitTurnId, turn);
          turns.push(turn);
        } else {
          if (explicitTurnSeq !== null) {
            turn.turnSeq = explicitTurnSeq;
            visibleTurnSeq = Math.max(visibleTurnSeq, explicitTurnSeq);
          }
          if (preview && (!turn.preview || turn.preview === text.turnFallbackPreview)) {
            turn.preview = preview;
          }
        }

        return turn;
      }

      function findTurnByAnchor(anchorText) {
        if (!anchorText) return null;
        for (let index = turns.length - 1; index >= 0; index -= 1) {
          if (turns[index].anchorText === anchorText) {
            return turns[index];
          }
        }
        return null;
      }

      function findExistingExplicitTurn(request) {
        const explicitTurnId = typeof request.turnId === "string" && request.turnId.trim() ? request.turnId.trim() : "";
        return explicitTurnId ? (turnsById.get(explicitTurnId) || null) : null;
      }

      function isStarterRequest(kind) {
        return kind === "user_turn" || kind === "topic_analysis";
      }

      orderedRequests.forEach(function (request) {
        const requestKind = request.requestKind || "user_turn";
        const anchorText = String(request.turnAnchor || "").trim()
          || (isStarterRequest(requestKind) ? String(request.turnPreview || "").trim() : "");

        if (requestKind === "probe") {
          return;
        }

        if (isStarterRequest(requestKind)) {
          const explicitTurn = ensureExplicitTurn(request);
          if (explicitTurn) {
            attachRequest(explicitTurn, request);
            currentTurn = explicitTurn;
            return;
          }
        }

        const existingExplicitTurn = findExistingExplicitTurn(request);
        if (existingExplicitTurn) {
          attachRequest(existingExplicitTurn, request);
          currentTurn = existingExplicitTurn;
          if (requestKind !== "topic_analysis") {
            currentTurn.pendingStarter = false;
          }
          return;
        }

        if (requestKind === "suggestion_mode") {
          const targetTurn = currentTurn || findTurnByAnchor(anchorText) || turns[turns.length - 1] || null;
          if (targetTurn) {
            attachRequest(targetTurn, request);
            currentTurn = targetTurn;
            currentTurn.pendingStarter = false;
          }
          return;
        }

        const canReuseCurrentTurn = currentTurn
          && (
            (requestKind === "continuation" && !anchorText)
            || (anchorText && currentTurn.anchorText === anchorText && (requestKind === "continuation" || currentTurn.pendingStarter))
          );

        if (canReuseCurrentTurn) {
          attachRequest(currentTurn, request);
          if (requestKind !== "topic_analysis") {
            currentTurn.pendingStarter = false;
          }
          return;
        }

        const anchorTurn = findTurnByAnchor(anchorText);
        if (anchorTurn && (requestKind === "continuation" || requestKind === "suggestion_mode")) {
          attachRequest(anchorTurn, request);
          currentTurn = anchorTurn;
          currentTurn.pendingStarter = false;
          return;
        }

        visibleTurnSeq += 1;
        currentTurn = {
          turnId: "ui-turn:" + request.requestId,
          turnSeq: visibleTurnSeq,
          preview: anchorText || text.turnFallbackPreview,
          anchorText,
          pendingStarter: requestKind === "topic_analysis",
          requests: [],
          startedAt: request.startedAt,
          endedAt: request.lastAt || request.startedAt,
          latestSeq: request.seq,
        };
        turnsById.set(currentTurn.turnId, currentTurn);
        turns.push(currentTurn);
        attachRequest(currentTurn, request);
        if (requestKind !== "topic_analysis") {
          currentTurn.pendingStarter = false;
        }
      });

      return turns
        .map(function (turn) {
          turn.requests.sort(function (a, b) { return a.seq - b.seq; });
          const latestRequest = turn.requests[turn.requests.length - 1] || null;
          const usageTotals = aggregateRequestUsage(turn.requests);
          return {
            turnId: turn.turnId,
            turnSeq: turn.turnSeq,
            preview: turn.preview,
            requests: turn.requests,
            latestRequestId: latestRequest ? latestRequest.requestId : null,
            latestRequest: latestRequest,
            requestCount: turn.requests.length,
            usageTotals: usageTotals,
            state: latestRequest ? latestRequest.state : "completed",
            durationMs: new Date(turn.endedAt).getTime() - new Date(turn.startedAt).getTime(),
            latestSeq: turn.latestSeq,
          };
        })
        .sort(function (a, b) { return b.turnSeq - a.turnSeq; });
    }

    function currentSelectedTurn() {
      if (selectedTurnId) {
        const matchedTurn = latestState.turns.find(function (item) { return item.turnId === selectedTurnId; }) || null;
        if (matchedTurn) return matchedTurn;
      }
      if (selectedRequestId) {
        return latestState.turns.find(function (turn) {
          return turn.requests.some(function (item) { return item.requestId === selectedRequestId; });
        }) || null;
      }
      return null;
    }

    function currentSelectedRequest() {
      const selectedTurn = currentSelectedTurn();
      if (selectedTurn) {
        if (selectedRequestId) {
          const matchedRequest = selectedTurn.requests.find(function (item) { return item.requestId === selectedRequestId; });
          if (matchedRequest) return matchedRequest;
        }
        if (selectedTurn.latestRequestId) {
          return selectedTurn.requests.find(function (item) { return item.requestId === selectedTurn.latestRequestId; }) || null;
        }
      }
      return latestState.requests.find(function (item) { return item.requestId === selectedRequestId; }) || null;
    }

    function formatRailIndex(index) {
      var circled = ["❶", "❷", "❸", "❹", "❺", "❻", "❼", "❽", "❾", "❿", "⓫", "⓬", "⓭", "⓮", "⓯", "⓰", "⓱", "⓲", "⓳", "⓴"];
      return circled[index] || String(index + 1);
    }

    function requestHasToolResults(request) {
      const snapshot = request && request.promptSnapshot ? request.promptSnapshot : null;
      return Boolean(snapshot && Array.isArray(snapshot.messages) && snapshot.messages.some(function (message) {
        return message && message.toolResultOnly;
      }));
    }

    function requestTurnAnchorText(request) {
      return truncatePreview(deriveTurnAnchorFromSnapshot(request) || request.turnPreview || "", 48);
    }

    function requestIsConnectivityCheck(request) {
      const anchor = requestTurnAnchorText(request).toLowerCase();
      if (!anchor) return false;
      return anchor.length <= 24 && /(ni hao|nihao|hello|hi|test|测试|连通|ping)/i.test(anchor);
    }

    function toolPriority(tool) {
      const name = String(tool && tool.name ? tool.name : "");
      if (name === "Write" || name === "Edit" || name === "MultiEdit" || name === "NotebookEdit") return 90;
      if (name === "Bash") return 80;
      if (name === "Read" || name === "NotebookRead") return 70;
      if (name === "Grep" || name === "Glob" || name === "LS") return 60;
      if (name === "WebSearch" || name === "WebFetch") return 50;
      if (name === "Agent" || name === "Task") return 40;
      if (name === "TodoWrite" || name === "AskUserQuestion" || name === "Skill" || name === "ExitPlanMode") return 30;
      if (/^mcp__/i.test(name)) return 20;
      return 10;
    }

    function pickPrimaryTool(tools) {
      return (Array.isArray(tools) ? tools : []).slice().sort(function (a, b) {
        return toolPriority(b) - toolPriority(a);
      })[0] || null;
    }

    function railNodeLabel(request, index, total) {
      var tools = Array.isArray(request.toolCalls) ? request.toolCalls : [];
      if (tools.length) {
        const primaryTool = pickPrimaryTool(tools);
        return primaryTool ? toolActionTitle(primaryTool) : text.toolActionGeneric;
      }
      if (index === 0) {
        if (requestIsConnectivityCheck(request)) return text.railConnectivityCheck;
        return total > 1 ? text.railTaskStart : text.railUserInput;
      }
      if (index === total - 1) {
        return requestHasToolResults(request) ? text.railComposeAnswer : text.railFinalResponse;
      }
      if (requestHasToolResults(request)) {
        return text.railAnalyzeResults;
      }
      return text.railFinalResponse;
    }

    function railCacheInfo(request) {
      var cache = cacheUsageInfo(request);
      return {
        newTokens: cache.newTokens,
        cachedTokens: cache.cachedTokens,
        total: cache.totalPromptTokens,
        hitPct: cache.hitPct
      };
    }

    function railTooltipText(request) {
      const cache = railCacheInfo(request);
      const parts = [];
      if (cache.total > 0) {
        parts.push(text.newTokensLabel + " " + formatTokenCount(cache.newTokens));
        parts.push(text.sentTokensLabel + " " + formatTokenCount(cache.total));
        parts.push(text.cacheReadLabel + " " + formatTokenCount(cache.cachedTokens));
      }
      if (typeof request.outputTokens === "number") {
        parts.push(text.outputTokensLabel + " " + formatTokenCount(request.outputTokens));
      }
      return parts.join("\\n");
    }

    function renderTurnRail(turn) {
      if (!turn || !turn.requests.length) {
        elements.drawerTurnRail.innerHTML = "";
        return;
      }

      var parts = [];
      turn.requests.forEach(function (request, index) {
        if (index > 0) {
          parts.push('<div class="rail-connector"></div>');
        }
        var toneClass = request.state === "error"
          ? " is-error"
          : request.state === "in_flight"
            ? " is-in-flight"
            : "";
        var activeClass = request.requestId === selectedRequestId ? " is-active" : "";
        var label = railNodeLabel(request, index, turn.requests.length);
        var tooltip = railTooltipText(request);

        parts.push(
          '<button class="rail-node' + toneClass + activeClass + (tooltip ? ' has-tooltip is-left' : '') + '" type="button" data-request-id="' + escapeHtml(request.requestId) + '"'
          + (tooltip ? ' data-tooltip="' + escapeHtml(tooltip) + '"' : '')
          + '>'
          + '<div class="rail-node-head">'
          + '<span class="rail-node-seq">' + escapeHtml(formatRailIndex(index)) + '</span>'
          + '<span class="rail-node-label">' + escapeHtml(label) + '</span>'
          + '</div>'
          + '</button>'
        );
      });
      elements.drawerTurnRail.innerHTML = parts.join("");
    }

    function setCopyButtonState(button, isConfirmed) {
      button.innerHTML = isConfirmed ? copiedIconMarkup : copyIconMarkup;
      button.classList.toggle("is-confirmed", isConfirmed);
      button.title = isConfirmed ? text.copiedAction : text.copyAction;
      button.setAttribute("aria-label", isConfirmed ? text.copiedAction : text.copyAction);
    }

    function getDragOffset(target) {
      return {
        x: Number(target.dataset.dragX || "0"),
        y: Number(target.dataset.dragY || "0")
      };
    }

    function applyDragOffset(target, x, y) {
      target.dataset.dragX = String(x);
      target.dataset.dragY = String(y);
      target.style.setProperty("--drag-x", x + "px");
      target.style.setProperty("--drag-y", y + "px");
    }

    function clampDragOffset(target, x, y) {
      applyDragOffset(target, x, y);
      const rect = target.getBoundingClientRect();
      const margin = 12;
      let nextX = x;
      let nextY = y;

      if (rect.left < margin) nextX += margin - rect.left;
      if (rect.right > window.innerWidth - margin) nextX -= rect.right - (window.innerWidth - margin);
      if (rect.top < margin) nextY += margin - rect.top;
      if (rect.bottom > window.innerHeight - margin) nextY -= rect.bottom - (window.innerHeight - margin);

      applyDragOffset(target, nextX, nextY);
      return { x: nextX, y: nextY };
    }

    function bindFloatingDrag(handle, target) {
      let dragging = null;

      handle.addEventListener("pointerdown", function (event) {
        if (event.button !== 0) return;
        if (event.target.closest("button, a, input, textarea, select, summary")) return;
        const offset = getDragOffset(target);
        dragging = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          baseX: offset.x,
          baseY: offset.y,
          nextX: offset.x,
          nextY: offset.y,
          frame: 0
        };
        target.classList.add("is-dragging");
        handle.setPointerCapture(event.pointerId);
        event.preventDefault();
      });

      handle.addEventListener("pointermove", function (event) {
        if (!dragging || dragging.pointerId !== event.pointerId) return;
        dragging.nextX = dragging.baseX + (event.clientX - dragging.startX);
        dragging.nextY = dragging.baseY + (event.clientY - dragging.startY);
        if (!dragging.frame) {
          dragging.frame = requestAnimationFrame(function () {
            if (!dragging) return;
            applyDragOffset(target, dragging.nextX, dragging.nextY);
            dragging.frame = 0;
          });
        }
      });

      function finishDrag(event) {
        if (!dragging || dragging.pointerId !== event.pointerId) return;
        if (dragging.frame) {
          cancelAnimationFrame(dragging.frame);
          dragging.frame = 0;
        }
        clampDragOffset(target, dragging.nextX, dragging.nextY);
        target.classList.remove("is-dragging");
        dragging = null;
      }

      handle.addEventListener("pointerup", finishDrag);
      handle.addEventListener("pointercancel", finishDrag);
      handle.addEventListener("lostpointercapture", function () {
        target.classList.remove("is-dragging");
        dragging = null;
      });
    }

    function rectsOverlap(a, b) {
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }

    function detailDrawerRect() {
      return elements.detailDrawer.getBoundingClientRect();
    }

    function positionDetailRailPanel() {
      const drawerRect = detailDrawerRect();
      const railWidth = elements.detailRailPanel.offsetWidth || 220;
      const gap = 14;
      const margin = 12;
      const isCompact = window.innerWidth <= 900;
      const left = isCompact
        ? margin
        : Math.max(margin, drawerRect.left - railWidth - gap);
      const top = isCompact
        ? Math.max(margin, drawerRect.top + 94)
        : Math.max(margin, drawerRect.top + 118);
      elements.detailRailPanel.style.left = left + "px";
      elements.detailRailPanel.style.top = top + "px";
      applyDragOffset(elements.detailRailPanel, 0, 0);
      clampDragOffset(elements.detailRailPanel, 0, 0);
    }

    function findFloatingWindowPosition(windowElement, options) {
      const margin = 12;
      const gap = 14;
      const anchor = detailDrawerRect();
      const width = windowElement.offsetWidth || (options.wide ? 432 : 420);
      const height = windowElement.offsetHeight || 260;
      const preferredRight = Math.min(anchor.right + gap, window.innerWidth - margin - width);
      const preferredLeft = Math.max(margin, anchor.left - gap - width);
      const topBase = Math.max(margin, anchor.top + 96);
      const existingRects = Array.from(floatingWindows.values()).map(function (entry) {
        return entry.element.getBoundingClientRect();
      });

      function tryColumn(left) {
        let top = topBase;
        for (let guard = 0; guard < 32; guard += 1) {
          const candidate = {
            left: left,
            right: left + width,
            top: top,
            bottom: top + height
          };
          const blocking = existingRects.find(function (rect) {
            return rectsOverlap(candidate, {
              left: rect.left - gap,
              right: rect.right + gap,
              top: rect.top - gap,
              bottom: rect.bottom + gap
            });
          }) || null;

          if (!blocking && candidate.bottom <= window.innerHeight - margin) {
            return { left: candidate.left, top: candidate.top };
          }

          if (blocking) {
            top = blocking.bottom + gap;
            continue;
          }
          break;
        }
        return null;
      }

      const columns = [preferredRight];
      const secondRight = preferredRight + width + gap;
      if (secondRight + width <= window.innerWidth - margin) columns.push(secondRight);
      if (preferredLeft >= margin) columns.push(preferredLeft);

      for (const left of columns) {
        const hit = tryColumn(left);
        if (hit) return hit;
      }

      return {
        left: Math.max(margin, Math.min(preferredRight, window.innerWidth - margin - width)),
        top: Math.max(margin, Math.min(topBase, window.innerHeight - margin - height))
      };
    }

    function isFloatingWindowOpen(key) {
      return floatingWindows.has(key);
    }

    function bringFloatingWindowToFront(windowRecordOrKey) {
      const windowRecord = typeof windowRecordOrKey === "string"
        ? floatingWindows.get(windowRecordOrKey)
        : windowRecordOrKey;
      if (!windowRecord) return null;
      floatingWindowZ += 1;
      windowRecord.element.style.zIndex = String(floatingWindowZ);
      floatingWindows.forEach(function (entry) {
        entry.element.classList.toggle("is-active", entry === windowRecord);
      });
      return windowRecord;
    }

    function closeFloatingWindow(key) {
      const windowRecord = floatingWindows.get(key);
      if (!windowRecord) return;
      floatingWindows.delete(key);
      windowRecord.element.classList.remove("is-open");
      windowRecord.element.classList.remove("is-active");
      syncOverlayButtons();
      syncPromptItemSelection();
      syncAnswerItemSelection();
      syncToolCardSelection();
      const nextTopWindow = Array.from(floatingWindows.values()).sort(function (a, b) {
        return Number(b.element.style.zIndex || "0") - Number(a.element.style.zIndex || "0");
      })[0] || null;
      if (nextTopWindow) {
        bringFloatingWindowToFront(nextTopWindow);
      }
      setTimeout(function () {
        windowRecord.element.remove();
      }, 180);
    }

    function closeFloatingWindowsByFamily(family) {
      Array.from(floatingWindows.entries()).forEach(function (entry) {
        if (entry[1].family === family) {
          closeFloatingWindow(entry[0]);
        }
      });
    }

    function closeAllFloatingWindows() {
      Array.from(floatingWindows.keys()).forEach(function (key) {
        closeFloatingWindow(key);
      });
    }

    function closeTopFloatingWindow() {
      const topWindow = Array.from(floatingWindows.values()).sort(function (a, b) {
        return Number(b.element.style.zIndex || "0") - Number(a.element.style.zIndex || "0");
      })[0] || null;
      if (!topWindow) return false;
      closeFloatingWindow(topWindow.key);
      return true;
    }

    function createFloatingWindow(options) {
      const existing = floatingWindows.get(options.key) || null;
      if (existing) {
        if (options.toggleIfExists) {
          closeFloatingWindow(options.key);
          return null;
        }
        return bringFloatingWindowToFront(existing);
      }

      const windowElement = document.createElement("aside");
      windowElement.className = "floating-window" + (options.wide ? " is-wide" : "");
      windowElement.dataset.windowKey = options.key;
      windowElement.style.left = "-9999px";
      windowElement.style.top = "-9999px";

      const head = document.createElement("div");
      head.className = "floating-window-head";

      const copy = document.createElement("div");
      copy.className = "floating-window-copy";

      if (options.group) {
        const group = document.createElement("div");
        group.className = "floating-window-group";
        group.textContent = options.group;
        copy.appendChild(group);
      }

      const title = document.createElement("div");
      title.className = "floating-window-title" + (options.monoTitle ? " is-mono" : "");
      title.textContent = options.title || "--";
      copy.appendChild(title);

      if (options.meta) {
        const meta = document.createElement("div");
        meta.className = "floating-window-meta";
        meta.textContent = options.meta;
        copy.appendChild(meta);
      }

      const actions = document.createElement("div");
      actions.className = "floating-window-actions";

      let copyResetTimer = null;
      if (options.copyText) {
        const copyButton = document.createElement("button");
        copyButton.className = "icon-button";
        copyButton.type = "button";
        setCopyButtonState(copyButton, false);
        copyButton.addEventListener("click", async function () {
          try {
            await navigator.clipboard.writeText(options.copyText);
            if (copyResetTimer) clearTimeout(copyResetTimer);
            setCopyButtonState(copyButton, true);
            copyResetTimer = setTimeout(function () {
              setCopyButtonState(copyButton, false);
              copyResetTimer = null;
            }, 1200);
          } catch {
            setCopyButtonState(copyButton, false);
          }
        });
        actions.appendChild(copyButton);
      }

      const closeButton = document.createElement("button");
      closeButton.className = "icon-button";
      closeButton.type = "button";
      closeButton.title = text.closeAction;
      closeButton.setAttribute("aria-label", text.closeAction);
      closeButton.innerHTML = closeIconMarkup;
      closeButton.addEventListener("click", function () {
        closeFloatingWindow(options.key);
      });
      actions.appendChild(closeButton);

      head.appendChild(copy);
      head.appendChild(actions);

      const body = document.createElement("div");
      body.className = "floating-window-body";
      body.innerHTML = options.bodyHtml || '<div class="block-content">--</div>';

      windowElement.appendChild(head);
      windowElement.appendChild(body);
      elements.floatingWindowHost.appendChild(windowElement);

      const windowRecord = {
        key: options.key,
        family: options.family,
        element: windowElement
      };
      floatingWindows.set(options.key, windowRecord);

      bindFloatingDrag(head, windowElement);
      windowElement.addEventListener("pointerdown", function () {
        bringFloatingWindowToFront(windowRecord);
      });

      requestAnimationFrame(function () {
        const position = findFloatingWindowPosition(windowElement, options);
        windowElement.style.left = String(position.left) + "px";
        windowElement.style.top = String(position.top) + "px";
        clampDragOffset(windowElement, 0, 0);
        windowElement.classList.add("is-open");
        bringFloatingWindowToFront(windowRecord);
      });

      syncOverlayButtons();
      syncPromptItemSelection();
      syncToolCardSelection();
      return windowRecord;
    }

    function syncOverlayButtons() {
      elements.drawerMetadataButton.classList.toggle("is-active", isFloatingWindowOpen("overlay:metadata"));
      elements.drawerTransportButton.classList.toggle("is-active", isFloatingWindowOpen("overlay:transport"));
      elements.promptRawButton.classList.toggle("is-active", isFloatingWindowOpen("raw-info"));
    }

    function closeDrawerOverlay() {
      closeFloatingWindowsByFamily("overlay");
    }

    function openDrawerOverlay(kind) {
      const turn = currentSelectedTurn();
      const request = currentSelectedRequest();
      if (!request) return;

      let title = "";
      let body = "";
      let copyText = "";

      if (kind === "metadata") {
        title = text.metadata;
        body = renderDetailRows([
          { label: text.turnLabel, value: typeof (turn && turn.turnSeq) === "number" ? "#" + turn.turnSeq : "--", mono: true },
          { label: text.promptGroupUser, value: turn && turn.preview ? turn.preview : text.turnFallbackPreview, mono: false },
          { label: text.requestIdLabel, value: request.requestId, mono: true },
          { label: text.sequenceLabel, value: String(request.seq), mono: true },
          { label: text.terminalNodeLabel, value: runId, mono: true },
          { label: text.activeAgentLabel, value: text.mainAgent, mono: false },
          { label: text.totalDurationLabel, value: formatDuration(request.durationMs), mono: true },
          { label: text.timestampLabel, value: formatDateTime(request.startedAt), mono: true }
        ]);
      } else if (kind === "transport") {
        title = text.transportLayer;
        body = renderDetailRows([
          { label: text.methodLabel, value: request.method || "POST", mono: true },
          { label: text.endpointPathLabel, value: request.path || "/v1/messages", mono: true },
          { label: text.statusCodeLabel, value: request.status === null ? "--" : String(request.status), mono: true },
          { label: text.modelLabel, value: request.model || "--", mono: false },
          { label: text.usageLabel, value: formatTokenSummary(request), mono: true },
          { label: text.tableBytes, value: formatByteSummary(request), mono: true },
          { label: text.eventTypeLabel, value: formatEventType(request.lastEventType).main, mono: false },
          { label: text.tableStream, value: request.stream ? text.streamMode : text.bufferedMode, mono: false },
          { label: text.noteLabel, value: request.note || "--", mono: true }
        ]);
      } else {
        return;
      }

      createFloatingWindow({
        key: "overlay:" + kind,
        family: "overlay",
        group: "",
        title: title,
        meta: "",
        monoTitle: true,
        wide: true,
        copyText: copyText,
        bodyHtml: body,
        toggleIfExists: true
      });
    }

    async function fetchDashboardSettings() {
      const response = await fetch("/__melu/settings", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      return response.json();
    }

    function renderSettingsPanelBody(payload) {
      const languageOptions = Array.isArray(payload && payload.languageOptions) ? payload.languageOptions : [];
      const mirrorOptions = Array.isArray(payload && payload.mirrorOptions) ? payload.mirrorOptions : [];
      const currentLanguage = typeof (payload && payload.uiLanguage) === "string" ? payload.uiLanguage : "en";
      const memoryEnabled = payload && payload.memoryEnabled !== false;
      const autoOpenDashboard = payload && payload.autoOpenDashboard !== false;
      const modelDownloaded = Boolean(payload && payload.modelDownloaded);
      const currentMirror = typeof (payload && payload.mirror) === "string" ? payload.mirror : "";
      const memoryTooltip = text.settingsMemoryTooltip;
      const autoOpenTooltip = text.settingsAutoOpenTooltip;
      return '<div class="settings-stack">'
        + '<label class="settings-field">'
        + '<span class="settings-label">' + escapeHtml(text.settingsLanguageLabel) + '</span>'
        + '<select class="settings-select" data-settings-language>'
        + languageOptions.map(function (option) {
          const value = String(option && option.value ? option.value : "");
          const label = String(option && option.label ? option.label : value);
          return '<option value="' + escapeHtml(value) + '"' + (value === currentLanguage ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
        }).join("")
        + '</select>'
        + '</label>'
        + '<label class="settings-field">'
        + '<span class="settings-label">' + escapeHtml(text.settingsMirrorLabel) + '</span>'
        + '<select class="settings-select" data-settings-mirror>'
        + mirrorOptions.map(function (option) {
          const value = String(option && option.value ? option.value : "");
          const label = String(option && option.label ? option.label : value);
          return '<option value="' + escapeHtml(value) + '"' + (value === currentMirror ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
        }).join("")
        + '</select>'
        + '</label>'
        + '<div class="settings-card"><div class="settings-card-head">'
        + '<div class="settings-card-copy">'
        + '<div class="settings-card-title-row">'
        + '<div class="settings-card-title">' + escapeHtml(text.settingsMemoryLabel) + '</div>'
        + '<button class="settings-info has-tooltip" type="button" data-tooltip="' + escapeHtml(memoryTooltip) + '" aria-label="' + escapeHtml(text.settingsMemoryLabel) + '">i</button>'
        + '</div>'
        + '<div class="settings-card-meta">'
        + '<span class="settings-status-pill">' + escapeHtml(text.settingsNextRunBadge) + '</span>'
        + '<span class="settings-status-pill ' + (modelDownloaded ? 'is-ready' : 'is-pending') + '">' + escapeHtml(modelDownloaded ? text.settingsMemoryReady : text.settingsMemoryMissing) + '</span>'
        + '</div>'
        + '</div>'
        + '<label class="settings-switch">'
        + '<input type="checkbox" data-settings-memory' + (memoryEnabled ? ' checked' : '') + ' aria-label="' + escapeHtml(text.settingsMemoryLabel) + '" />'
        + '<span class="settings-switch-track" aria-hidden="true"></span>'
        + '</label>'
        + '</div></div>'
        + '<div class="settings-card"><div class="settings-card-head">'
        + '<div class="settings-card-copy">'
        + '<div class="settings-card-title-row">'
        + '<div class="settings-card-title">' + escapeHtml(text.settingsAutoOpenLabel) + '</div>'
        + '<button class="settings-info has-tooltip" type="button" data-tooltip="' + escapeHtml(autoOpenTooltip) + '" aria-label="' + escapeHtml(text.settingsAutoOpenLabel) + '">i</button>'
        + '</div>'
        + '<div class="settings-card-meta"><span class="settings-status-pill">' + escapeHtml(text.settingsNextRunBadge) + '</span></div>'
        + '</div>'
        + '<label class="settings-switch">'
        + '<input type="checkbox" data-settings-auto-open' + (autoOpenDashboard ? ' checked' : '') + ' aria-label="' + escapeHtml(text.settingsAutoOpenLabel) + '" />'
        + '<span class="settings-switch-track" aria-hidden="true"></span>'
        + '</label>'
        + '</div></div>'
        + '<div class="settings-actions"><button class="settings-save" type="button" data-settings-save>' + escapeHtml(text.settingsSaveAction) + '</button></div>'
        + '<div class="settings-feedback" data-settings-feedback></div>'
        + '</div>';
    }

    async function openSettingsPanel() {
      const existing = floatingWindows.get("settings");
      if (existing) {
        closeFloatingWindow("settings");
        return;
      }

      if (!settingsLoadPromise) {
        settingsLoadPromise = fetchDashboardSettings().finally(function () {
          settingsLoadPromise = null;
        });
      }

      try {
        const payload = await settingsLoadPromise;
        createFloatingWindow({
          key: "settings",
          family: "settings",
          group: "",
          title: text.settingsTitle,
          meta: "",
          bodyHtml: renderSettingsPanelBody(payload),
          toggleIfExists: true
        });
      } catch (error) {
        createFloatingWindow({
          key: "settings",
          family: "settings",
          group: "",
          title: text.settingsTitle,
          meta: "",
          bodyHtml: '<div class="block-content">' + escapeHtml(error instanceof Error ? error.message : String(error)) + '</div>',
          toggleIfExists: true
        });
      }
    }

    async function saveSettingsFromPanel(button) {
      const panel = button.closest(".floating-window");
      if (!panel) return;
      const languageSelect = panel.querySelector("[data-settings-language]");
      const mirrorSelect = panel.querySelector("[data-settings-mirror]");
      const memoryInput = panel.querySelector("[data-settings-memory]");
      const autoOpenInput = panel.querySelector("[data-settings-auto-open]");
      const feedback = panel.querySelector("[data-settings-feedback]");
      const payload = {
        uiLanguage: languageSelect ? languageSelect.value : "en",
        mirror: mirrorSelect ? mirrorSelect.value : null,
        memoryEnabled: Boolean(memoryInput && memoryInput.checked),
        autoOpenDashboard: Boolean(autoOpenInput && autoOpenInput.checked)
      };

      button.disabled = true;
      button.textContent = text.settingsSaving;
      if (feedback) feedback.textContent = "";

      try {
        const response = await fetch("/__melu/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          let message = "HTTP " + response.status;
          try {
            const errorPayload = await response.json();
            if (errorPayload && typeof errorPayload.error === "string") {
              message = errorPayload.error;
            }
          } catch {}
          throw new Error(message);
        }
        if (feedback) feedback.textContent = text.settingsSaved;
        setTimeout(function () {
          window.location.reload();
        }, 180);
      } catch (error) {
        button.disabled = false;
        button.textContent = text.settingsSaveAction;
        if (feedback) {
          feedback.textContent = error instanceof Error ? error.message : String(error);
        }
      }
    }

    function closePromptItemPanel() {
      closeFloatingWindowsByFamily("prompt");
      closeFloatingWindowsByFamily("answer");
      closeFloatingWindowsByFamily("raw");
    }

    function openPromptSidePanel(options) {
      const panelKind = options.kind || "prompt-item";
      const itemId = options.itemId || null;
      const family = options.family || (panelKind === "raw-info" ? "raw" : "prompt");
      const key = options.key || (panelKind === "raw-info" ? "raw-info" : family + ":" + itemId);
      createFloatingWindow({
        key: key,
        family: family,
        group: options.group || "",
        title: options.title || "--",
        meta: options.meta || "",
        monoTitle: panelKind === "raw-info",
        wide: panelKind === "raw-info",
        copyText: options.copyText || "",
        bodyHtml: options.body || '<div class="block-content">--</div>',
        toggleIfExists: panelKind === "raw-info"
      });
    }

    function openPromptItemPanel(itemId) {
      const item = promptItemRegistry.get(itemId);
      if (!item) return;
      openPromptSidePanel({
        kind: "prompt-item",
        itemId: itemId,
        family: "prompt",
        group: item.groupTitle || text.promptInsightTitle,
        title: item.title || "--",
        meta: item.meta || "",
        body: '<div class="block-content">' + escapeHtml(item.content || "--") + '</div>'
      });
    }

    function openAnswerItemPanel(itemId) {
      const item = answerItemRegistry.get(itemId);
      if (!item) return;
      openPromptSidePanel({
        kind: "answer-item",
        itemId: itemId,
        family: "answer",
        key: "answer:" + itemId,
        group: item.groupTitle || text.answerInsightTitle,
        title: item.title || "--",
        meta: item.meta || "",
        body: '<div class="block-content">' + escapeHtml(item.content || "--") + '</div>'
      });
    }

    function openRawInfoPanel() {
      const request = currentSelectedRequest();
      if (!request) return;
      const snapshot = request.promptSnapshot;
      const rawBody = snapshot && snapshot.rawRequestBody ? snapshot.rawRequestBody : "";
      const rawMeta = []
        .concat(request.method ? [request.method + " " + (request.path || "/v1/messages")] : [])
        .concat(rawBody ? [formatCharCount(rawBody.length)] : [])
        .join(" · ");

      openPromptSidePanel({
        kind: "raw-info",
        group: text.promptInsightTitle,
        title: text.rawPromptTitle,
        meta: rawMeta,
        copyText: rawBody,
        body: snapshot
          ? (snapshot.rawRequestTruncated ? '<div class="overlay-note">' + escapeHtml(text.rawPromptTruncatedNotice) + '</div>' : '')
            + '<pre class="raw-pre">' + escapeHtml(rawBody || "--") + '</pre>'
          : '<div class="insight-empty">' + escapeHtml(text.noPromptSnapshot) + '</div>'
      });
    }

    function openToolPanel(index) {
      const request = currentSelectedRequest();
      if (!request) return;
      const toolCalls = Array.isArray(request.toolCalls) ? request.toolCalls : [];
      const tool = toolCalls[index] || null;
      if (!tool) return;

      const nativeDescription = toolNativeDescription(tool);
      const keyFields = toolKeyFields(tool);
      const inputPayload = safeJson(tool.input);
      const rows = [];

      if (nativeDescription) {
        rows.push({ label: text.toolLabelDescription, value: nativeDescription, mono: false });
      }
      keyFields.forEach(function (entry) {
        rows.push({ label: entry[0], value: String(entry[1]), mono: false });
      });
      rows.push({ label: text.toolLabelOriginalName, value: tool.name || "--", mono: false });

      const meta = []
        .concat(toolActionSummary(tool) ? [toolActionSummary(tool)] : [])
        .concat([toolBadgeLabel(tool)])
        .join(" · ");

      createFloatingWindow({
        key: toolPanelKey(request.requestId, index),
        family: "tool",
        group: text.answerInsightTitle,
        title: toolActionTitle(tool),
        meta: meta,
        wide: true,
        copyText: inputPayload,
        bodyHtml: renderDetailRows(rows)
          + '<div class="raw-panel">'
          + '<div class="raw-note">' + escapeHtml(text.rawToolInputLabel) + '</div>'
          + '<pre class="raw-pre">' + escapeHtml(inputPayload || "--") + '</pre>'
          + '</div>',
        toggleIfExists: true
      });
    }

    function summarizeRequests(events) {
      const byRequest = new Map();

      events.forEach(function (event) {
        let entry = byRequest.get(event.requestId);
        if (!entry) {
          entry = {
            requestId: event.requestId,
            requestKind: typeof event.requestKind === "string" ? event.requestKind : "user_turn",
            turnId: typeof event.turnId === "string" ? event.turnId : null,
            turnSeq: typeof event.turnSeq === "number" ? event.turnSeq : null,
            turnPreview: typeof event.turnPreview === "string" ? event.turnPreview : null,
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
            cacheCreationTokens: typeof event.cacheCreationTokens === "number" ? event.cacheCreationTokens : null,
            cacheReadTokens: typeof event.cacheReadTokens === "number" ? event.cacheReadTokens : null,
            note: event.note || null,
            promptSnapshot: event.promptSnapshot || null,
            responseSnapshot: event.responseSnapshot || null,
            toolCalls: Array.isArray(event.toolCalls) ? event.toolCalls : [],
            lastEventType: event.type,
            state: "in_flight"
          };
          byRequest.set(event.requestId, entry);
        }

        entry.lastAt = event.timestamp;
        if (typeof event.requestKind === "string") entry.requestKind = event.requestKind;
        if (typeof event.turnId === "string") entry.turnId = event.turnId;
        if (typeof event.turnSeq === "number") entry.turnSeq = event.turnSeq;
        if (typeof event.turnPreview === "string" && event.turnPreview.trim()) entry.turnPreview = event.turnPreview;
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
        if (typeof event.cacheCreationTokens === "number") entry.cacheCreationTokens = event.cacheCreationTokens;
        if (typeof event.cacheReadTokens === "number") entry.cacheReadTokens = event.cacheReadTokens;
        if (event.note) entry.note = event.note;
        if (event.promptSnapshot) entry.promptSnapshot = event.promptSnapshot;
        if (event.responseSnapshot) entry.responseSnapshot = event.responseSnapshot;
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

      return Array.from(byRequest.values())
        .map(function (entry) {
          entry.requestKind = inferRequestKindFromSnapshot(entry);
          entry.turnAnchor = deriveTurnAnchorFromSnapshot(entry);
          return entry;
        })
        .sort(function (a, b) { return b.seq - a.seq; });
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
      const totalCacheCreationTokens = requests.reduce(function (sum, request) {
        return sum + (typeof request.cacheCreationTokens === "number" ? request.cacheCreationTokens : 0);
      }, 0);
      const totalCacheReadTokens = requests.reduce(function (sum, request) {
        return sum + (typeof request.cacheReadTokens === "number" ? request.cacheReadTokens : 0);
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
        totalTokens: totalInputTokens + totalOutputTokens + totalCacheCreationTokens + totalCacheReadTokens,
        totalCacheCreationTokens: totalCacheCreationTokens,
        totalCacheReadTokens: totalCacheReadTokens,
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

    function applyFilters(turns) {
      const normalizedSearch = searchTerm.trim().toLowerCase();
      return turns.filter(function (turn) {
        if (activeFilter !== "all" && turn.state !== activeFilter) return false;
        if (!normalizedSearch) return true;
        return String(turn.turnSeq || "").includes(normalizedSearch)
          || String(turn.preview || "").toLowerCase().includes(normalizedSearch)
          || String(turn.latestRequestId || "").toLowerCase().includes(normalizedSearch);
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
      if (!isOffline && stats.inFlight > 0) {
        elements.sessionInflightIndicator.hidden = false;
        elements.sessionInflightIndicator.textContent = text.inFlight + " " + stats.inFlight;
        elements.sessionInflightIndicator.classList.add("is-visible");
      } else {
        elements.sessionInflightIndicator.hidden = true;
        elements.sessionInflightIndicator.textContent = "";
        elements.sessionInflightIndicator.classList.remove("is-visible");
      }

      if (stats.highTraffic) {
        elements.trafficWarning.classList.add("is-visible");
      } else {
        elements.trafficWarning.classList.remove("is-visible");
      }

      elements.emptyTracePath.textContent = text.traceFileLabel + ": " + tracePath;
      elements.footerPath.textContent = text.footerPath + ": " + tracePath;
      elements.footerPath.href = traceFileHref;
      elements.footerPath.title = text.openTraceAction;
    }

    function renderCards(stats) {
      var totalNewTokens = stats.totalInputTokens + stats.totalCacheCreationTokens;
      var totalPromptTokens = totalNewTokens + stats.totalCacheReadTokens;
      var hitPct = totalPromptTokens > 0 ? Math.round((stats.totalCacheReadTokens / totalPromptTokens) * 100) : 0;
      elements.cardTotal.textContent = String(stats.totalRequests);
      elements.cardUp.textContent = text.uploadLabel + " " + stats.uploadEvents;
      elements.cardDown.textContent = text.receiveLabel + " " + stats.receiveStartEvents;
      elements.cardSuccessRate.textContent = stats.successRate === null ? "--" : stats.successRate + "%";
      elements.cardSuccessCount.textContent = text.completedBadge + ": " + stats.completed;
      elements.cardErrorCount.textContent = text.errorBadge + ": " + stats.failed;
      elements.cardLatency.textContent = stats.totalTokens ? formatTokenCount(stats.totalTokens) : "--";
      elements.cardInputTokens.innerHTML = '<span>' + escapeHtml(totalPromptTokens ? text.newTokensLabel : text.inputTokensLabel) + '</span><strong>' + escapeHtml(formatTokenCount(totalPromptTokens ? totalNewTokens : stats.totalInputTokens)) + '</strong>';
      elements.cardOutputTokens.innerHTML = stats.totalCacheReadTokens > 0 || stats.totalCacheCreationTokens > 0
        ? '<span>' + escapeHtml(text.cachedTokensLabel + " · " + hitPct + "% " + text.cacheHitLabel) + '</span><strong>' + escapeHtml(formatTokenCount(stats.totalCacheReadTokens)) + '</strong>'
        : '<span>' + escapeHtml(text.outputTokensLabel) + '</span><strong>' + escapeHtml(formatTokenCount(stats.totalOutputTokens)) + '</strong>';
    }

    function renderTimeline(requests) {
      const recent = requests.slice()
        .sort(function (a, b) {
          return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
        })
        .slice(-48);

      if (!recent.length) {
        elements.timelineMeta.textContent = text.timelineLegend;
        elements.timelineBars.innerHTML = '<div class="timeline-empty">' + escapeHtml(text.noRequestsFound) + '</div>';
        return;
      }

      const startMs = recent.reduce(function (minValue, request) {
        return Math.min(minValue, new Date(request.startedAt).getTime());
      }, Number.POSITIVE_INFINITY);
      const endMs = recent.reduce(function (maxValue, request) {
        const requestEnd = request.lastAt ? new Date(request.lastAt).getTime() : new Date(request.startedAt).getTime();
        return Math.max(maxValue, requestEnd);
      }, 0);
      const safeStartMs = Number.isFinite(startMs) ? startMs : Date.now();
      const safeEndMs = Math.max(safeStartMs, endMs);
      const spanMs = Math.max(1000, safeEndMs - safeStartMs);
      const maxDuration = recent.reduce(function (maxValue, request) {
        const duration = typeof request.durationMs === "number" ? request.durationMs : 400;
        return Math.max(maxValue, duration);
      }, 400);
      const gridLines = [0, 25, 50, 75, 100].map(function (percent) {
        return '<span class="timeline-grid-line" style="left:' + percent + '%"></span>';
      }).join("");
      const bars = recent.map(function (request) {
        const duration = typeof request.durationMs === "number" ? request.durationMs : 320;
        const height = Math.max(22, Math.round((duration / maxDuration) * 130));
        const tone = modelTone(request.model);
        const stateClass = request.state === "error" ? " is-error" : request.state === "in_flight" ? " is-in-flight" : "";
        const startedAtMs = new Date(request.startedAt).getTime();
        const leftPct = spanMs <= 0 ? 50 : ((startedAtMs - safeStartMs) / spanMs) * 100;
        const clampedLeftPct = Math.min(99.2, Math.max(0.8, leftPct));
        const title = [
          request.requestId,
          formatTime(request.startedAt),
          formatDuration(request.durationMs)
        ].join(" · ");
        return '<button class="timeline-bar ' + tone + stateClass + '" style="left:' + clampedLeftPct + '%;height:' + height + 'px" data-request-id="' + escapeHtml(request.requestId) + '" title="' + escapeHtml(title) + '"></button>';
      }).join("");
      elements.timelineMeta.textContent = formatTime(new Date(safeStartMs).toISOString()) + " -> " + formatTime(new Date(safeEndMs).toISOString()) + " · " + recent.length + " " + text.timelineRequestUnit + " · " + text.timelineLegend;
      elements.timelineBars.innerHTML = '<div class="timeline-stage">'
        + gridLines
        + '<div class="timeline-baseline"></div>'
        + bars
        + '</div>'
        + '<div class="timeline-axis">'
        + '<span class="timeline-axis-label">' + escapeHtml(formatTime(new Date(safeStartMs).toISOString())) + '</span>'
        + '<span class="timeline-axis-label">' + escapeHtml(formatTime(new Date(safeEndMs).toISOString())) + '</span>'
        + '</div>';
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

    function renderTurnUsageCell(turn, maxPromptTokens) {
      const usageTotals = turn.usageTotals || aggregateRequestUsage(turn.requests);
      const hasPromptTokens = usageTotals.promptTokens > 0;
      const tokenWidth = hasPromptTokens
        ? Math.max(6, Math.round((usageTotals.promptTokens / maxPromptTokens) * 100))
        : 0;
      const tokenPrimary = hasPromptTokens
        ? (usageTotals.newTokens > 0 ? "+" + formatTokenCount(usageTotals.newTokens) : "0")
        : usageTotals.totalTokens > 0
          ? formatTokenCount(usageTotals.totalTokens)
          : "--";
      const tokenMeta = hasPromptTokens
        ? formatTokenCount(usageTotals.promptTokens) + " " + text.sentTokensLabel + " · " + usageTotals.hitPct + "% " + text.cacheHitLabel
        : usageTotals.outputTokens > 0
          ? formatTokenCount(usageTotals.outputTokens) + " " + text.outputTokensLabel
          : "--";
      const tokenTooltipParts = [];
      if (hasPromptTokens) {
        tokenTooltipParts.push(text.newTokensLabel + " " + formatTokenCount(usageTotals.newTokens));
        tokenTooltipParts.push(text.sentTokensLabel + " " + formatTokenCount(usageTotals.promptTokens));
        tokenTooltipParts.push(text.cachedTokensLabel + " " + formatTokenCount(usageTotals.cachedTokens));
      }
      if (usageTotals.outputTokens > 0) {
        tokenTooltipParts.push(text.outputTokensLabel + " " + formatTokenCount(usageTotals.outputTokens));
      }
      const tokenTooltip = tokenTooltipParts.join(" · ");

      return '<div class="duration-cell' + (tokenTooltip ? ' has-tooltip' : '') + '"'
        + (tokenTooltip ? ' data-tooltip="' + escapeHtml(tokenTooltip) + '"' : '')
        + '><span class="duration-text mono">' + escapeHtml(tokenPrimary) + '</span>'
        + '<span class="table-subtle">' + escapeHtml(tokenMeta) + '</span>'
        + (hasPromptTokens
          ? '<span class="duration-track"><span class="table-token-fill" style="width:' + tokenWidth + '%">'
            + renderTokenMeterBar({
              totalPromptTokens: usageTotals.promptTokens,
              newTokens: usageTotals.newTokens,
              cachedTokens: usageTotals.cachedTokens
            }, "token-meter-bar")
            + '</span></span>'
          : '')
        + '</div>';
    }

    function renderTable(turns) {
      if (!turns.length) {
        elements.requestTableBody.innerHTML = '<tr><td colspan="5" style="padding:28px 20px;color:var(--muted);text-align:center;">' + escapeHtml(text.noRequestsFound) + '</td></tr>';
        return;
      }

      const maxDuration = turns.reduce(function (maxValue, turn) {
        return Math.max(maxValue, typeof turn.durationMs === "number" ? turn.durationMs : 0);
      }, 0) || 1;
      const maxPromptTokens = turns.reduce(function (maxValue, turn) {
        const promptTokens = turn.usageTotals && typeof turn.usageTotals.promptTokens === "number"
          ? turn.usageTotals.promptTokens
          : 0;
        return Math.max(maxValue, promptTokens);
      }, 0) || 1;

      elements.requestTableBody.innerHTML = turns.map(function (turn) {
        const selected = turn.turnId === selectedTurnId ? " is-selected" : "";
        const hasDuration = typeof turn.durationMs === "number";
        const durationWidth = hasDuration
          ? Math.max(6, Math.round((turn.durationMs / maxDuration) * 100))
          : 0;
        const durationClass = turn.state === "error"
          ? " is-error"
          : turn.state === "in_flight"
            ? " is-in-flight"
            : "";
        const turnLabel = typeof turn.turnSeq === "number" ? "#" + turn.turnSeq : "--";
        return '<tr class="request-row' + selected + '" data-turn-id="' + escapeHtml(turn.turnId) + '">'
          + '<td><div class="seq-stack"><div class="mono">' + escapeHtml(turnLabel) + '</div></div></td>'
          + '<td><div class="turn-prompt">' + escapeHtml(turn.preview || text.turnFallbackPreview) + '</div></td>'
          + '<td>' + statusBadge(turn) + '</td>'
          + '<td class="request-token-cell">' + renderTurnUsageCell(turn, maxPromptTokens) + '</td>'
          + '<td><div class="duration-cell"><span class="duration-text mono">' + escapeHtml(formatDuration(turn.durationMs)) + '</span><span class="duration-track"><span class="duration-bar' + durationClass + '" style="width:' + durationWidth + '%"></span></span></div></td>'
          + '</tr>';
      }).join("");
    }

    function renderNestedPromptItem(item, itemId, index) {
      const isActive = isFloatingWindowOpen("prompt:" + itemId) ? " is-active" : "";
      return '<button class="prompt-item-card' + isActive + '" type="button" data-prompt-item="' + escapeHtml(itemId) + '">'
        + '<div class="prompt-item-card-main"><div class="accordion-title">'
        + escapeHtml(item.title || ("Block " + (index + 1)))
        + '</div><div class="accordion-note">' + escapeHtml(truncatePreview(item.content || "--", 80)) + '</div></div>'
        + '<span class="prompt-item-card-mark" aria-hidden="true">+</span>'
        + '</button>';
    }

    function promptGroupItemSignature(item) {
      return JSON.stringify([
        item && typeof item.title === "string" ? item.title : "",
        item && typeof item.meta === "string" ? item.meta : "",
        item && typeof item.content === "string" ? item.content : "",
      ]);
    }

    function buildPromptGroupCompareMap(groups) {
      const counts = {};
      groups.forEach(function (group) {
        const items = Array.isArray(group.items) ? group.items : [];
        counts[group.kind] = {
          compareCount: typeof group.compareCount === "number"
          ? group.compareCount
          : Array.isArray(group.items)
            ? group.items.length
            : 0,
          itemSignatures: items.map(promptGroupItemSignature)
        };
      });
      return counts;
    }

    function estimatePromptGroupChangeCount(currentItems, previousItems) {
      const maxLength = Math.max(currentItems.length, previousItems.length);
      let changed = 0;
      for (let index = 0; index < maxLength; index += 1) {
        if (currentItems[index] !== previousItems[index]) {
          changed += 1;
        }
      }
      return changed;
    }

    function isPromptGroupAppendOnlyChange(currentItems, previousItems) {
      if (currentItems.length < previousItems.length) return false;
      for (let index = 0; index < previousItems.length; index += 1) {
        if (currentItems[index] !== previousItems[index]) {
          return false;
        }
      }
      return true;
    }

    function renderPromptGroupDelta(group, baselineCompareMap) {
      if (!baselineCompareMap) return "";
      const currentCount = typeof group.compareCount === "number"
        ? group.compareCount
        : Array.isArray(group.items)
          ? group.items.length
          : 0;
      const currentItems = Array.isArray(group.items) ? group.items.map(promptGroupItemSignature) : [];
      const previousEntry = baselineCompareMap[group.kind] || null;
      if (!previousEntry) {
        if (currentCount <= 0) return "";
        return '<span class="accordion-delta is-new">+' + escapeHtml(String(currentCount)) + " " + escapeHtml(text.deltaNew) + '</span>';
      }
      const previousCount = typeof previousEntry.compareCount === "number" ? previousEntry.compareCount : 0;
      const previousItems = Array.isArray(previousEntry.itemSignatures) ? previousEntry.itemSignatures : [];
      if (currentItems.join("\u241f") === previousItems.join("\u241f")) {
        return '<span class="accordion-delta is-same">' + escapeHtml(text.deltaSame) + '</span>';
      }
      if (currentCount > previousCount && isPromptGroupAppendOnlyChange(currentItems, previousItems)) {
        return '<span class="accordion-delta is-new">+' + escapeHtml(String(currentCount - previousCount)) + " " + escapeHtml(text.deltaNew) + '</span>';
      }
      const changedCount = Math.max(1, estimatePromptGroupChangeCount(currentItems, previousItems));
      return '<span class="accordion-delta is-changed">' + escapeHtml(String(changedCount) + " " + text.deltaChanged) + '</span>';
    }

    function responseBlockMeta(block) {
      const meta = [];
      if (block && block.type) meta.push(String(block.type));
      if (block && block.name) meta.push(String(block.name));
      if (block && typeof block.text === "string" && block.text) {
        meta.push(formatCharCount(block.text.length));
      }
      return meta.join(" · ");
    }

    function renderNestedAnswerItem(item, itemId, index) {
      const isActive = isFloatingWindowOpen("answer:" + itemId) ? " is-active" : "";
      return '<button class="prompt-item-card' + isActive + '" type="button" data-answer-item="' + escapeHtml(itemId) + '">'
        + '<div class="prompt-item-card-main"><div class="accordion-title">'
        + escapeHtml(item.title || ("Block " + (index + 1)))
        + '</div><div class="accordion-note">' + escapeHtml(truncatePreview(item.content || "--", 80)) + '</div></div>'
        + '<span class="prompt-item-card-mark" aria-hidden="true">+</span>'
        + '</button>';
    }

    function renderToolCards(request) {
      const toolCalls = Array.isArray(request.toolCalls) ? request.toolCalls : [];
      return toolCalls.map(function (tool, index) {
        const cardKey = toolPanelKey(request.requestId, index);
        const isActive = isFloatingWindowOpen(cardKey) ? " is-active" : "";
        return '<button class="tool-card' + isActive + '" type="button" data-tool-index="' + escapeHtml(String(index)) + '">'
          + '<div class="tool-card-main">'
          + '<div class="tool-card-head">'
          + '<div class="tool-card-title">' + escapeHtml(toolActionTitle(tool)) + '</div>'
          + '</div>'
          + '<div class="tool-card-note">' + escapeHtml(toolActionSummary(tool)) + '</div>'
          + '</div>'
          + '<div class="tool-card-side">'
          + '<span class="tool-card-badge">' + escapeHtml(toolBadgeLabel(tool)) + '</span>'
          + '<span class="tool-card-mark" aria-hidden="true">+</span>'
          + '</div>'
          + '</button>';
      }).join("");
    }

    function buildAnswerGroups(request) {
      const groups = [];
      const snapshot = request && request.responseSnapshot ? request.responseSnapshot : null;
      const blocks = snapshot && Array.isArray(snapshot.blocks) ? snapshot.blocks : [];
      const replyItems = [];
      const thinkingItems = [];
      const toolCalls = Array.isArray(request && request.toolCalls) ? request.toolCalls : [];
      let replyIndex = 0;
      let thinkingIndex = 0;

      blocks.forEach(function (block) {
        const rawText = String(block && typeof block.text === "string" ? block.text : "").trim();
        if (block.type === "text" && rawText) {
          replyIndex += 1;
          replyItems.push({
            title: text.answerItemReply + " " + replyIndex,
            meta: responseBlockMeta(block),
            content: rawText
          });
          return;
        }
        if ((block.type === "thinking" || block.type === "redacted_thinking") && rawText) {
          thinkingIndex += 1;
          thinkingItems.push({
            title: text.answerItemThinking + " " + thinkingIndex,
            meta: responseBlockMeta(block),
            content: rawText
          });
        }
      });

      if (replyItems.length) {
        groups.push({
          kind: "reply",
          title: text.answerGroupReply,
          summary: formatCountSummary(replyItems.length, text.countMessages),
          items: replyItems
        });
      }
      if (toolCalls.length) {
        groups.push({
          kind: "tools",
          title: text.answerGroupTools,
          summary: formatCountSummary(toolCalls.length, text.countEntries),
          tools: toolCalls
        });
      }
      if (thinkingItems.length) {
        groups.push({
          kind: "thinking",
          title: text.answerGroupThinking,
          summary: formatCountSummary(thinkingItems.length, text.countMessages),
          items: thinkingItems
        });
      }

      return groups;
    }

    function syncPromptItemSelection() {
      const buttons = elements.drawerPromptStructure.querySelectorAll("button[data-prompt-item]");
      buttons.forEach(function (button) {
        button.classList.toggle("is-active", isFloatingWindowOpen("prompt:" + button.getAttribute("data-prompt-item")));
      });
    }

    function syncAnswerItemSelection() {
      const buttons = elements.drawerAnswerStructure.querySelectorAll("button[data-answer-item]");
      buttons.forEach(function (button) {
        button.classList.toggle("is-active", isFloatingWindowOpen("answer:" + button.getAttribute("data-answer-item")));
      });
    }

    function syncToolCardSelection() {
      const request = currentSelectedRequest();
      const buttons = elements.drawerAnswerStructure.querySelectorAll("button[data-tool-index]");
      buttons.forEach(function (button) {
        const toolIndex = button.getAttribute("data-tool-index");
        const key = request ? toolPanelKey(request.requestId, Number(toolIndex)) : "";
        button.classList.toggle("is-active", key ? isFloatingWindowOpen(key) : false);
      });
    }

    function renderPromptStructure(request) {
      promptItemRegistry = new Map();
      if (!request) {
        elements.drawerPromptStructure.innerHTML = '<div class="insight-empty">' + escapeHtml(text.noPromptSnapshot) + '</div>';
        return;
      }
      const snapshot = request.promptSnapshot;
      if (!snapshot) {
        elements.drawerPromptStructure.innerHTML = '<div class="insight-empty">' + escapeHtml(text.noPromptSnapshot) + '</div>';
        return;
      }

      const groups = buildPromptGroups(snapshot);
      const turn = currentSelectedTurn();
      const baselineRequest = turn && Array.isArray(turn.requests) ? turn.requests[0] || null : null;
      const baselineGroups = baselineRequest && baselineRequest.requestId !== request.requestId && baselineRequest.promptSnapshot
        ? buildPromptGroups(baselineRequest.promptSnapshot)
        : null;
      const baselineCompareMap = baselineGroups ? buildPromptGroupCompareMap(baselineGroups) : null;
      if (!groups.length) {
        elements.drawerPromptStructure.innerHTML = '<div class="insight-empty">' + escapeHtml(text.noPromptSnapshot) + '</div>';
      } else {
        elements.drawerPromptStructure.innerHTML = groups.map(function (group, groupIndex) {
          const deltaHtml = renderPromptGroupDelta(group, baselineCompareMap);
          return '<details class="accordion-group group-' + escapeHtml(group.kind || "generic") + '">'
            + '<summary><div class="accordion-summary">'
            + '<div class="accordion-title-wrap">'
            + '<div class="accordion-title">' + escapeHtml(group.title) + '</div>'
            + '</div>'
            + '<div class="accordion-summary-side">'
            + '<span class="accordion-badge">' + escapeHtml(group.summary) + '</span>'
            + deltaHtml
            + '</div>'
            + '</div></summary>'
            + '<div class="accordion-body"><div class="nested-list">'
            + group.items.map(function (item, index) {
              const itemId = "prompt-item-" + groupIndex + "-" + index;
              promptItemRegistry.set(itemId, {
                groupTitle: group.title,
                title: item.title,
                meta: item.meta,
                content: item.content,
              });
              return renderNestedPromptItem(item, itemId, index);
            }).join("")
            + '</div></div>'
            + '</details>';
        }).join("");
      }

      syncPromptItemSelection();

    }

    function renderAnswerStructure(request) {
      answerItemRegistry = new Map();
      const groups = buildAnswerGroups(request);
      if (!groups.length) {
        elements.drawerAnswerStructure.innerHTML = '<div class="tool-empty">' + escapeHtml(text.noAnswerSnapshot) + '</div>';
        return;
      }

      elements.drawerAnswerStructure.innerHTML = groups.map(function (group, groupIndex) {
        if (group.kind === "tools") {
          return '<details class="accordion-group group-answer-tools">'
            + '<summary><div class="accordion-summary">'
            + '<div class="accordion-title-wrap"><div class="accordion-title">' + escapeHtml(group.title) + '</div></div>'
            + '<div class="accordion-summary-side"><span class="accordion-badge">' + escapeHtml(group.summary) + '</span></div>'
            + '</div></summary>'
            + '<div class="accordion-body"><div class="tool-stack">'
            + renderToolCards(request)
            + '</div></div>'
            + '</details>';
        }

        return '<details class="accordion-group group-answer">'
          + '<summary><div class="accordion-summary">'
          + '<div class="accordion-title-wrap"><div class="accordion-title">' + escapeHtml(group.title) + '</div></div>'
          + '<div class="accordion-summary-side"><span class="accordion-badge">' + escapeHtml(group.summary) + '</span></div>'
          + '</div></summary>'
          + '<div class="accordion-body"><div class="nested-list">'
          + group.items.map(function (item, index) {
            const itemId = "answer-item-" + groupIndex + "-" + index;
            answerItemRegistry.set(itemId, {
              groupTitle: group.title,
              title: item.title,
              meta: item.meta,
              content: item.content,
            });
            return renderNestedAnswerItem(item, itemId, index);
          }).join("")
          + '</div></div>'
          + '</details>';
      }).join("");

      syncAnswerItemSelection();
      syncToolCardSelection();
    }

    function openDrawer() {
      const turn = currentSelectedTurn();
      const request = currentSelectedRequest();
      if (!turn || !request) {
        closeDrawer(false);
        return;
      }
      selectedTurnId = turn.turnId;
      selectedRequestId = request.requestId;

      const turnLabel = typeof turn.turnSeq === "number" ? "#" + turn.turnSeq : "--";
      elements.drawerRequestTitle.textContent = text.turnLabel + " " + turnLabel;
      applyDrawerSummary(request);
      renderTurnRail(turn);
      elements.promptRawButton.disabled = !request.promptSnapshot;
      renderPromptStructure(request);
      renderAnswerStructure(request);
      closeAllFloatingWindows();

      elements.drawerBackdrop.hidden = false;
      const wasRailHidden = elements.detailRailPanel.hidden;
      elements.detailRailPanel.hidden = false;
      elements.detailCluster.hidden = false;
      requestAnimationFrame(function () {
        const drawerOffset = getDragOffset(elements.detailDrawer);
        clampDragOffset(elements.detailDrawer, drawerOffset.x, drawerOffset.y);
        if (wasRailHidden) {
          positionDetailRailPanel();
        } else {
          const railOffset = getDragOffset(elements.detailRailPanel);
          clampDragOffset(elements.detailRailPanel, railOffset.x, railOffset.y);
        }
        elements.drawerBackdrop.classList.add("is-open");
        elements.detailCluster.classList.add("is-open");
      });
    }

    function closeDrawer(clearSelection) {
      if (clearSelection !== false) {
        selectedTurnId = null;
        selectedRequestId = null;
      }
      closeAllFloatingWindows();
      elements.drawerBackdrop.classList.remove("is-open");
      elements.detailCluster.classList.remove("is-open");
      setTimeout(function () {
        if (!elements.detailCluster.classList.contains("is-open")) {
          elements.drawerBackdrop.hidden = true;
          elements.detailCluster.hidden = true;
          elements.detailRailPanel.hidden = true;
        }
      }, 220);
      if (latestState.turns.length) {
        renderTable(applyFilters(latestState.turns));
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
      if (!latestState.turns.length) return;
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

      if (!latestState.turns.length) {
        elements.emptyState.classList.add("is-visible");
        elements.overviewState.classList.remove("is-visible");
        elements.detailsState.classList.remove("is-visible");
        closeDrawer();
        return;
      }

      elements.emptyState.classList.remove("is-visible");
      renderCards(latestState.stats);
      renderTimeline(latestState.requests);
      renderTable(applyFilters(latestState.turns));
      switchView(currentView);

      if (selectedTurnId) {
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
            turns: summarizeTurns(requests),
            stats: buildStats(requests, payload.events),
            generatedAt: payload.generatedAt
          };
          renderMainView();
        } else {
          renderHeader(latestState.stats);
        }
      } catch (error) {
        isOffline = true;
        if (latestState.turns.length) {
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
            turns: summarizeTurns(requests),
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

    elements.settingsButton.addEventListener("click", function () {
      void openSettingsPanel();
    });

    elements.navSettingsButton.addEventListener("click", function (event) {
      event.preventDefault();
      void openSettingsPanel();
    });

    elements.searchInput.addEventListener("input", function (event) {
      searchTerm = event.target.value || "";
      renderTable(applyFilters(latestState.turns));
    });

    elements.filterButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        activeFilter = button.dataset.filter || "all";
        elements.filterButtons.forEach(function (item) {
          item.classList.toggle("active", (item.dataset.filter || "") === activeFilter);
        });
        renderTable(applyFilters(latestState.turns));
      });
    });

    elements.requestTableBody.addEventListener("click", function (event) {
      const row = event.target.closest("tr[data-turn-id]");
      if (!row) return;
      selectedTurnId = row.getAttribute("data-turn-id");
      const turn = currentSelectedTurn();
      selectedRequestId = turn && turn.latestRequestId ? turn.latestRequestId : null;
      renderTable(applyFilters(latestState.turns));
      openDrawer();
    });

    elements.timelineBars.addEventListener("click", function (event) {
      const bar = event.target.closest("button[data-request-id]");
      if (!bar) return;
      const requestId = bar.getAttribute("data-request-id");
      const request = latestState.requests.find(function (item) { return item.requestId === requestId; }) || null;
      if (request && request.requestKind === "probe") return;
      selectedRequestId = requestId;
      const turn = latestState.turns.find(function (item) {
        return item.requests.some(function (requestItem) { return requestItem.requestId === selectedRequestId; });
      }) || null;
      selectedTurnId = turn ? turn.turnId : null;
      renderTable(applyFilters(latestState.turns));
      openDrawer();
    });

    elements.drawerTurnRail.addEventListener("click", function (event) {
      const button = event.target.closest("button[data-request-id]");
      if (!button) return;
      selectedRequestId = button.getAttribute("data-request-id");
      openDrawer();
    });

    elements.drawerPromptStructure.addEventListener("click", function (event) {
      const button = event.target.closest("button[data-prompt-item]");
      if (!button) return;
      openPromptItemPanel(button.getAttribute("data-prompt-item"));
    });

    elements.drawerAnswerStructure.addEventListener("click", function (event) {
      const answerButton = event.target.closest("button[data-answer-item]");
      if (answerButton) {
        openAnswerItemPanel(answerButton.getAttribute("data-answer-item"));
        return;
      }
      const button = event.target.closest("button[data-tool-index]");
      if (!button) return;
      openToolPanel(Number(button.getAttribute("data-tool-index")));
    });

    elements.drawerClose.addEventListener("click", function () {
      closeDrawer();
    });

    elements.promptItemPanelClose.addEventListener("click", function () {
      closePromptItemPanel();
    });

    elements.promptItemPanelCopy.addEventListener("click", async function () {
      if (!promptPanelCopyText) return;
      try {
        await navigator.clipboard.writeText(promptPanelCopyText);
        if (promptPanelCopyResetTimer) {
          clearTimeout(promptPanelCopyResetTimer);
        }
        setCopyButtonState(elements.promptItemPanelCopy, true);
        promptPanelCopyResetTimer = setTimeout(function () {
          setCopyButtonState(elements.promptItemPanelCopy, false);
          promptPanelCopyResetTimer = null;
        }, 1200);
      } catch {
        setCopyButtonState(elements.promptItemPanelCopy, false);
      }
    });

    elements.drawerBackdrop.addEventListener("click", function () {
      closeDrawer();
    });

    elements.drawerMetadataButton.addEventListener("click", function () {
      openDrawerOverlay("metadata");
    });

    elements.drawerTransportButton.addEventListener("click", function () {
      openDrawerOverlay("transport");
    });

    elements.promptRawButton.addEventListener("click", function () {
      openRawInfoPanel();
    });

    elements.drawerOverlayClose.addEventListener("click", function () {
      closeDrawerOverlay();
    });

    elements.drawerOverlayBackdrop.addEventListener("click", function () {
      closeDrawerOverlay();
    });

    elements.drawerOverlayCopy.addEventListener("click", async function () {
      if (!overlayCopyText) return;
      try {
        await navigator.clipboard.writeText(overlayCopyText);
        if (overlayCopyResetTimer) {
          clearTimeout(overlayCopyResetTimer);
        }
        setCopyButtonState(elements.drawerOverlayCopy, true);
        overlayCopyResetTimer = setTimeout(function () {
          setCopyButtonState(elements.drawerOverlayCopy, false);
          overlayCopyResetTimer = null;
        }, 1200);
      } catch {
        setCopyButtonState(elements.drawerOverlayCopy, false);
      }
    });

    elements.floatingWindowHost.addEventListener("click", function (event) {
      const saveButton = event.target.closest("[data-settings-save]");
      if (!saveButton) return;
      void saveSettingsFromPanel(saveButton);
    });

    bindFloatingDrag(elements.detailDrawer.querySelector(".drawer-head"), elements.detailDrawer);
    bindFloatingDrag(elements.detailRailPanel.querySelector(".detail-rail-label"), elements.detailRailPanel);

    window.addEventListener("resize", function () {
      if (!elements.detailCluster.hidden) {
        const drawerOffset = getDragOffset(elements.detailDrawer);
        clampDragOffset(elements.detailDrawer, drawerOffset.x, drawerOffset.y);
      }
      if (!elements.detailRailPanel.hidden) {
        const railOffset = getDragOffset(elements.detailRailPanel);
        clampDragOffset(elements.detailRailPanel, railOffset.x, railOffset.y);
      }
      floatingWindows.forEach(function (entry) {
        const offset = getDragOffset(entry.element);
        clampDragOffset(entry.element, offset.x, offset.y);
      });
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      if (closeTopFloatingWindow()) {
        return;
      }
      if (!elements.detailCluster.hidden) {
        closeDrawer();
      }
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
        turns: summarizeTurns(requests),
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
