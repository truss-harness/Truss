import type {
  LlmModelCatalogsResponse,
  LlmProviderSettingsResponse,
  LlmProviderSettingsUpdateRequest,
  LlmProviderModelsRequest,
  LlmProviderModelsResponse,
  LlmModelProfilesResponse,
  LlmModelProfileUpdateRequest,
  McpPromptGetRequest,
  McpPromptGetResponse,
  McpReloadRequest,
  McpReloadResponse,
  McpResourceReadRequest,
  McpResourceReadResponse,
  McpSettingsResponse,
  McpSettingsUpdateRequest,
  OrchestrationTimerActionRequest,
  OrchestrationTimerActionResponse,
  OrchestrationTimersResponse,
  AgentSessionCreateRequest,
  AgentSessionDeleteResponse,
  AgentSessionDetailResponse,
  AgentSessionMessageDeleteResponse,
  AgentSessionMessageUpdateRequest,
  AgentSessionRenameRequest,
  AgentSessionSummary,
  AgentSessionsResponse,
  AttachmentConversionResponse,
  AttachmentRenderConfirmationRequiredResponse,
  ChatAttachment,
  ChatCommandExecutionReference,
  ChatRequest,
  ChatResponse,
  ChatStreamEvent,
  ChatUserChoiceResolutionRequest,
  ChatUserChoiceResolutionResponse,
  CommandTerminalSummary,
  FirstRunSetupResponse,
  FirstRunSetupUpdateRequest,
  FileAccessSecurityResponse,
  FileAccessSecurityUpdateRequest,
  FileAccessWorkspaceTreeResponse,
  HistorySettingsResponse,
  HistorySettingsUpdateRequest,
  RichFeatureSettingsResponse,
  RichFeatureSettingsUpdateRequest,
  ScheduledTaskCreateRequest,
  ScheduledTaskDeleteResponse,
  ScheduledTaskRunNowResponse,
  ScheduledTaskRunsResponse,
  ScheduledTaskSessionsResponse,
  ScheduledTasksResponse,
  ScheduledTaskStopResponse,
  ScheduledTaskSummary,
  ScheduledTaskUpdateRequest,
  SessionInfo,
  SpawnedProcessesResponse,
  SetupLocationLookupResponse,
  SkillReadRequest,
  SkillReadResponse,
  StoredChatMessage,
  SystemPromptMode,
  SystemPromptSettingsResponse,
  SystemPromptSettingsUpdateRequest,
  SystemSettingsResponse,
  WorkspaceDeleteRequest,
  WorkspaceDeleteResponse,
  WorkspaceConversationLaunchRequest,
  WorkspaceConversationLaunchResponse,
  WorkspaceDirectoryPickResponse,
  WorkspacesResponse,
} from "../shared/protocol.ts";

export class AttachmentImageConfirmationRequiredError extends Error {
  readonly fileName: string;
  readonly pageCount: number;

  constructor(response: AttachmentRenderConfirmationRequiredResponse) {
    super(response.error);
    this.name = "AttachmentImageConfirmationRequiredError";
    this.fileName = response.fileName;
    this.pageCount = response.pageCount;
  }
}

export interface ChatStreamHandlers {
  onAssistantMessage?(event: Extract<ChatStreamEvent, { type: "assistant_message" }>): void;
  onContentDelta?(event: Extract<ChatStreamEvent, { type: "content_delta" }>): void;
  onDone?(event: Extract<ChatStreamEvent, { type: "done" }>): void;
  onError?(event: Extract<ChatStreamEvent, { type: "error" }>): void;
  onStart?(event: Extract<ChatStreamEvent, { type: "start" }>): void;
  onSubAgentDelta?(event: Extract<ChatStreamEvent, { type: "sub_agent.delta" }>): void;
  onSubAgentMessage?(event: Extract<ChatStreamEvent, { type: "sub_agent.message" }>): void;
  onSubAgentSpawned?(event: Extract<ChatStreamEvent, { type: "sub_agent.spawned" }>): void;
  onSubAgentStatus?(event: Extract<ChatStreamEvent, { type: "sub_agent.status" }>): void;
  onSubAgentThinkingDelta?(
    event: Extract<ChatStreamEvent, { type: "sub_agent.thinking_delta" }>,
  ): void;
  onSubAgentToolCall?(event: Extract<ChatStreamEvent, { type: "sub_agent.tool_call" }>): void;
  onThinkingDelta?(event: Extract<ChatStreamEvent, { type: "thinking_delta" }>): void;
  onToolCall?(event: Extract<ChatStreamEvent, { type: "tool_call" }>): void;
  onUserChoiceRequest?(
    event: Extract<ChatStreamEvent, { type: "user_choice_request" }>,
  ): void;
}

