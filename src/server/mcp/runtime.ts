import type {
  ChatToolSettings,
  ChatToolCallProgress,
  McpDiscoverySummary,
  McpPromptCapability,
  McpPromptGetResponse,
  McpResourceCapability,
  McpResourceContent,
  McpServerCapabilities,
  McpServerConnectionSummary,
  McpToolCapability,
} from "../../shared/protocol.ts";
import { Buffer } from "node:buffer";
import type { LlmToolDefinition } from "../llm/chat-completions.ts";
import type { TrussHome } from "../setup/truss-home.ts";
import type { FilesystemDirectoryGrantsRepository } from "../storage/filesystem-directory-grants.ts";
import type { McpSettingsRepository } from "../storage/mcp-settings.ts";
import { createId } from "../utils/id.ts";
import { messageFromUnknown } from "../utils/logging.ts";
import {
  McpClientHost,
  type McpClientNotification,
  type McpConnection,
  type McpProgressNotification,
} from "./client.ts";
import { negotiateMcpCapabilities } from "./capability-negotiation.ts";
import {
  combineMcpLoaderResults,
  loaderSourceSummaries,
  loadWorkspaceMcpServers,
} from "./discovery.ts";
import { ensureGlobalMcpConfig, loadGlobalMcpServers } from "./global-config.ts";
import {
  annotateMcpStdioApprovals,
  approveMcpStdioServers,
  type McpStdioApprovalSummary,
} from "./stdio-approval.ts";
import type { McpLoaderResult, McpServerDefinition } from "./types.ts";

export interface CreateMcpRuntimeOptions {
  conversationWorkspacePath: string | null;
  env: NodeJS.ProcessEnv;
  managedBrowserEnv?: NodeJS.ProcessEnv;
  filesystemGrants?: FilesystemDirectoryGrantsRepository;
  mcpSettings?: McpSettingsRepository;
  onOrchestrationTimerFired?(event: OrchestrationTimerFiredNotification): void | Promise<void>;
  onSummaryChange?: (summary: McpDiscoverySummary) => void;
  projectRoot: string;
  trussHome: TrussHome;
  workspacePath: string;
}

export interface McpToolFilterOptions {
  allowedServerIds?: string[] | null;
}

export interface OrchestrationTimerFiredNotification {
  firedAt: string;
  label?: string;
  lengthSeconds?: number;
  message: string;
  sessionId: string;
  timerId: string;
}

export interface McpToolBinding {
  definition: LlmToolDefinition;
  serverId: string;
  serverName: string;
  toolName: string;
}

interface ConnectedMcpServer {
  capabilities: McpServerCapabilities;
  connection: McpConnection;
  definition: McpServerDefinition;
}

interface FailedMcpServer {
  definition: McpServerDefinition;
  error: string;
}

const defaultMcpToolCallTimeoutMs = 90_000;
const trussWebToolsToolCallTimeoutMs = 240_000;
const mcpResourceReadMaxBytes = 10 * 1024 * 1024;
const mcpPromptGetMaxBytes = 1024 * 1024;

export class McpRuntime {
  readonly #bindingsByLlmName = new Map<string, McpToolBinding>();
  readonly #connectedServersById = new Map<string, ConnectedMcpServer>();
  readonly #connectingServerIds = new Set<string>();
  readonly #failedServersById = new Map<string, FailedMcpServer>();
  readonly #connectTasks: Promise<void>[] = [];
  #closed = false;
  summary: McpDiscoverySummary;

  constructor(
    readonly host: McpClientHost,
    readonly loaderResult: McpLoaderResult,
    readonly trussHome: TrussHome,
    readonly onSummaryChange?: (summary: McpDiscoverySummary) => void,
  ) {
    for (const definition of loaderResult.servers) {
      if (!definition.disabled) {
        this.#connectingServerIds.add(definition.id);
      }
    }

    this.summary = this.#createSummary();
  }

