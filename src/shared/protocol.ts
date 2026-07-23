import type { ToolResultImageData } from "./tool-result-images.ts";

export const EVENT_NAMES = [
  "system.ready",
  "agent.state",
  "agent.message",
  "agent.delta",
  "agent.done",
  "tool.request",
  "tool.resolved",
  "mcp.capabilities",
  "filesystem.grants.updated",
  "command_terminal.updated",
  "mcp.execution.result",
  "agent.session.title",
  "sub_agent.spawned",
  "sub_agent.status",
  "skill.context",
  "scheduled_task.updated",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];
export type AgentRole = "system" | "user" | "assistant";

export interface SessionInfo {
  appName: "Truss";
  serviceMode: boolean;
  port: number;
  workspacePath: string;
  conversationScope: ConversationScopeSummary;
  startedAt: string;
  transports: {
    downstream: "sse";
    upstream: "http-post";
  };
  capabilities: string[];
  mcp: McpDiscoverySummary;
  llmProviders: LlmProviderSummary[];
  modelProfiles: LlmModelProfileSummary[];
  setup: FirstRunSetupSummary;
  skills: SkillDiscoverySummary;
}

export interface ConversationScopeSummary {
  databasePath: string;
  mode: "all" | "workspace";
  workspacePath: string;
}

export interface SpawnedProcessSummary {
  id: string;
  lastActiveAt: string;
  pid: number;
  port: number;
  startedAt: string;
  workspacePath: string;
}

export interface SpawnedProcessesResponse {
  currentProcessId: string;
  processes: SpawnedProcessSummary[];
}

export interface McpDiscoverySummary {
  availableTools: number;
  configPath: string;
  connectedServers: number;
  connectingServers: number;
  discoveredServers: number;
  failedServers: number;
  servers: McpServerConnectionSummary[];
  sources: McpSourceSummary[];
}

export interface McpSourceSummary {
  source: string;
  configFiles: string[];
  serverCount: number;
}

export interface McpServerConnectionSummary extends McpServerCapabilities {
  configPath: string;
  connected: boolean;
  disabledReason?: string;
  error?: string;
  source: string;
  status: McpServerConnectionStatus;
  trussManaged: boolean;
  transport: string;
}

export type McpServerConnectionStatus = "connecting" | "connected" | "disabled" | "failed";

export interface LlmProviderSummary {
  id: string;
  label: string;
  kind: LlmProviderKind;
  baseUrl: string;
  baseUrlSource: LlmProviderBaseUrlSource;
  configured: boolean;
  credentialRequired: boolean;
  enabled: boolean;
  credentialEnvVars: string[];
  secrets: LlmProviderSecretSummary[];
  defaultModel?: string;
  models: string[];
}

export type LlmProviderKind = "hosted" | "local" | "custom";
export type LlmProviderBaseUrlSource = "settings" | "env" | "default";
export type LlmProviderSecretSource = "truss-env" | "process-env" | "missing";

export interface LlmProviderSecretSummary {
  envVar: string;
  configured: boolean;
  encrypted: boolean;
  source: LlmProviderSecretSource;
}

export interface LlmProviderSettingsResponse {
  providers: LlmProviderSummary[];
}

export interface LlmProviderSettingsUpdateRequest {
  enabled?: boolean;
  baseUrl?: string | null;
  defaultModel?: string | null;
  models?: string[];
  secrets?: Record<string, string | null>;
}

export interface LlmProviderModelsRequest {
  apiKey?: string | null;
  baseUrl?: string | null;
}

export interface LlmProviderModelsResponse {
  models: string[];
  providerId: string;
}

export type LlmModelProfileId = "fast-helper" | "conversation" | "agentic";

export interface LlmGenerationParameters {
  temperature: number | null;
  topP: number | null;
  topK: number | null;
  contextSize: number | null;
}

export interface LlmModelCatalogDefault {
  modelId: string;
  parameters?: Partial<LlmGenerationParameters>;
}

export type LlmModelCatalogs = Record<
  string,
  Partial<Record<LlmModelProfileId, LlmModelCatalogDefault>>
>;

export interface LlmModelCatalogsResponse {
  catalogs: LlmModelCatalogs;
  errors: Record<string, string>;
}

export interface LlmModelProfileSummary {
  id: LlmModelProfileId;
  label: string;
  description: string;
  providerId: string;
  providerLabel: string;
  modelId: string;
  parameters: LlmGenerationParameters;
}

export interface LlmModelProfilesResponse {
  profiles: LlmModelProfileSummary[];
}