export interface ChatStreamOptions {
  signal?: AbortSignal;
}

export interface FetchAgentSessionsOptions {
  excludeScheduledTaskSessions?: boolean;
  includeSubAgents?: boolean;
  includeWorkspaceSessions?: boolean;
  limit?: number;
  search?: string;
}

export async function fetchSession(): Promise<SessionInfo> {
  const response = await fetch("/api/session");

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as SessionInfo;
}

export async function fetchSpawnedProcesses(): Promise<SpawnedProcessesResponse> {
  const response = await fetch("/api/spawned-processes");

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as SpawnedProcessesResponse;
}

export async function terminateSpawnedProcess(processId: string): Promise<void> {
  const response = await fetch(
    `/api/spawned-processes/${encodeURIComponent(processId)}/terminate`,
    { method: "POST" },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

export async function readSkill(request: SkillReadRequest): Promise<SkillReadResponse> {
  const response = await fetch("/api/skills/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as SkillReadResponse;
}

export async function sendCommand(content: string): Promise<void> {
  const response = await fetch("/api/commands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

export async function resolveTool(executionId: string, payload: unknown): Promise<void> {
  const response = await fetch(`/api/tools/${encodeURIComponent(executionId)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

export async function fetchLlmProviderSettings(): Promise<LlmProviderSettingsResponse> {
  const response = await fetch("/api/settings/llm-providers");

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as LlmProviderSettingsResponse;
}

export async function updateLlmProviderSettings(
  providerId: string,
  update: LlmProviderSettingsUpdateRequest,
): Promise<LlmProviderSettingsResponse> {
  const response = await fetch(`/api/settings/llm-providers/${encodeURIComponent(providerId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as LlmProviderSettingsResponse;
}

export async function fetchLlmModelCatalogs(): Promise<LlmModelCatalogsResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch("/api/settings/model-catalogs", {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return (await response.json()) as LlmModelCatalogsResponse;
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") {
      throw new Error("Timed out while fetching default model recommendations.");
    }

    throw caught;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function fetchLlmProviderModels(
  providerId: string,
  request: LlmProviderModelsRequest,
): Promise<LlmProviderModelsResponse> {
  const response = await fetch(
    `/api/settings/llm-providers/${encodeURIComponent(providerId)}/models`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as LlmProviderModelsResponse;
}

export async function fetchModelProfiles(): Promise<LlmModelProfilesResponse> {
  const response = await fetch("/api/settings/model-profiles");

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as LlmModelProfilesResponse;
}

export async function fetchSetup(): Promise<FirstRunSetupResponse> {
  const response = await fetch("/api/setup");

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as FirstRunSetupResponse;
}

export async function fetchHistorySettings(): Promise<HistorySettingsResponse> {
  const response = await fetch("/api/settings/history");

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as HistorySettingsResponse;
}

export async function fetchMcpSettings(): Promise<McpSettingsResponse> {
  const response = await fetch("/api/settings/mcp");

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as McpSettingsResponse;
}

export async function fetchFileAccessSettings(): Promise<FileAccessSecurityResponse> {
  const response = await fetch("/api/settings/security");

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as FileAccessSecurityResponse;
}

export async function fetchFileAccessWorkspaceTree(
  path?: string,
): Promise<FileAccessWorkspaceTreeResponse> {
  const params = new URLSearchParams();

  if (path) {
    params.set("path", path);
  }

  const query = params.toString();
  const response = await fetch(
    `/api/settings/security/workspace-access${query ? `?${query}` : ""}`,
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as FileAccessWorkspaceTreeResponse;
}

export async function updateFileAccessSettings(
  update: FileAccessSecurityUpdateRequest,
): Promise<FileAccessSecurityResponse> {
  const response = await fetch("/api/settings/security", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as FileAccessSecurityResponse;
}

export async function updateMcpSettings(
  update: McpSettingsUpdateRequest,
): Promise<McpSettingsResponse> {
  const response = await fetch("/api/settings/mcp", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as McpSettingsResponse;
}

export async function listCommandTerminals(
  sessionId: string,
): Promise<{ terminals: CommandTerminalSummary[] }> {
  const response = await fetch(
    `/api/command-terminals?sessionId=${encodeURIComponent(sessionId)}`,
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as { terminals: CommandTerminalSummary[] };
}

export async function killCommandTerminal(
  terminalId: string,
  sessionId: string,
): Promise<{ terminal: CommandTerminalSummary }> {
  const response = await fetch(`/api/command-terminals/${encodeURIComponent(terminalId)}/kill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as { terminal: CommandTerminalSummary };
}

export async function killCommandExecution(
  executionId: string,
  sessionId: string,
): Promise<{ execution: ChatCommandExecutionReference }> {
  const response = await fetch(`/api/command-executions/${encodeURIComponent(executionId)}/kill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as { execution: ChatCommandExecutionReference };
}

export async function reloadMcpServers(
  request: McpReloadRequest = {},
): Promise<McpReloadResponse> {
  const hasBody = Object.keys(request).length > 0;
  const response = await fetch("/api/settings/mcp/reload", {
    method: "POST",
    ...(hasBody
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        }
      : {}),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as McpReloadResponse;
}

export async function readMcpResource(
  request: McpResourceReadRequest,
): Promise<McpResourceReadResponse> {
  const response = await fetch("/api/settings/mcp/resources/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as McpResourceReadResponse;
}

export async function getMcpPrompt(
  request: McpPromptGetRequest,
): Promise<McpPromptGetResponse> {
  const response = await fetch("/api/settings/mcp/prompts/get", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as McpPromptGetResponse;
}

export async function updateHistorySettings(
  update: HistorySettingsUpdateRequest,
): Promise<HistorySettingsResponse> {
  const response = await fetch("/api/settings/history", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as HistorySettingsResponse;
}

export async function fetchRichFeatureSettings(): Promise<RichFeatureSettingsResponse> {
  const response = await fetch("/api/settings/rich-features");

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as RichFeatureSettingsResponse;
}

export async function updateRichFeatureSettings(
  update: RichFeatureSettingsUpdateRequest,
): Promise<RichFeatureSettingsResponse> {
  const response = await fetch("/api/settings/rich-features", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as RichFeatureSettingsResponse;
}

export async function fetchSystemSettings(): Promise<SystemSettingsResponse> {
  const response = await fetch("/api/settings/system");

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as SystemSettingsResponse;
}

export async function fetchSystemPromptSettings(): Promise<SystemPromptSettingsResponse> {
  const response = await fetch("/api/settings/system-prompts");

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as SystemPromptSettingsResponse;
}

export async function updateSystemPromptSettings(
  mode: SystemPromptMode,
  update: SystemPromptSettingsUpdateRequest,
): Promise<SystemPromptSettingsResponse> {
  const response = await fetch(`/api/settings/system-prompts/${encodeURIComponent(mode)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as SystemPromptSettingsResponse;
}

export async function updateModelProfile(
  profileId: string,
  update: LlmModelProfileUpdateRequest,
): Promise<LlmModelProfilesResponse> {
  const response = await fetch(`/api/settings/model-profiles/${encodeURIComponent(profileId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as LlmModelProfilesResponse;
}

export async function fetchAgentSessions(
  options: FetchAgentSessionsOptions = {},
): Promise<AgentSessionsResponse> {
  const params = new URLSearchParams();
  const search = options.search?.trim();

  if (typeof options.limit === "number" && Number.isFinite(options.limit)) {
    params.set("limit", String(Math.max(1, Math.floor(options.limit))));
  }

  if (search) {
    params.set("search", search);
  }

  if (options.includeSubAgents === false) {
    params.set("includeSubAgents", "false");
  }

  if (options.includeWorkspaceSessions === false) {
    params.set("includeWorkspaceSessions", "false");
  }

  if (options.excludeScheduledTaskSessions) {
    params.set("excludeScheduledTaskSessions", "true");
  }

  const query = params.toString();
  const response = await fetch(`/api/agent-sessions${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as AgentSessionsResponse;
}

export async function fetchAgentSession(sessionId: string): Promise<AgentSessionDetailResponse> {
  const response = await fetch(`/api/agent-sessions/${encodeURIComponent(sessionId)}`);

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as AgentSessionDetailResponse;
}

export async function createAgentSession(
  request: AgentSessionCreateRequest,
): Promise<AgentSessionSummary> {
  const response = await fetch("/api/agent-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as AgentSessionSummary;
}

export async function duplicateAgentSession(sessionId: string): Promise<AgentSessionSummary> {
  const response = await fetch(`/api/agent-sessions/${encodeURIComponent(sessionId)}/duplicate`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as AgentSessionSummary;
}

export async function renameAgentSession(
  sessionId: string,
  request: AgentSessionRenameRequest,
): Promise<AgentSessionSummary> {
  const response = await fetch(`/api/agent-sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as AgentSessionSummary;
}

export async function autoRenameAgentSession(sessionId: string): Promise<AgentSessionSummary> {
  const response = await fetch(`/api/agent-sessions/${encodeURIComponent(sessionId)}/auto-rename`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as AgentSessionSummary;
}

export async function deleteAgentSession(sessionId: string): Promise<AgentSessionDeleteResponse> {
  const response = await fetch(`/api/agent-sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as AgentSessionDeleteResponse;
}

export async function fetchWorkspaces(): Promise<WorkspacesResponse> {
  const response = await fetch("/api/workspaces");

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as WorkspacesResponse;
}

export async function deleteWorkspaceSessions(
  request: WorkspaceDeleteRequest,
): Promise<WorkspaceDeleteResponse> {
  const response = await fetch("/api/workspaces/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as WorkspaceDeleteResponse;
}

export async function pickWorkspaceDirectory(): Promise<WorkspaceDirectoryPickResponse> {
  const response = await fetch("/api/workspaces/pick-directory", {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as WorkspaceDirectoryPickResponse;
}

export async function launchWorkspaceConversation(
  request: WorkspaceConversationLaunchRequest,
): Promise<WorkspaceConversationLaunchResponse> {
  const response = await fetch("/api/workspaces/launch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as WorkspaceConversationLaunchResponse;
}

export async function fetchScheduledTasks(): Promise<ScheduledTasksResponse> {
  const response = await fetch("/api/scheduled-tasks");

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as ScheduledTasksResponse;
}

export async function fetchScheduledTask(taskId: string): Promise<{ task: ScheduledTaskSummary }> {
  const response = await fetch(`/api/scheduled-tasks/${encodeURIComponent(taskId)}`);

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as { task: ScheduledTaskSummary };
}

export async function createScheduledTask(
  request: ScheduledTaskCreateRequest,
): Promise<{ task: ScheduledTaskSummary }> {
  const response = await fetch("/api/scheduled-tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as { task: ScheduledTaskSummary };
}

export async function updateScheduledTask(
  taskId: string,
  request: ScheduledTaskUpdateRequest,
): Promise<{ task: ScheduledTaskSummary }> {
  const response = await fetch(`/api/scheduled-tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as { task: ScheduledTaskSummary };
}

export async function deleteScheduledTask(taskId: string): Promise<ScheduledTaskDeleteResponse> {
  const response = await fetch(`/api/scheduled-tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as ScheduledTaskDeleteResponse;
}

export async function fetchScheduledTaskRuns(taskId: string): Promise<ScheduledTaskRunsResponse> {
  const response = await fetch(`/api/scheduled-tasks/${encodeURIComponent(taskId)}/runs`);

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as ScheduledTaskRunsResponse;
}

export async function runScheduledTaskNow(taskId: string): Promise<ScheduledTaskRunNowResponse> {
  const response = await fetch(`/api/scheduled-tasks/${encodeURIComponent(taskId)}/run`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as ScheduledTaskRunNowResponse;
}

export async function stopScheduledTask(taskId: string): Promise<ScheduledTaskStopResponse> {
  const response = await fetch(`/api/scheduled-tasks/${encodeURIComponent(taskId)}/stop`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as ScheduledTaskStopResponse;
}

export async function fetchScheduledTaskSessions(
  limit = 10,
): Promise<ScheduledTaskSessionsResponse> {
  const params = new URLSearchParams();

  if (typeof limit === "number" && Number.isFinite(limit)) {
    params.set("limit", String(Math.max(1, Math.floor(limit))));
  }

  const query = params.toString();
  const response = await fetch(`/api/scheduled-tasks/sessions${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as ScheduledTaskSessionsResponse;
}

export async function convertAttachmentFile(file: File): Promise<AttachmentConversionResponse> {
  const formData = new FormData();

  formData.set("file", file);

  const response = await fetch("/api/attachments/convert", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as AttachmentConversionResponse;
}

export async function renderAttachmentFileAsImage(
  file: File,
  options: { confirmLargeBatch?: boolean; pageRange?: string } = {},
): Promise<AttachmentConversionResponse> {
  const formData = new FormData();
  const pageRange = options.pageRange?.trim();

  formData.set("file", file);
  formData.set("confirmLargeBatch", options.confirmLargeBatch ? "true" : "false");

  if (pageRange) {
    formData.set("pageRange", pageRange);
  }

  const response = await fetch("/api/attachments/render-image", {
    method: "POST",
    body: formData,
  });
  const responseText = await response.text();

  if (!response.ok) {
    const body = parseJsonResponse(responseText);

    if (isAttachmentRenderConfirmationRequiredResponse(body)) {
      throw new AttachmentImageConfirmationRequiredError(body);
    }

    throw new Error(apiErrorMessage(body, responseText));
  }

  return JSON.parse(responseText) as AttachmentConversionResponse;
}

function parseJsonResponse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function apiErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const error = (body as Record<string, unknown>).error;

    if (typeof error === "string") {
      return error;
    }
  }

  return fallback;
}

function isAttachmentRenderConfirmationRequiredResponse(
  body: unknown,
): body is AttachmentRenderConfirmationRequiredResponse {
  if (!body || typeof body !== "object") {
    return false;
  }

  const value = body as Partial<AttachmentRenderConfirmationRequiredResponse>;

  return (
    value.confirmationRequired === true &&
    typeof value.error === "string" &&
    typeof value.fileName === "string" &&
    typeof value.pageCount === "number"
  );
}

export async function updateAgentSessionMessage(
  sessionId: string,
  messageId: string,
  request: AgentSessionMessageUpdateRequest | { attachments?: ChatAttachment[]; content: string },
): Promise<StoredChatMessage> {
  const response = await fetch(
    `/api/agent-sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as StoredChatMessage;
}

export async function deleteAgentSessionMessage(
  sessionId: string,
  messageId: string,
): Promise<AgentSessionMessageDeleteResponse> {
  const response = await fetch(
    `/api/agent-sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}`,
    {
      method: "DELETE",
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as AgentSessionMessageDeleteResponse;
}

export async function resolveChatUserChoice(
  requestId: string,
  request: ChatUserChoiceResolutionRequest,
): Promise<ChatUserChoiceResolutionResponse> {
  const response = await fetch(
    `/api/chat/user-choices/${encodeURIComponent(requestId)}/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as ChatUserChoiceResolutionResponse;
}

export async function fetchOrchestrationTimers(
  sessionId: string,
): Promise<OrchestrationTimersResponse> {
  const params = new URLSearchParams({ sessionId });
  const response = await fetch(`/api/orchestration/timers?${params.toString()}`);

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as OrchestrationTimersResponse;
}

export function cancelOrchestrationTimer(
  timerId: string,
  request: OrchestrationTimerActionRequest,
): Promise<OrchestrationTimerActionResponse> {
  return postOrchestrationTimerAction(timerId, "cancel", request);
}

export function extendOrchestrationTimer(
  timerId: string,
  request: OrchestrationTimerActionRequest,
): Promise<OrchestrationTimerActionResponse> {
  return postOrchestrationTimerAction(timerId, "extend", request);
}

export function fireOrchestrationTimer(
  timerId: string,
  request: OrchestrationTimerActionRequest,
): Promise<OrchestrationTimerActionResponse> {
  return postOrchestrationTimerAction(timerId, "fire", request);
}

async function postOrchestrationTimerAction(
  timerId: string,
  action: "cancel" | "extend" | "fire",
  request: OrchestrationTimerActionRequest,
): Promise<OrchestrationTimerActionResponse> {
  const response = await fetch(
    `/api/orchestration/timers/${encodeURIComponent(timerId)}/${action}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as OrchestrationTimerActionResponse;
}

export async function sendChatMessage(
  request: ChatRequest,
  options: ChatStreamOptions = {},
): Promise<ChatResponse> {
  const result: { finalEvent: Extract<ChatStreamEvent, { type: "done" }> | null } = {
    finalEvent: null,
  };

  await streamChatMessage(
    request,
    {
      onDone: (event) => {
        result.finalEvent = event;
      },
      onError: (event) => {
        throw new Error(event.error);
      },
    },
    options,
  );

  const finalEvent = result.finalEvent;

  if (!finalEvent) {
    throw new Error("The chat stream ended before returning a final message.");
  }

  return {
    sessionId: finalEvent.sessionId,
    message: finalEvent.message,
    providerId: finalEvent.providerId,
    providerLabel: finalEvent.providerLabel,
    modelId: finalEvent.modelId,
    thinking: finalEvent.thinking,
    title: finalEvent.title,
  };
}

export async function streamChatMessage(
  request: ChatRequest,
  handlers: ChatStreamHandlers,
  options: ChatStreamOptions = {},
): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      Accept: "application/x-ndjson",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  if (!response.body) {
    throw new Error("The chat stream did not return a response body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    buffer = dispatchStreamLines(buffer, handlers);
  }

  buffer += decoder.decode();
  dispatchStreamLines(`${buffer}\n`, handlers);
}

function dispatchStreamLines(buffer: string, handlers: ChatStreamHandlers): string {
  const lines = buffer.split(/\r?\n/);
  const remainder = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    const event = parseChatStreamEventLine(line);

    if (!event) {
      handlers.onError?.({
        type: "error",
        error: "The chat stream returned an invalid event.",
      });
      continue;
    }

    if (event.type === "start") {
      handlers.onStart?.(event);
      continue;
    }

    if (event.type === "content_delta") {
      handlers.onContentDelta?.(event);
      continue;
    }

    if (event.type === "thinking_delta") {
      handlers.onThinkingDelta?.(event);
      continue;
    }

    if (event.type === "tool_call") {
      handlers.onToolCall?.(event);
      continue;
    }

    if (event.type === "assistant_message") {
      handlers.onAssistantMessage?.(event);
      continue;
    }

    if (event.type === "sub_agent.spawned") {
      handlers.onSubAgentSpawned?.(event);
      continue;
    }

    if (event.type === "sub_agent.status") {
      handlers.onSubAgentStatus?.(event);
      continue;
    }

    if (event.type === "sub_agent.delta") {
      handlers.onSubAgentDelta?.(event);
      continue;
    }

    if (event.type === "sub_agent.thinking_delta") {
      handlers.onSubAgentThinkingDelta?.(event);
      continue;
    }

    if (event.type === "sub_agent.tool_call") {
      handlers.onSubAgentToolCall?.(event);
      continue;
    }

    if (event.type === "sub_agent.message") {
      handlers.onSubAgentMessage?.(event);
      continue;
    }

    if (event.type === "user_choice_request") {
      if (handlers.onUserChoiceRequest) {
        handlers.onUserChoiceRequest(event);
      } else {
        void resolveChatUserChoice(event.request.id, { cancelled: true }).catch((caught) => {
          console.warn("[chat] Failed to auto-cancel user choice request.", caught);
        });
      }
      continue;
    }

    if (event.type === "done") {
      handlers.onDone?.(event);
      continue;
    }

    handlers.onError?.(event);
  }

  return remainder;
}

function parseChatStreamEventLine(line: string): ChatStreamEvent | null {
  try {
    const event = JSON.parse(line) as unknown;

    if (!event || typeof event !== "object") {
      throw new Error("Missing stream event type.");
    }

    const type = (event as { type?: unknown }).type;

    if (
      type !== "start" &&
      type !== "content_delta" &&
      type !== "thinking_delta" &&
      type !== "tool_call" &&
      type !== "assistant_message" &&
      type !== "sub_agent.spawned" &&
      type !== "sub_agent.status" &&
      type !== "sub_agent.delta" &&
      type !== "sub_agent.thinking_delta" &&
      type !== "sub_agent.tool_call" &&
      type !== "sub_agent.message" &&
      type !== "user_choice_request" &&
      type !== "done" &&
      type !== "error"
    ) {
      throw new Error("Unknown stream event type.");
    }

    return event as ChatStreamEvent;
  } catch (caught) {
    console.warn("[chat] Failed to parse stream event.", caught, line);
    return null;
  }
}

export async function updateSetup(
  update: FirstRunSetupUpdateRequest,
): Promise<FirstRunSetupResponse> {
  const response = await fetch("/api/setup", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as FirstRunSetupResponse;
}

export async function fetchSetupLocation(): Promise<SetupLocationLookupResponse> {
  const response = await fetch("/api/setup/location", {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as SetupLocationLookupResponse;
}