  getToolDefinitions(
    settings?: ChatToolSettings,
    options: McpToolFilterOptions = {},
  ): LlmToolDefinition[] {
    return [...this.#bindingsByLlmName.values()]
      .filter((binding) => mcpToolEnabled(binding, settings, options))
      .map((binding) => binding.definition);
  }

  resolveTool(
    llmToolName: string,
    settings?: ChatToolSettings,
    options: McpToolFilterOptions = {},
  ): McpToolBinding | null {
    const binding = this.#bindingsByLlmName.get(llmToolName) ?? null;

    return binding && mcpToolEnabled(binding, settings, options) ? binding : null;
  }

  async callTool({
    args,
    binding,
    meta,
    onProgress,
    signal,
  }: {
    args: Record<string, unknown>;
    binding: McpToolBinding;
    meta?: Record<string, unknown>;
    onProgress?: (progress: ChatToolCallProgress) => void;
    signal?: AbortSignal;
  }): Promise<string> {
    const connection = this.host.get(binding.serverId);

    if (!connection) {
      throw new Error(`MCP server "${binding.serverName}" is not connected.`);
    }

    const requestMeta = mcpRequestMetaWithProgress(meta, onProgress);
    const result = await connection.request(
      "tools/call",
      {
        name: binding.toolName,
        arguments: args,
        ...(requestMeta ? { _meta: requestMeta } : {}),
      },
      mcpToolCallTimeoutMs(binding),
      signal,
      {
        onProgress: (progress) => {
          const normalized = normalizeMcpProgress(progress);

          if (normalized) {
            onProgress?.(normalized);
          }
        },
      },
    );

    return mcpToolResultToText(result);
  }

  async callToolByServerName({
    args,
    meta,
    serverName,
    signal,
    timeoutMs = 90_000,
    toolName,
  }: {
    args: Record<string, unknown>;
    meta?: Record<string, unknown>;
    serverName: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    toolName: string;
  }): Promise<string> {
    const result = await this.#requestToolByServerName({
      args,
      meta,
      serverName,
      signal,
      timeoutMs,
      toolName,
    });