export interface LlmModelProfileUpdateRequest {
  providerId?: string;
  modelId?: string;
  parameters?: Partial<LlmGenerationParameters>;
}

export type ScheduledTaskCreatedBy = "user" | "llm";
export type ScheduledTaskRunStatus = "running" | "done" | "error" | "skipped";
export type ScheduledTaskRunTrigger = "cron" | "manual";

export interface ScheduledTaskSummary {
  id: string;
  name: string;
  prompt: string;
  cronExpression: string;
  timezone: string | null;
  workingDirectory: string | null;
  workspacePath: string | null;
  providerId: string;
  modelId: string;
  parameters: LlmGenerationParameters;
  allowOverlap: boolean;
  enabled: boolean;
  createdBy: ScheduledTaskCreatedBy;
  createdBySessionId: string | null;
  rootSessionId: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  running: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTasksResponse {
  tasks: ScheduledTaskSummary[];
}

export interface ScheduledTaskCreateRequest {
  name: string;
  prompt: string;
  cronExpression: string;
  timezone?: string | null;
  workingDirectory?: string | null;
  providerId?: string;
  modelId?: string;
  parameters?: Partial<LlmGenerationParameters>;
  allowOverlap?: boolean;
  enabled?: boolean;
}

export interface ScheduledTaskUpdateRequest {
  name?: string;
  prompt?: string;
  cronExpression?: string;
  timezone?: string | null;
  workingDirectory?: string | null;
  providerId?: string;
  modelId?: string;
  parameters?: Partial<LlmGenerationParameters>;
  allowOverlap?: boolean;
  enabled?: boolean;
}

export interface ScheduledTaskDeleteResponse {
  deleted: true;
}

export interface ScheduledTaskRunSummary {
  id: string;
  taskId: string;
  sessionId: string | null;
  status: ScheduledTaskRunStatus;
  trigger: ScheduledTaskRunTrigger;
  summary: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface ScheduledTaskRunsResponse {
  runs: ScheduledTaskRunSummary[];
}

export interface ScheduledTaskRunNowResponse {
  run: ScheduledTaskRunSummary;
}

export interface ScheduledTaskStopResponse {
  stopped: boolean;
}

export interface ScheduledTaskGlobalAccessResponse {
  granted: boolean;
  workspacePath: string;
}

export interface ScheduledTaskSessionSummary extends AgentSessionSummary {
  taskId: string;
  taskName: string;
  runStartedAt: string;
}

export interface ScheduledTaskSessionsResponse {
  sessions: ScheduledTaskSessionSummary[];
}

export type SystemPromptMode = "conversation" | "agentic";

export interface SystemPromptPlaceholderSummary {
  key: string;
  label: string;
  optional: boolean;
}

export interface SystemPromptTemplateSummary {
  defaultTemplate: string;
  mode: SystemPromptMode;
  label: string;
  template: string;
  renderedPreview: string;
  updatedAt: string;
}

export interface SystemPromptSettingsResponse {
  placeholders: SystemPromptPlaceholderSummary[];
  prompts: SystemPromptTemplateSummary[];
}

export interface SystemPromptSettingsUpdateRequest {
  template: string;
}

export interface SystemSettingsResponse {
  databasePath: string;
  envKeysPath: string;
  envPath: string;
  mcpConfigPath: string;
  trussHomeDir: string;
  conversationScopeMode: "all" | "workspace";
  conversationScopePath: string | null;
  workspacePath: string;
}

export interface McpSettingsSummary {
  commandRunner: CommandRunnerSettingsSummary;
  playwrightMcp: PlaywrightMcpSettingsSummary;
  sanitizerModelId: string | null;
  sanitizerProviderId: string | null;
}

export interface PlaywrightMcpSettingsSummary {
  enabled: boolean;
  tools: string;
}

export type CommandRunnerSafetyLevel = "safe" | "risky" | "dangerous";
export type CommandRunnerGuardAction = "auto-allow" | "ask" | "auto-deny";
export type CommandRunnerWhitelistPatternType = "prefix" | "glob" | "regex";
export type CommandRunnerWhitelistExpiry = "permanent" | "24-hours" | "1-month";
export type CommandRunnerWhitelistAddedBy = "user" | "llm-request";
export type CommandExecutionStatus = "running" | "completed" | "timed_out" | "killed";
export type CommandTerminalStatus = "running" | "idle" | "timed_out" | "killed";

export interface CommandRunnerSettingsSummary {
  dangerousAction: CommandRunnerGuardAction;
  guardModelId: string | null;
  guardProviderId: string | null;
  postExecutionGuardEnabled: boolean;
  preExecutionGuardEnabled: boolean;
  riskyAction: CommandRunnerGuardAction;
  safeAction: CommandRunnerGuardAction;
}

export interface CommandRunnerWhitelistEntrySummary {
  addedBy: CommandRunnerWhitelistAddedBy;
  createdAt: string;
  expiresAt: string | null;
  id: number;
  pattern: string;
  reason: string | null;
  type: CommandRunnerWhitelistPatternType;
}

export interface CommandRunnerSecuritySummary {
  settings: CommandRunnerSettingsSummary;
  whitelistEntries: CommandRunnerWhitelistEntrySummary[];
}

export interface McpSettingsResponse {
  mcpConfigPath: string;
  mcpConfigText: string;
  secrets: LlmProviderSecretSummary[];
  settings: McpSettingsSummary;
}

export interface McpReloadResponse {
  mcp: McpDiscoverySummary;
}

export interface McpReloadRequest {
  approveStdioServers?: boolean;
}

export interface McpResourceReadRequest {
  serverId: string;
  uri: string;
}

export interface McpResourceContent {
  blob?: string;
  mimeType?: string;
  text?: string;
  uri: string;
}

export interface McpResourceReadResponse {
  contents: McpResourceContent[];
}

export interface McpPromptGetRequest {
  arguments?: Record<string, string>;
  name: string;
  serverId: string;
}

export interface McpPromptMessageContent {
  blob?: string;
  mimeType?: string;
  text?: string;
  type?: string;
  uri?: string;
}

export interface McpPromptMessage {
  content: McpPromptMessageContent;
  role: string;
  text: string;
}

export interface McpPromptGetResponse {
  description?: string;
  messages: McpPromptMessage[];
  text: string;
}

export interface McpSettingsUpdateRequest {
  approveStdioServers?: boolean;
  commandRunner?: Partial<CommandRunnerSettingsSummary>;
  mcpConfigText?: string;
  mcpSecrets?: Record<string, string | null>;
  playwrightMcp?: Partial<PlaywrightMcpSettingsSummary>;
  restoreTrussMcpDefault?: boolean;
  sanitizerModelId?: string | null;
  sanitizerProviderId?: string | null;
}

export type FileAccessGrantSource = "cli-arg" | "user-dialog";
export type FileAccessGrantScope = "global" | "workspace";

export interface FileAccessDirectoryUpdate {
  path: string;
  readOnly?: boolean;
  scope?: FileAccessGrantScope;
}

export interface FileAccessDirectorySummary {
  error?: string;
  exists: boolean;
  expiresAt?: string;
  grantId?: number;
  grantSource?: FileAccessGrantSource;
  grantedAt?: string;
  path: string;
  readOnly: boolean;
  scope: FileAccessGrantScope;
  source: "user" | "workspace";
  workspacePath: string | null;
}

export interface FileAccessActiveScopeSummary {
  label: string;
  mode: FileAccessGrantScope;
  workspacePath: string | null;
}

export interface FileAccessSecurityResponse {
  activeScope: FileAccessActiveScopeSummary;
  commandRunner: CommandRunnerSecuritySummary;
  configPath: string;
  defaultIgnorePatterns: string[];
  directories: FileAccessDirectorySummary[];
  effectiveDirectories: FileAccessDirectorySummary[];
  ignorePatterns: string[];
  usingDefaultIgnorePatterns: boolean;
  workspaceDirectory: FileAccessDirectorySummary | null;
}

export type FileAccessWorkspaceTreeAccess = "deny" | "read-only" | "read-write";
export type FileAccessWorkspaceTreeNodeType = "directory" | "file" | "other" | "symlink";

export interface FileAccessWorkspaceTreeNode {
  access: FileAccessWorkspaceTreeAccess;
  error?: string;
  hasChildren: boolean;
  name: string;
  path: string;
  relativePath: string;
  rule: string;
  type: FileAccessWorkspaceTreeNodeType;
}

export interface FileAccessWorkspaceTreeResponse {
  activeScope: FileAccessActiveScopeSummary;
  children: FileAccessWorkspaceTreeNode[];
  directory: FileAccessWorkspaceTreeNode;
  limit: number;
  truncated: boolean;
}

export interface FileAccessSecurityUpdateRequest {
  commandRunner?: Partial<CommandRunnerSettingsSummary> & {
    whitelistEntries?: CommandRunnerWhitelistEntryUpdate[];
  };
  directories?: Array<string | FileAccessDirectoryUpdate>;
  ignorePatterns?: string[];
}

export interface CommandRunnerWhitelistEntryUpdate {
  addedBy?: CommandRunnerWhitelistAddedBy;
  expiresAt?: string | null;
  pattern: string;
  reason?: string | null;
  type: CommandRunnerWhitelistPatternType;
}

export interface HistorySettingsSummary {
  includeThinkingHistory: boolean;
  includeToolHistory: boolean;
  limitReasoningBudget: boolean;
  maxReasoningTimeSeconds: number;
  maxReasoningWords: number;
  thinkingHistoryAvailable: boolean;
  toolHistoryAvailable: boolean;
}

export interface HistorySettingsResponse {
  history: HistorySettingsSummary;
}

export interface HistorySettingsUpdateRequest {
  includeThinkingHistory?: boolean;
  includeToolHistory?: boolean;
  limitReasoningBudget?: boolean;
  maxReasoningTimeSeconds?: number;
  maxReasoningWords?: number;
}

export type PlantUmlRenderFormat = "png" | "svg";

export interface RichFeatureSettingsSummary {
  agenticToolTurnLimit: number;
  agenticToolTurnLimitEnabled: boolean;
  cardsEnabled: boolean;
  calloutsEnabled: boolean;
  followUpsEnabled: boolean;
  katexEnabled: boolean;
  plantUmlEnabled: boolean;
  plantUmlFormat: PlantUmlRenderFormat;
  plantUmlPrompt: string;
  plantUmlServerUrl: string;
  smartEventsEnabled: boolean;
  smartEventsGoogleCalendarEnabled: boolean;
  smartEventsIcsEnabled: boolean;
  smartEventsOutlookCalendarEnabled: boolean;
  smartTablesEnabled: boolean;
  timelinesEnabled: boolean;
}

export interface RichFeatureSettingsResponse {
  richFeatures: RichFeatureSettingsSummary;
}

export interface RichFeatureSettingsUpdateRequest {
  agenticToolTurnLimit?: number;
  agenticToolTurnLimitEnabled?: boolean;
  cardsEnabled?: boolean;
  calloutsEnabled?: boolean;
  followUpsEnabled?: boolean;
  katexEnabled?: boolean;
  plantUmlEnabled?: boolean;
  plantUmlFormat?: PlantUmlRenderFormat;
  plantUmlPrompt?: string;
  plantUmlServerUrl?: string;
  smartEventsEnabled?: boolean;
  smartEventsGoogleCalendarEnabled?: boolean;
  smartEventsIcsEnabled?: boolean;
  smartEventsOutlookCalendarEnabled?: boolean;
  smartTablesEnabled?: boolean;
  timelinesEnabled?: boolean;
}

export interface SettingsResponse {
  richFeatures: RichFeatureSettingsSummary;
}

export interface SettingsUpdateRequest {
  richFeatures?: RichFeatureSettingsUpdateRequest;
}

export type AgentSessionType = "conversation" | "agentic" | "sub-agent";

export interface AgentSessionSummary {
  id: string;
  type: AgentSessionType;
  parentSessionId: string | null;
  title: string | null;
  providerId: string;
  modelId: string;
  messageCount: number;
  parameters: LlmGenerationParameters;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
  workspacePath: string | null;
  workspaceDisplayName?: string;
  workspaceExists?: boolean;
  originContext?: "workspace" | "global";
}

export interface AgentSessionsResponse {
  sessions: AgentSessionSummary[];
}

export interface OpenAiChatToolDefinition {
  function: {
    description: string;
    name: string;
    parameters: Record<string, unknown>;
  };
  type: "function";
}

export interface AgentSessionDetailResponse {
  messages: StoredChatMessage[];
  session: AgentSessionSummary;
  systemMessage: ChatMessage;
  tools: OpenAiChatToolDefinition[];
}

export interface AgentSessionCreateRequest {
  type: AgentSessionType;
  parentSessionId?: string | null;
  profileId?: LlmModelProfileId;
  providerId?: string;
  modelId?: string;
  title?: string | null;
  parameters?: Partial<LlmGenerationParameters>;
}

export interface AgentSessionRenameRequest {
  title?: string | null;
}

export interface AgentSessionDeleteResponse {
  deleted: true;
}

export interface WorkspaceSummary {
  displayName: string;
  firstCreatedAt: string;
  lastActiveAt: string;
  lastCreatedAt: string;
  sessionCount: number;
  workspacePath: string;
}

export interface WorkspacesResponse {
  workspaces: WorkspaceSummary[];
}

export interface WorkspaceDeleteRequest {
  workspacePath: string;
}

export interface WorkspaceDeleteResponse {
  deleted: true;
  sessionCount: number;
  workspacePath: string;
}

export interface WorkspaceDirectoryPickResponse {
  cancelled: boolean;
  workspacePath: string | null;
}

export interface AgentSessionMessageUpdateRequest {
  attachments?: ChatAttachment[];
  content: string;
}

export interface AgentSessionMessageDeleteResponse {
  deleted: true;
}

export interface WorkspaceConversationLaunchRequest {
  messageId?: string | null;
  sessionId?: string | null;
  workspacePath?: string | null;
}

export interface WorkspaceConversationLaunchResponse {
  reused: boolean;
  url: string;
  workspacePath: string | null;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  status?: "error" | null;
  attachments?: ChatAttachment[];
}

export type ChatAttachmentKind = "image" | "text" | "document";
export type ChatAttachmentConversionKind = "image" | "text";

export interface ChatAttachment {
  conversionKind?: ChatAttachmentConversionKind;
  dataUrl: string;
  id: string;
  kind: ChatAttachmentKind;
  mimeType: string;
  name: string;
  size: number;
  sourceFormat?: string;
  sourceMimeType?: string;
  sourceName?: string;
  sourcePage?: number;
  sourcePageCount?: number;
  text?: string;
}

export interface AttachmentConversionResponse {
  attachment?: Omit<ChatAttachment, "id">;
  attachments?: Array<Omit<ChatAttachment, "id">>;
  pageCount?: number;
}

export interface AttachmentRenderConfirmationRequiredResponse {
  confirmationRequired: true;
  error: string;
  fileName: string;
  pageCount: number;
}

export interface ChatThinking {
  content: string;
  cutOff?: boolean;
  durationMs: number;
  encryptedContent?: string;
  toolCalls?: ChatToolCall[];
  wordCount: number;
}

export interface ChatToolSettings {
  disabledMcpServerIds?: string[];
  disabledMcpTools?: Record<string, string[]>;
  loadWebpageEnabled: boolean;
  sanitizerModelId?: string | null;
  sanitizerProviderId?: string | null;
  webSearchEnabled: boolean;
}

export interface ChatToolCall {
  args: Record<string, unknown>;
  completedAt?: string;
  error?: string;
  id: string;
  imageResult?: ToolResultImageData;
  progress?: ChatToolCallProgress;
  result?: string;
  security?: ChatToolCallSecurity;
  startedAt: string;
  status: "completed" | "error" | "running";
  commandExecution?: ChatCommandExecutionReference;
  subAgent?: ChatSubAgentReference;
  terminal?: ChatCommandTerminalReference;
  thinkingAfter?: string;
  thinkingBefore?: string;
  title: string;
  turn?: number;
  toolId: string;
}

export interface ChatToolCallSecurity {
  commandRunner?: CommandRunnerToolSecurity;
}

export interface CommandRunnerToolSecurity {
  postExecution?: CommandRunnerGuardAssessment;
  preExecution?: CommandRunnerGuardAssessment;
}

export interface CommandRunnerGuardAssessment {
  enabled: boolean;
  model?: CommandRunnerGuardModelSummary;
  skippedReason?: string;
  verdict?: CommandRunnerGuardVerdict;
}

export interface CommandRunnerGuardModelSummary {
  modelId: string;
  providerId: string;
  providerLabel: string;
}

export interface ChatToolCallProgress {
  message?: string;
  percent: number;
}

export type ChatSubAgentStatus = "running" | "done" | "error";

export type ChatGeneratedMessageMetadata =
  | {
      kind: "sub_agent_completion";
      subSessionId: string;
    }
  | {
      kind: "timer";
      label?: string;
      lengthSeconds?: number;
      timerId?: string;
    };

export interface OrchestrationTimerSummary {
  firesAt: string;
  label?: string;
  lengthSeconds: number;
  message: string;
  startedAt?: string;
  timerId: string;
}

export interface OrchestrationTimersResponse {
  timers: OrchestrationTimerSummary[];
}

export interface OrchestrationTimerActionRequest {
  delaySeconds?: number;
  sessionId: string;
}

export interface OrchestrationTimerActionResponse {
  cancelled?: boolean;
  fired?: boolean;
  timer?: OrchestrationTimerSummary | null;
}

export interface ChatSubAgentReference {
  completedAt?: string;
  elapsedMs?: number;
  modelId?: string;
  parentSessionId: string;
  startedAt: string;
  status: ChatSubAgentStatus;
  subSessionId: string;
  task: string;
  toolTurnCount?: number;
}

export interface ChatCommandTerminalReference {
  command: string;
  label: string;
  lastOutputPreview: string;
  startedAt: string;
  status: CommandTerminalStatus;
  terminalId: string;
}

export interface ChatCommandExecutionReference {
  command: string;
  executionId: string;
  label: string;
  startedAt: string;
  status: CommandExecutionStatus;
}

export const defaultChatToolSettings: ChatToolSettings = {
  disabledMcpServerIds: [],
  disabledMcpTools: {},
  loadWebpageEnabled: true,
  sanitizerModelId: null,
  sanitizerProviderId: null,
  webSearchEnabled: true,
};

export interface ChatCompletionMetrics {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  promptSpeed?: number;      // tokens/sec
  completionSpeed?: number;  // tokens/sec
  price?: number | string;   // cost or "n/a"
}

export interface StoredChatMessage extends ChatMessage {
  id: string;
  createdAt: string;
  role: "user" | "assistant";
  status?: "error" | null;
  thinking?: ChatThinking | null;
  metrics?: ChatCompletionMetrics | null;
}

export interface ChatRequest {
  modeOverride?: "conversation" | "agentic";
  sessionId?: string | null;
  type: "conversation" | "agentic";
  providerId?: string;
  modelId?: string;
  messages: ChatMessage[];
  tools?: ChatToolSettings;
}

export interface ChatResponse {
  sessionId: string;
  message: StoredChatMessage;
  providerId: string;
  providerLabel: string;
  modelId: string;
  thinking: ChatThinking | null;
  title: string | null;
}

export type ChatStreamEvent =
  | ChatStreamStartEvent
  | ChatStreamContentDeltaEvent
  | ChatStreamThinkingDeltaEvent
  | ChatStreamToolCallEvent
  | ChatStreamAssistantMessageEvent
  | ChatStreamSubAgentSpawnedEvent
  | ChatStreamSubAgentStatusEvent
  | ChatStreamSubAgentDeltaEvent
  | ChatStreamSubAgentThinkingDeltaEvent
  | ChatStreamSubAgentToolCallEvent
  | ChatStreamSubAgentMessageEvent
  | ChatStreamUserChoiceRequestEvent
  | ChatStreamDoneEvent
  | ChatStreamErrorEvent;

export interface ChatStreamStartEvent {
  type: "start";
  sessionId: string;
  providerId: string;
  providerLabel: string;
  modelId: string;
  title: string | null;
}

export interface ChatStreamContentDeltaEvent {
  type: "content_delta";
  delta: string;
}

export interface ChatStreamThinkingDeltaEvent {
  type: "thinking_delta";
  delta: string;
  durationMs: number;
  wordCount: number;
}

export interface ChatStreamToolCallEvent {
  type: "tool_call";
  call: ChatToolCall;
}

export interface ChatStreamAssistantMessageEvent {
  type: "assistant_message";
  sessionId: string;
  message: StoredChatMessage;
  providerId: string;
  providerLabel: string;
  modelId: string;
  thinking: ChatThinking | null;
  title: string | null;
}

export interface ChatStreamSubAgentSpawnedEvent {
  type: "sub_agent.spawned";
  message?: StoredChatMessage;
  modelId: string;
  parentSessionId: string;
  startedAt: string;
  subSessionId: string;
  task: string;
}

export interface ChatStreamSubAgentStatusEvent {
  type: "sub_agent.status";
  completedAt?: string;
  elapsedMs?: number;
  status: ChatSubAgentStatus;
  subSessionId: string;
  toolTurnCount?: number;
}

export interface ChatStreamSubAgentDeltaEvent {
  type: "sub_agent.delta";
  delta: string;
  modelId: string;
  subSessionId: string;
}

export interface ChatStreamSubAgentThinkingDeltaEvent {
  type: "sub_agent.thinking_delta";
  delta: string;
  durationMs: number;
  subSessionId: string;
  wordCount: number;
}

export interface ChatStreamSubAgentToolCallEvent {
  type: "sub_agent.tool_call";
  call: ChatToolCall;
  subSessionId: string;
}

export interface ChatStreamSubAgentMessageEvent {
  type: "sub_agent.message";
  message: StoredChatMessage;
  modelId: string;
  subSessionId: string;
}

export interface ChatStreamUserChoiceRequestEvent {
  type: "user_choice_request";
  request: ChatUserChoiceRequest;
}

export interface ChatStreamDoneEvent {
  type: "done";
  sessionId: string;
  message: StoredChatMessage;
  providerId: string;
  providerLabel: string;
  modelId: string;
  thinking: ChatThinking | null;
  title: string | null;
}

export interface ChatStreamErrorEvent {
  type: "error";
  error: string;
}

export interface ChatUserChoiceOption {
  description?: string;
  id: string;
  label: string;
  value?: string;
}

export interface ChatUserChoiceRequest {
  allowCustomOption: boolean;
  commandApproval?: ChatCommandApprovalRequest;
  commandWhitelist?: ChatCommandWhitelistRequest;
  customOptionLabel: string;
  customOptionPlaceholder: string;
  directoryAccess?: ChatDirectoryAccessRequest;
  icon: string;
  id: string;
  kind: "command_approval" | "command_whitelist" | "directory_access" | "choice";
  options: ChatUserChoiceOption[];
  question: string;
  title: string;
}

export interface ChatDirectoryAccessRequest {
  directoryPath: string;
  readOnly: boolean;
  reason: string | null;
}

export interface ChatCommandApprovalRequest {
  accessesOutsideWhitelist: boolean;
  command: string;
  safetyLevel: CommandRunnerSafetyLevel;
  safetyReasoning: string | null;
  summary: string | null;
}

export interface ChatCommandWhitelistRequest {
  pattern: string;
  reason: string;
  type: CommandRunnerWhitelistPatternType;
}

export type ChatUserChoiceAppliedEffect =
  | {
      directoryPath: string;
      mcpReloaded: boolean;
      readOnly: boolean;
      reloadError?: string;
      type: "file_access_directory_granted";
    }
  | {
      expiresAt: string | null;
      pattern: string;
      type: "command_whitelist_added";
      whitelistType: CommandRunnerWhitelistPatternType;
    };

export interface ChatUserChoiceResolutionRequest {
  appliedEffect?: ChatUserChoiceAppliedEffect;
  cancelled?: boolean;
  customResponse?: string;
  optionId?: string;
}

export interface ChatUserChoiceResolutionResponse {
  resolved: true;
}

export interface ChatUserChoiceToolResult {
  appliedEffect?: ChatUserChoiceAppliedEffect;
  cancelled: boolean;
  customResponse?: string;
  question: string;
  reason?: "timeout" | "user_cancelled";
  resolvedAt: string;
  selectedOption?: {
    description?: string;
    id: string;
    index: number;
    label: string;
    value: string;
  };
  selectionType?: "custom" | "option";
}

export interface FirstRunSetupSummary {
  completed: boolean;
  nickname: string | null;
  preferredLanguage: string | null;
  location: string | null;
  modelCatalogUrl: string | null;
  showWorkspaceSessionsInGlobalView: boolean;
}

export interface FirstRunSetupUpdateRequest {
  completed?: boolean;
  nickname?: string | null;
  preferredLanguage?: string | null;
  location?: string | null;
  modelCatalogUrl?: string | null;
  showWorkspaceSessionsInGlobalView?: boolean;
}

export interface FirstRunSetupResponse {
  setup: FirstRunSetupSummary;
}

export interface SetupLocationLookupResponse {
  city: string | null;
  country: string | null;
  location: string;
  regionName: string | null;
}

export interface SkillDiscoverySummary {
  discoveredSkills: number;
  activeSkills: number;
  directories: string[];
  skills: SkillSummary[];
}

export interface SkillReadRequest {
  skillId: string;
}

export interface SkillReadResponse {
  body: string;
  skill: SkillSummary;
}

export interface SkillSummary {
  id: string;
  name: string;
  description?: string;
  path: string;
  active: boolean;
  scope: "global" | "workspace";
  source: string;
  tokenEstimate: number;
}

export type AgentState = "idle" | "thinking" | "waiting_for_tool" | "streaming" | "error";
export type ToolOrigin = "native" | "mcp";

export interface BaseEvent {
  id: string;
  type: EventName;
  createdAt: string;
}

export interface SystemReadyEvent extends BaseEvent {
  type: "system.ready";
  session: SessionInfo;
}

export interface AgentStateEvent extends BaseEvent {
  type: "agent.state";
  state: AgentState;
  reason?: string;
}

export interface AgentMessageEvent extends BaseEvent {
  type: "agent.message";
  messageId: string;
  role: AgentRole;
  content: string;
  generated?: ChatGeneratedMessageMetadata;
  message?: StoredChatMessage;
  modelId?: string;
  sessionId?: string;
}

export interface AgentDeltaEvent extends BaseEvent {
  type: "agent.delta";
  messageId: string;
  role: "assistant";
  delta: string;
  sessionId?: string;
}

export interface AgentDoneEvent extends BaseEvent {
  type: "agent.done";
  messageId: string;
  message?: StoredChatMessage;
  sessionId?: string;
}

export interface ToolRequestEvent extends BaseEvent {
  type: "tool.request";
  executionId: string;
  toolId: string;
  title: string;
  origin: ToolOrigin;
  args: Record<string, unknown>;
  mcp?: McpToolReference;
  approval?: ToolApprovalRequest;
}

export interface ToolResolvedEvent extends BaseEvent {
  type: "tool.resolved";
  executionId: string;
  toolId: string;
  result: unknown;
}

export interface ToolApprovalRequest {
  policy: "always" | "on_demand";
  reason: string;
}

export interface McpToolReference {
  serverId: string;
  toolName: string;
}

export interface McpCapabilitiesEvent extends BaseEvent {
  type: "mcp.capabilities";
  mcp: McpDiscoverySummary;
  servers: McpServerCapabilities[];
}

export interface FilesystemGrantsUpdatedEvent extends BaseEvent {
  type: "filesystem.grants.updated";
  fileAccess: FileAccessSecurityResponse;
}

export interface CommandTerminalUpdatedEvent extends BaseEvent {
  type: "command_terminal.updated";
  sessionId: string;
  terminal: CommandTerminalSummary;
}

export interface CommandTerminalSummary {
  command: string;
  label: string;
  lastOutputPreview: string;
  log: CommandTerminalLogEntry[];
  startedAt: string;
  status: CommandTerminalStatus;
  terminalId: string;
  updatedAt: string;
  workingDirectory: string;
}

export interface CommandTerminalLogEntry {
  createdAt: string;
  guardVerdict?: CommandRunnerGuardVerdict;
  stream: "stdout" | "stderr" | "stdin" | "system";
  text: string;
}

export interface CommandRunnerGuardVerdict {
  accessesOutsideWhitelist?: boolean;
  denyOutput?: boolean;
  safetyLevel: CommandRunnerSafetyLevel;
  safetyReasoning: string;
  tldr: string;
}

export interface McpServerCapabilities {
  serverId: string;
  name: string;
  tools: McpToolCapability[];
  resources: McpResourceCapability[];
  prompts: McpPromptCapability[];
}

export interface McpToolCapability {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpResourceCapability {
  uri: string;
  name?: string;
  mimeType?: string;
}

export interface McpPromptCapability {
  name: string;
  description?: string;
  arguments?: Record<string, unknown>[];
}

export interface McpExecutionResultEvent extends BaseEvent {
  type: "mcp.execution.result";
  executionId: string;
  serverId: string;
  toolName: string;
  approved: boolean;
  result?: unknown;
  error?: string;
}

export interface SkillContextEvent extends BaseEvent {
  type: "skill.context";
  activeSkills: SkillSummary[];
  prunedSkills: SkillSummary[];
  tokenBudget: number;
}

export interface AgentSessionTitleEvent extends BaseEvent {
  type: "agent.session.title";
  sessionId: string;
  title: string | null;
}

export interface SubAgentSpawnedEvent extends BaseEvent {
  type: "sub_agent.spawned";
  message?: StoredChatMessage;
  modelId: string;
  parentSessionId: string;
  startedAt: string;
  subSessionId: string;
  task: string;
}

export interface SubAgentStatusEvent extends BaseEvent {
  type: "sub_agent.status";
  completedAt?: string;
  elapsedMs?: number;
  status: ChatSubAgentStatus;
  subSessionId: string;
  toolTurnCount?: number;
}

export interface ScheduledTaskUpdatedEvent extends BaseEvent {
  type: "scheduled_task.updated";
  task: ScheduledTaskSummary;
  run?: ScheduledTaskRunSummary;
}

export type TrussEvent =
  | SystemReadyEvent
  | AgentStateEvent
  | AgentMessageEvent
  | AgentDeltaEvent
  | AgentDoneEvent
  | ToolRequestEvent
  | ToolResolvedEvent
  | McpCapabilitiesEvent
  | FilesystemGrantsUpdatedEvent
  | CommandTerminalUpdatedEvent
  | McpExecutionResultEvent
  | AgentSessionTitleEvent
  | SubAgentSpawnedEvent
  | SubAgentStatusEvent
  | SkillContextEvent
  | ScheduledTaskUpdatedEvent;

export interface CommandRequest {
  content: string;
}

export interface CommandAccepted {
  accepted: true;
  commandId: string;
}

export interface ToolResolutionRequest {
  payload: unknown;
}

export interface ToolApprovalResolutionRequest {
  approved: boolean;
  payload?: unknown;
}

export interface ApiError {
  error: string;
}