    return mcpToolResultToText(result);
  }

  async callToolStructuredByServerName({
    args,
    meta,
    serverName,
    signal,
    timeoutMs = 90_000,
    toolName,
  }: {
    args: Record<string, unknown>;
    meta?: Record<string, unknown>;
    serverName: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    toolName: string;
  }): Promise<unknown> {
    const result = await this.#requestToolByServerName({
      args,
      meta,
      serverName,
      signal,
      timeoutMs,
      toolName,
    });

    return mcpToolResultToStructuredContent(result);
  }

  async #requestToolByServerName({
    args,
    meta,
    serverName,
    signal,
    timeoutMs,
    toolName,
  }: {
    args: Record<string, unknown>;
    meta?: Record<string, unknown>;
    serverName: string;
    signal?: AbortSignal;
    timeoutMs: number;
    toolName: string;
  }): Promise<unknown> {
    const server = this.#connectedServersInDefinitionOrder().find(
      (candidate) =>
        candidate.definition.name === serverName &&
        candidate.capabilities.tools.some((tool) => tool.name === toolName),
    );

    if (!server) {
      throw new Error(`MCP tool "${toolName}" is not connected on "${serverName}".`);
    }

    const result = await server.connection.request(
      "tools/call",
      {
        name: toolName,
        arguments: args,
        ...(meta ? { _meta: meta } : {}),
      },
      timeoutMs,
      signal,
    );
    return result;
  }

  async readResource({
    serverId,
    uri,
  }: {
    serverId: string;
    uri: string;
  }): Promise<McpResourceContent[]> {
    const normalizedServerId = serverId.trim();
    const normalizedUri = uri.trim();

    if (!normalizedServerId) {
      throw new Error("MCP server ID is required.");
    }

    if (!normalizedUri) {
      throw new Error("MCP resource URI is required.");
    }

    const server = this.#connectedServersById.get(normalizedServerId);

    if (!server) {
      throw new Error(`MCP server "${normalizedServerId}" is not connected.`);
    }

    if (!server.capabilities.resources.some((resource) => resource.uri === normalizedUri)) {
      throw new Error(
        `MCP resource "${normalizedUri}" is not advertised by "${server.definition.name}".`,
      );
    }

    const result = await server.connection.request(
      "resources/read",
      { uri: normalizedUri },
      90_000,
    );

    assertMcpResourceReadResultSize(result, normalizedUri);
    return mcpResourceReadResultToContents(result, normalizedUri);
  }

  async getPrompt({
    arguments: promptArguments = {},
    name,
    serverId,
  }: {
    arguments?: Record<string, string>;
    name: string;
    serverId: string;
  }): Promise<McpPromptGetResponse> {
    const normalizedServerId = serverId.trim();
    const normalizedName = name.trim();

    if (!normalizedServerId) {
      throw new Error("MCP server ID is required.");
    }

    if (!normalizedName) {
      throw new Error("MCP prompt name is required.");
    }

    const server = this.#connectedServersById.get(normalizedServerId);

    if (!server) {
      throw new Error(`MCP server "${normalizedServerId}" is not connected.`);
    }

    if (!server.capabilities.prompts.some((prompt) => prompt.name === normalizedName)) {
      throw new Error(
        `MCP prompt "${normalizedName}" is not advertised by "${server.definition.name}".`,
      );
    }

    const result = await server.connection.request(
      "prompts/get",
      {
        name: normalizedName,
        ...(Object.keys(promptArguments).length > 0 ? { arguments: promptArguments } : {}),
      },
      90_000,
    );

    assertMcpPromptGetResultSize(result, normalizedName);
    return mcpPromptGetResultToResponse(result);
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    await this.host.close();
  }

  async waitUntilSettled(): Promise<void> {
    if (this.#connectTasks.length === 0) {
      return;
    }

    await Promise.allSettled(this.#connectTasks);
  }

  get connectedServers(): ConnectedMcpServer[] {
    return this.#connectedServersInDefinitionOrder();
  }

  startConnecting(): void {
    if (this.#connectTasks.length > 0) {
      return;
    }

    for (const definition of this.loaderResult.servers.filter((server) => !server.disabled)) {
      this.#connectTasks.push(this.#connectServer(definition));
    }

    this.#publishSummary();
  }

  async #connectServer(definition: McpServerDefinition): Promise<void> {
    let connection: McpConnection | null = null;

    try {
      connection = await this.host.connect(definition);

      if (this.#closed) {
        await closeMcpConnection(this.host, definition.id);
        return;
      }

      const negotiation = await negotiateMcpCapabilities(definition.id, connection);

      if (this.#closed) {
        await closeMcpConnection(this.host, definition.id);
        return;
      }

      this.#connectingServerIds.delete(definition.id);
      this.#failedServersById.delete(definition.id);
      this.#connectedServersById.set(definition.id, {
        capabilities: negotiation.capabilities,
        connection,
        definition,
      });
      this.#refreshSummary();
    } catch (caught) {
      if (connection) {
        await closeMcpConnection(this.host, definition.id);
      }

      if (this.#closed) {
        return;
      }

      this.#connectingServerIds.delete(definition.id);
      this.#connectedServersById.delete(definition.id);
      this.#failedServersById.set(definition.id, {
        definition,
        error: messageFromUnknown(caught),
      });
      this.#refreshSummary();
    }
  }

  #refreshSummary(): void {
    const bindings = createToolBindings(this.#connectedServersInDefinitionOrder());

    this.#bindingsByLlmName.clear();
    for (const binding of bindings) {
      this.#bindingsByLlmName.set(binding.definition.name, binding);
    }

    this.summary = this.#createSummary(bindings);
    this.#publishSummary();
  }

  #publishSummary(): void {
    if (this.#closed) {
      return;
    }

    this.onSummaryChange?.(this.summary);
  }

  #createSummary(bindings: McpToolBinding[] = []): McpDiscoverySummary {
    return createMcpSummary({
      bindings,
      connectedServers: this.#connectedServersInDefinitionOrder(),
      connectingServers: this.#connectingDefinitionsInDefinitionOrder(),
      failedServers: this.#failedServersInDefinitionOrder(),
      loaderResult: this.loaderResult,
      trussHome: this.trussHome,
    });
  }

  #connectedServersInDefinitionOrder(): ConnectedMcpServer[] {
    return this.loaderResult.servers.flatMap((definition) => {
      const server = this.#connectedServersById.get(definition.id);

      return server ? [server] : [];
    });
  }

  #connectingDefinitionsInDefinitionOrder(): McpServerDefinition[] {
    return this.loaderResult.servers.filter((definition) =>
      this.#connectingServerIds.has(definition.id),
    );
  }

  #failedServersInDefinitionOrder(): FailedMcpServer[] {
    return this.loaderResult.servers.flatMap((definition) => {
      const server = this.#failedServersById.get(definition.id);

      return server ? [server] : [];
    });
  }
}

function mcpToolEnabled(
  binding: McpToolBinding,
  settings?: ChatToolSettings,
  options: McpToolFilterOptions = {},
): boolean {
  if (options.allowedServerIds) {
    const allowedServerIds = new Set(options.allowedServerIds);

    if (!allowedServerIds.has(binding.serverId)) {
      return false;
    }
  }

  if (!settings) {
    return true;
  }

  if ((settings.disabledMcpServerIds ?? []).includes(binding.serverId)) {
    return false;
  }

  return !(settings.disabledMcpTools?.[binding.serverId] ?? []).includes(binding.toolName);
}

function mcpRequestMetaWithProgress(
  meta: Record<string, unknown> | undefined,
  onProgress: ((progress: ChatToolCallProgress) => void) | undefined,
): Record<string, unknown> | undefined {
  if (!onProgress) {
    return meta;
  }

  return {
    ...(meta ?? {}),
    progressToken: createId("mcp_progress"),
  };
}

function mcpToolCallTimeoutMs(binding: McpToolBinding): number {
  return binding.serverName === "Truss Web Tools"
    ? trussWebToolsToolCallTimeoutMs
    : defaultMcpToolCallTimeoutMs;
}

function normalizeMcpProgress(progress: McpProgressNotification): ChatToolCallProgress | null {
  const rawPercent =
    typeof progress.total === "number" && progress.total > 0
      ? (progress.progress / progress.total) * 100
      : progress.progress;

  if (!Number.isFinite(rawPercent)) {
    return null;
  }

  const percent = Math.max(0, Math.min(100, Math.round(rawPercent)));
  const message = progress.message?.replace(/\s+/g, " ").trim();

  return {
    ...(message ? { message: message.length > 160 ? `${message.slice(0, 157)}...` : message } : {}),
    percent,
  };
}

export async function createMcpRuntime(
  options: CreateMcpRuntimeOptions,
): Promise<McpRuntime> {
  const host = new McpClientHost({
    env: options.env,
    managedBrowserEnv: options.managedBrowserEnv,
    onNotification: (notification) => handleMcpClientNotification(notification, options),
  });
  const loaderResult = await loadRuntimeMcpServers(options);
  const runtime = new McpRuntime(
    host,
    loaderResult,
    options.trussHome,
    options.onSummaryChange,
  );

  runtime.startConnecting();
  return runtime;
}

export async function loadRuntimeMcpServers(
  options: Omit<CreateMcpRuntimeOptions, "env" | "onSummaryChange">,
): Promise<McpLoaderResult> {
  return annotateMcpStdioApprovals(await loadRawRuntimeMcpServers(options), options.trussHome);
}

export async function approveCurrentMcpStdioServers(
  options: Omit<CreateMcpRuntimeOptions, "env" | "onSummaryChange">,
): Promise<McpStdioApprovalSummary[]> {
  const loaderResult = await loadRawRuntimeMcpServers(options);

  return approveMcpStdioServers(options.trussHome, loaderResult.servers);
}

async function loadRawRuntimeMcpServers(
  options: Omit<CreateMcpRuntimeOptions, "env" | "onSummaryChange">,
): Promise<McpLoaderResult> {
  await ensureGlobalMcpConfig(options);

  const globalResult = await loadGlobalMcpServers(options.trussHome);

  if (!options.conversationWorkspacePath) {
    return globalResult;
  }

  const workspaceResult = await loadWorkspaceMcpServers(options.conversationWorkspacePath);

  return combineMcpLoaderResults([globalResult, workspaceResult], "truss-runtime");
}

function handleMcpClientNotification(
  notification: McpClientNotification,
  options: CreateMcpRuntimeOptions,
): void {
  if (notification.method !== "truss/orchestration_timer_fired") {
    return;
  }

  const payload = orchestrationTimerFiredNotification(notification.params);

  if (!payload) {
    return;
  }

  void options.onOrchestrationTimerFired?.(payload);
}

function orchestrationTimerFiredNotification(
  value: unknown,
): OrchestrationTimerFiredNotification | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const source = value as Record<string, unknown>;
  const firedAt = typeof source.firedAt === "string" ? source.firedAt : "";
  const message = typeof source.message === "string" ? source.message : "";
  const sessionId = typeof source.sessionId === "string" ? source.sessionId : "";
  const timerId = typeof source.timerId === "string" ? source.timerId : "";
  const lengthSeconds =
    typeof source.lengthSeconds === "number" && Number.isFinite(source.lengthSeconds)
      ? source.lengthSeconds
      : undefined;

  if (!firedAt || !message || !sessionId || !timerId) {
    return null;
  }

  const label = typeof source.label === "string" && source.label.trim()
    ? source.label.trim()
    : undefined;

  return {
    firedAt,
    ...(label ? { label } : {}),
    ...(lengthSeconds ? { lengthSeconds } : {}),
    message,
    sessionId,
    timerId,
  };
}

function createToolBindings(servers: ConnectedMcpServer[]): McpToolBinding[] {
  const usedNames = new Set<string>();
  const bindings: McpToolBinding[] = [];

  for (const server of servers) {
    for (const tool of server.capabilities.tools) {
      const llmName = llmToolNameForMcpTool(server, tool, usedNames);

      usedNames.add(llmName);
      bindings.push({
        definition: {
          name: llmName,
          description: toolDescription(server, tool),
          parameters: tool.inputSchema ?? {
            type: "object",
            additionalProperties: true,
          },
        },
        serverId: server.definition.id,
        serverName: server.definition.name,
        toolName: tool.name,
      });
    }
  }

  return bindings;
}

function llmToolNameForMcpTool(
  server: ConnectedMcpServer,
  tool: McpToolCapability,
  usedNames: Set<string>,
): string {
  const directName = sanitizeToolName(tool.name);

  if (directName && directName === tool.name && !usedNames.has(directName)) {
    return directName;
  }

  const serverName = sanitizeToolName(server.definition.name) || "server";
  const toolName = directName || "tool";
  const base = `mcp__${serverName}__${toolName}`.slice(0, 64);
  let candidate = base;
  let suffix = 2;

  while (usedNames.has(candidate)) {
    const nextSuffix = `_${suffix}`;

    candidate = `${base.slice(0, 64 - nextSuffix.length)}${nextSuffix}`;
    suffix += 1;
  }

  return candidate;
}

function sanitizeToolName(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function toolDescription(server: ConnectedMcpServer, tool: McpToolCapability): string {
  const description = tool.description?.trim();

  if (server.definition.name === "Truss Web Tools") {
    return description || `Truss Web Tools MCP tool: ${tool.name}`;
  }

  return description
    ? `${description} Provided by MCP server "${server.definition.name}".`
    : `MCP tool "${tool.name}" provided by "${server.definition.name}".`;
}

function createMcpSummary({
  bindings,
  connectedServers,
  connectingServers,
  failedServers,
  loaderResult,
  trussHome,
}: {
  bindings: McpToolBinding[];
  connectedServers: ConnectedMcpServer[];
  connectingServers: McpServerDefinition[];
  failedServers: FailedMcpServer[];
  loaderResult: McpLoaderResult;
  trussHome: TrussHome;
}): McpDiscoverySummary {
  const connectedById = new Map(
    connectedServers.map((server) => [server.definition.id, server] as const),
  );
  const failedById = new Map(
    failedServers.map((server) => [server.definition.id, server] as const),
  );
  const connectingIds = new Set(connectingServers.map((server) => server.id));
  const servers: McpServerConnectionSummary[] = loaderResult.servers.map((definition) => {
    if (definition.disabled) {
      return disabledServerSummary(definition);
    }

    const connected = connectedById.get(definition.id);

    if (connected) {
      return connectedServerSummary(connected);
    }

    const failed = failedById.get(definition.id);

    if (failed) {
      return failedServerSummary(failed);
    }

    if (connectingIds.has(definition.id)) {
      return connectingServerSummary(definition);
    }

    return connectingServerSummary(definition);
  });

  return {
    availableTools: bindings.length,
    configPath: trussHome.mcpConfigPath,
    connectedServers: connectedServers.length,
    connectingServers: connectingServers.length,
    discoveredServers: loaderResult.servers.length,
    failedServers: failedServers.length,
    servers,
    sources: [
      ...loaderSourceSummaries(loaderResult),
    ],
  };
}

function connectedServerSummary(server: ConnectedMcpServer): McpServerConnectionSummary {
  return {
    ...server.capabilities,
    configPath: server.definition.configPath,
    connected: true,
    source: server.definition.source,
    status: "connected",
    trussManaged: server.definition.trussManaged,
    transport: server.definition.transport,
  };
}

function connectingServerSummary(definition: McpServerDefinition): McpServerConnectionSummary {
  return {
    configPath: definition.configPath,
    connected: false,
    name: definition.name,
    prompts: [] satisfies McpPromptCapability[],
    resources: [] satisfies McpResourceCapability[],
    serverId: definition.id,
    source: definition.source,
    status: "connecting",
    tools: [] satisfies McpToolCapability[],
    trussManaged: definition.trussManaged,
    transport: definition.transport,
  };
}

function disabledServerSummary(definition: McpServerDefinition): McpServerConnectionSummary {
  return {
    configPath: definition.configPath,
    connected: false,
    disabledReason: definition.disabledReason,
    name: definition.name,
    prompts: [] satisfies McpPromptCapability[],
    resources: [] satisfies McpResourceCapability[],
    serverId: definition.id,
    source: definition.source,
    status: "disabled",
    tools: [] satisfies McpToolCapability[],
    trussManaged: definition.trussManaged,
    transport: definition.transport,
  };
}

function failedServerSummary(server: FailedMcpServer): McpServerConnectionSummary {
  return {
    configPath: server.definition.configPath,
    connected: false,
    error: server.error,
    name: server.definition.name,
    prompts: [] satisfies McpPromptCapability[],
    resources: [] satisfies McpResourceCapability[],
    serverId: server.definition.id,
    source: server.definition.source,
    status: "failed",
    tools: [] satisfies McpToolCapability[],
    trussManaged: server.definition.trussManaged,
    transport: server.definition.transport,
  };
}

async function closeMcpConnection(host: McpClientHost, serverId: string): Promise<void> {
  try {
    await host.close(serverId);
  } catch (caught) {
    console.warn("Failed to close MCP connection:", caught);
  }
}

function mcpToolResultToText(result: unknown): string {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return JSON.stringify(result ?? null);
  }

  const source = result as Record<string, unknown>;
  const content = Array.isArray(source.content) ? source.content : [];
  const parts = content
    .map((item) => mcpContentItemToText(item))
    .filter((item): item is string => Boolean(item));
  const structuredText =
    source.structuredContent === undefined ? "" : stringifyMcpPayload(source.structuredContent);
  const text = parts.join("\n\n").trim() || structuredText || stringifyMcpPayload(result);

  if (source.isError === true) {
    throw new Error(text || "MCP tool returned an error without content.");
  }

  return text;
}

function mcpToolResultToStructuredContent(result: unknown): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result ?? null;
  }

  const source = result as Record<string, unknown>;
  const text = mcpToolResultToText({ ...source, isError: false });

  if (source.isError === true) {
    throw new Error(text || "MCP tool returned an error without content.");
  }

  if (Object.hasOwn(source, "structuredContent")) {
    return source.structuredContent;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function mcpResourceReadResultToContents(
  result: unknown,
  fallbackUri: string,
): McpResourceContent[] {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return [];
  }

  const contents = (result as Record<string, unknown>).contents;

  if (!Array.isArray(contents)) {
    return [];
  }

  return contents.flatMap((item) => mcpResourceContentItem(item, fallbackUri));
}

function assertMcpResourceReadResultSize(result: unknown, uri: string): void {
  const bytes = estimateJsonPayloadBytes(result, mcpResourceReadMaxBytes);

  if (bytes > mcpResourceReadMaxBytes) {
    throw new Error(
      `MCP resource "${uri}" exceeded the ${mcpResourceReadMaxBytes} byte read limit.`,
    );
  }
}

function assertMcpPromptGetResultSize(result: unknown, name: string): void {
  const bytes = estimateJsonPayloadBytes(result, mcpPromptGetMaxBytes);

  if (bytes > mcpPromptGetMaxBytes) {
    throw new Error(
      `MCP prompt "${name}" exceeded the ${mcpPromptGetMaxBytes} byte read limit.`,
    );
  }
}

function estimateJsonPayloadBytes(
  value: unknown,
  limit: number,
  seen = new WeakSet<object>(),
): number {
  if (value === null || value === undefined) {
    return 4;
  }

  if (typeof value === "string") {
    return Buffer.byteLength(value, "utf8") + 2;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).length;
  }

  if (typeof value !== "object") {
    return 0;
  }

  if (seen.has(value)) {
    return 0;
  }

  seen.add(value);

  let bytes = Array.isArray(value) ? 2 : 2;

  if (Array.isArray(value)) {
    for (const item of value) {
      bytes += 1 + estimateJsonPayloadBytes(item, limit - bytes, seen);

      if (bytes > limit) {
        return bytes;
      }
    }

    return bytes;
  }

  for (const [key, item] of Object.entries(value)) {
    bytes += Buffer.byteLength(key, "utf8") + 3;
    bytes += estimateJsonPayloadBytes(item, limit - bytes, seen);

    if (bytes > limit) {
      return bytes;
    }
  }

  return bytes;
}

function mcpResourceContentItem(
  item: unknown,
  fallbackUri: string,
): McpResourceContent[] {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return [];
  }

  const source = item as Record<string, unknown>;
  const text = typeof source.text === "string" ? source.text : undefined;
  const blob = typeof source.blob === "string" ? source.blob : undefined;

  if (text === undefined && blob === undefined) {
    return [];
  }

  return [
    {
      ...(blob !== undefined ? { blob } : {}),
      ...(typeof source.mimeType === "string" ? { mimeType: source.mimeType } : {}),
      ...(text !== undefined ? { text } : {}),
      uri: typeof source.uri === "string" && source.uri.trim() ? source.uri.trim() : fallbackUri,
    },
  ];
}

function mcpContentItemToText(item: unknown): string | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }

  const source = item as Record<string, unknown>;

  if (source.type === "text" && typeof source.text === "string") {
    return source.text;
  }

  return JSON.stringify(source);
}

function mcpPromptGetResultToResponse(result: unknown): McpPromptGetResponse {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return {
      messages: [],
      text: "",
    };
  }

  const source = result as Record<string, unknown>;
  const messages = Array.isArray(source.messages)
    ? source.messages.flatMap(mcpPromptMessageItem)
    : [];

  return {
    ...(typeof source.description === "string" && source.description.trim()
      ? { description: source.description.trim() }
      : {}),
    messages,
    text: promptMessagesToTextareaText(messages),
  };
}

function mcpPromptMessageItem(item: unknown): McpPromptGetResponse["messages"] {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return [];
  }

  const source = item as Record<string, unknown>;
  const content = mcpPromptMessageContent(source.content);
  const text = mcpPromptMessageContentText(content);

  if (!text) {
    return [];
  }

  return [
    {
      content,
      role: typeof source.role === "string" && source.role.trim() ? source.role.trim() : "user",
      text,
    },
  ];
}

function mcpPromptMessageContent(
  item: unknown,
): McpPromptGetResponse["messages"][number]["content"] {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return {};
  }

  const source = item as Record<string, unknown>;

  return {
    ...(typeof source.blob === "string" ? { blob: source.blob } : {}),
    ...(typeof source.mimeType === "string" ? { mimeType: source.mimeType } : {}),
    ...(typeof source.text === "string" ? { text: source.text } : {}),
    ...(typeof source.type === "string" ? { type: source.type } : {}),
    ...(typeof source.uri === "string" ? { uri: source.uri } : {}),
  };
}

function mcpPromptMessageContentText(
  content: McpPromptGetResponse["messages"][number]["content"],
): string {
  if (typeof content.text === "string") {
    return content.text.trim();
  }

  if (typeof content.blob === "string") {
    return `[${content.mimeType ?? content.type ?? "binary"} prompt content omitted]`;
  }

  return "";
}

function promptMessagesToTextareaText(messages: McpPromptGetResponse["messages"]): string {
  if (messages.length === 0) {
    return "";
  }

  if (messages.length === 1) {
    return messages[0]?.text ?? "";
  }

  return messages
    .map((message) => `${capitalizePromptRole(message.role)}:\n${message.text}`)
    .join("\n\n");
}

function capitalizePromptRole(role: string): string {
  if (!role) {
    return "Message";
  }

  return `${role.slice(0, 1).toUpperCase()}${role.slice(1)}`;
}

function stringifyMcpPayload(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
