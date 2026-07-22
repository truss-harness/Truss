import type {
  ApiError,
  FileAccessDirectoryUpdate,
  FileAccessSecurityResponse,
  FileAccessSecurityUpdateRequest,
  FileAccessWorkspaceTreeResponse,
  HistorySettingsResponse,
  HistorySettingsUpdateRequest,
  LlmGenerationParameters,
  LlmModelCatalogDefault,
  LlmModelCatalogs,
  LlmModelCatalogsResponse,
  LlmModelProfileId,
  LlmProviderSecretSummary,
  LlmProviderModelsRequest,
  LlmProviderModelsResponse,
  LlmProviderSettingsResponse,
  LlmProviderSettingsUpdateRequest,
  McpPromptGetRequest,
  McpPromptGetResponse,
  McpReloadResponse,
  McpReloadRequest,
  McpResourceReadRequest,
  McpResourceReadResponse,
  McpSettingsResponse,
  McpSettingsUpdateRequest,
  PlantUmlRenderFormat,
  RichFeatureSettingsResponse,
  RichFeatureSettingsUpdateRequest,
  SettingsResponse,
  SettingsUpdateRequest,
  SystemPromptSettingsResponse,
  SystemPromptSettingsUpdateRequest,
  SystemSettingsResponse,
} from "../../shared/protocol.ts";
import {
  ensureGlobalMcpConfig,
  restoreGlobalMcpManagedServer,
} from "../mcp/global-config.ts";
import { writeGlobalMcpConfigText } from "../mcp/config-write.ts";
import { approveCurrentMcpStdioServers } from "../mcp/runtime.ts";
import { getLlmProvider } from "../llm/registry.ts";
import {
  getDefaultSystemPromptTemplate,
  isSystemPromptMode,
  renderSystemPromptTemplate,
  systemPromptLabels,
  systemPromptPlaceholders,
} from "../prompts/system-prompts.ts";
import {
  fileAccessSettingsResponse,
  updateStoredFileAccessSettings,
} from "../security/file-access.ts";
import { inspectFileAccessWorkspaceTree } from "../security/file-access-inspection.ts";
import { skillFilesystemAccessDirectories } from "../skills/discovery.ts";
import type { HistorySettingsUpdate } from "../storage/history-settings.ts";
import type { RichFeatureSettingsUpdate } from "../storage/rich-feature-settings.ts";
import type { LlmProviderSettingsUpdate } from "../storage/settings.ts";
import { json, readJson } from "./responses.ts";
import type { ServerContext } from "./context.ts";
import { createId } from "../utils/id.ts";
import { now } from "../utils/time.ts";

const maxSecretLength = 20_000;
const maxMcpConfigLength = 200_000;
const mcpSecretEnvPrefix = "TRUSS_MCP_";
const maxSystemPromptLength = 40_000;
const maxPlantUmlPromptLength = 12_000;
const maxPlantUmlServerUrlLength = 300;
const maxReasoningTimeSeconds = 86_400;
const maxReasoningWords = 1_000_000;
const maxAgenticToolTurnLimit = 100_000;
const maxModelCount = 100;
const maxModelLength = 160;
const modelCatalogsTimeoutMs = 10_000;
const providerModelsTimeoutMs = 15_000;
const providerCatalogUrls: Record<string, string> = {
  openai:
    "https://raw.githubusercontent.com/truss-harness/default-models/refs/heads/main/openai.json",
  openrouter:
    "https://raw.githubusercontent.com/truss-harness/default-models/refs/heads/main/openrouter.json",
};
const modelProfileIds: LlmModelProfileId[] = ["fast-helper", "conversation", "agentic"];

export async function handleLlmModelCatalogsRoute(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const entries = await Promise.all(
    Object.entries(providerCatalogUrls).map(async ([providerId, url]) => {
      try {
        const catalog = await fetchProviderCatalog(url);
        return { catalog, providerId };
      } catch (caught) {
        return {
          error: caught instanceof Error ? caught.message : String(caught),
          providerId,
        };
      }
    }),
  );

  const catalogs: LlmModelCatalogs = {};
  const errors: Record<string, string> = {};

  for (const entry of entries) {
    if ("catalog" in entry && entry.catalog) {
      catalogs[entry.providerId] = entry.catalog;
    } else {
      errors[entry.providerId] = entry.error;
    }
  }

  return json<LlmModelCatalogsResponse>({ catalogs, errors });
}

export async function handleLlmProviderModelsRoute(
  request: Request,
  context: ServerContext,
  providerId: string,
): Promise<Response> {
  if (request.method !== "POST") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const provider = getLlmProvider(providerId);

  if (!provider) {
    return json<ApiError>({ error: "Unknown LLM provider" }, { status: 404 });
  }

  const body = await readJson<LlmProviderModelsRequest>(request);
  const validation = validateProviderModelsRequest(body);

  if (!validation.ok) {
    return json<ApiError>({ error: validation.error }, { status: 400 });
  }

  const providerSummary = context.getLlmProviders().find((item) => item.id === providerId);
  const baseUrl = validation.baseUrl ?? providerSummary?.baseUrl ?? provider.defaultBaseUrl;
  const apiKey =
    validation.apiKey ??
    provider.credentialEnvVars
      .map((envVar) => context.secretEnv.mergedWithProcessEnv()[envVar])
      .find((value): value is string => Boolean(value));

  try {
    const models = await fetchProviderModels({
      apiKey,
      baseUrl,
      providerId,
    });

    return json<LlmProviderModelsResponse>({
      models,
      providerId,
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return json<ApiError>({ error: message }, { status: 502 });
  }
}

export async function handleLlmProviderSettingsRoute(
  request: Request,
  context: ServerContext,
  providerId: string | null,
): Promise<Response> {
  if (!providerId && request.method === "GET") {
    return providerSettingsResponse(context);
  }

  if (!providerId) {
    return json<ApiError>({ error: "Provider id is required" }, { status: 400 });
  }

  if (request.method !== "PATCH" && request.method !== "PUT") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const provider = getLlmProvider(providerId);

  if (!provider) {
    return json<ApiError>({ error: "Unknown LLM provider" }, { status: 404 });
  }

  const body = await readJson<LlmProviderSettingsUpdateRequest>(request);
  const validation = validateUpdate(body, provider.credentialEnvVars);

  if (!validation.ok) {
    return json<ApiError>({ error: validation.error }, { status: 400 });
  }

  context.settings.updateLlmProviderSettings(providerId, validation.settings);

  for (const [envVar, value] of Object.entries(validation.secrets)) {
    if (value === null) {
      await context.secretEnv.removeSecret(envVar);
    } else {
      await context.secretEnv.setSecret(envVar, value);
    }
  }

  context.secretEnv.load();
  return providerSettingsResponse(context);
}

export async function handleSystemSettingsRoute(
  request: Request,
  context: ServerContext,
): Promise<Response> {
  if (request.method !== "GET") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  return json<SystemSettingsResponse>({
    conversationScopeMode: context.options.conversationWorkspacePath ? "workspace" : "all",
    conversationScopePath: context.options.conversationWorkspacePath,
    databasePath: context.database.path,
    envKeysPath: context.options.trussHome.envKeysPath,
    envPath: context.options.trussHome.envPath,
    mcpConfigPath: context.options.trussHome.mcpConfigPath,
    trussHomeDir: context.options.trussHome.dir,
    workspacePath: context.options.workspacePath,
  });
}

export async function handleSettingsRoute(
  request: Request,
  context: ServerContext,
): Promise<Response> {
  if (request.method === "GET") {
    return settingsResponse(context);
  }

  if (request.method !== "POST" && request.method !== "PATCH" && request.method !== "PUT") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJson<SettingsUpdateRequest>(request);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json<ApiError>({ error: "Settings payload must be an object" }, { status: 400 });
  }

  if (Object.hasOwn(body, "richFeatures")) {
    const validation = validateRichFeatureSettingsUpdate(body.richFeatures ?? null);

    if (!validation.ok) {
      return json<ApiError>({ error: validation.error }, { status: 400 });
    }

    context.richFeatures.updateRichFeatureSettings(validation.update);
  }

  return settingsResponse(context);
}

export async function handleFileAccessSettingsRoute(
  request: Request,
  context: ServerContext,
): Promise<Response> {
  if (request.method === "GET") {
    return json<FileAccessSecurityResponse>(
      await fileAccessSettingsResponse({
        commandRunner: commandRunnerSecuritySummary(context),
        conversationWorkspacePath: context.options.conversationWorkspacePath,
        filesystemGrants: context.filesystemGrants,
        trussHome: context.options.trussHome,
      }),
    );
  }

  if (request.method !== "PATCH" && request.method !== "PUT") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJson<FileAccessSecurityUpdateRequest>(request);
  const validation = validateFileAccessSettingsUpdate(body);

  if (!validation.ok) {
    return json<ApiError>({ error: validation.error }, { status: 400 });
  }

  try {
    if (Object.hasOwn(validation.update, "directories")) {
      await context.filesystemGrants.replaceContextGrants(
        context.options.conversationWorkspacePath,
        validation.update.directories ?? [],
        "user-dialog",
      );
    }

    if (Object.hasOwn(validation.update, "ignorePatterns")) {
      await updateStoredFileAccessSettings(context.options.trussHome, {
        ignorePatterns: validation.update.ignorePatterns ?? [],
      });
    }

    if (validation.update.commandRunner) {
      const { whitelistEntries, ...settingsUpdate } = validation.update.commandRunner;

      if (Object.keys(settingsUpdate).length > 0) {
        context.mcpSettings.updateMcpSettings({ commandRunner: settingsUpdate });
      }

      if (Object.hasOwn(validation.update.commandRunner, "whitelistEntries")) {
        context.commandWhitelist.replaceEntries(whitelistEntries ?? []);
      }
    }

    const response = await fileAccessSettingsResponse({
      commandRunner: commandRunnerSecuritySummary(context),
      conversationWorkspacePath: context.options.conversationWorkspacePath,
      filesystemGrants: context.filesystemGrants,
      trussHome: context.options.trussHome,
    });

    if (Object.hasOwn(validation.update, "directories")) {
      publishFilesystemGrantsUpdated(context, response);
    }

    return json<FileAccessSecurityResponse>(response);
  } catch (caught) {
    return json<ApiError>(
      { error: caught instanceof Error ? caught.message : String(caught) },
      { status: 400 },
    );
  }
}

export async function handleFileAccessWorkspaceTreeRoute(
  request: Request,
  context: ServerContext,
): Promise<Response> {
  if (request.method !== "GET") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  try {
    const [readOnlyDirectories, directoryGrants] = await Promise.all([
      skillFilesystemAccessDirectories(context.options.conversationWorkspacePath),
      context.filesystemGrants
        .listGrantsForContext(context.options.conversationWorkspacePath)
        .map((grant) => ({
          directoryPath: grant.directoryPath,
          grantSource: grant.grantSource,
          readOnly: grant.readOnly,
        })),
    ]);

    return json<FileAccessWorkspaceTreeResponse>(
      await inspectFileAccessWorkspaceTree({
        conversationWorkspacePath: context.options.conversationWorkspacePath,
        directoryGrants,
        directoryPath: path,
        limit,
        readOnlyDirectories,
        trussHome: context.options.trussHome,
      }),
    );
  } catch (caught) {
    return json<ApiError>(
      { error: caught instanceof Error ? caught.message : String(caught) },
      { status: 400 },
    );
  }
}

export async function handleMcpSettingsRoute(
  request: Request,
  context: ServerContext,
): Promise<Response> {
  if (request.method === "GET") {
    return mcpSettingsResponse(context);
  }

  if (request.method !== "PATCH" && request.method !== "PUT") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJson<McpSettingsUpdateRequest>(request);
  const validation = validateMcpSettingsUpdate(body);

  if (!validation.ok) {
    return json<ApiError>({ error: validation.error }, { status: 400 });
  }

  if (Object.hasOwn(validation.update, "mcpConfigText")) {
    try {
      await writeGlobalMcpConfigText({
        approveStdioServers: validation.update.approveStdioServers === true,
        mcpConfigText: validation.update.mcpConfigText ?? "",
        options: {
          conversationWorkspacePath: context.options.conversationWorkspacePath,
          filesystemGrants: context.filesystemGrants,
          mcpSettings: context.mcpSettings,
          projectRoot: context.options.projectRoot,
          trussHome: context.options.trussHome,
          workspacePath: context.options.workspacePath,
        },
      });
    } catch (caught) {
      return json<ApiError>(
        { error: caught instanceof Error ? caught.message : String(caught) },
        { status: 400 },
      );
    }
  }

  if (
    Object.hasOwn(validation.update, "mcpConfigText") ||
    validation.update.restoreTrussMcpDefault
  ) {
    await ensureGlobalMcpConfig({
      conversationWorkspacePath: context.options.conversationWorkspacePath,
      filesystemGrants: context.filesystemGrants,
      mcpSettings: context.mcpSettings,
      projectRoot: context.options.projectRoot,
      trussHome: context.options.trussHome,
      workspacePath: context.options.workspacePath,
    });
  }

  if (validation.update.restoreTrussMcpDefault) {
    await restoreGlobalMcpManagedServer({
      conversationWorkspacePath: context.options.conversationWorkspacePath,
      filesystemGrants: context.filesystemGrants,
      mcpSettings: context.mcpSettings,
      projectRoot: context.options.projectRoot,
      trussHome: context.options.trussHome,
      workspacePath: context.options.workspacePath,
    });
  }

  if (validation.update.mcpSecrets) {
    for (const [envVar, value] of Object.entries(validation.update.mcpSecrets)) {
      if (value === null) {
        await context.secretEnv.removeSecret(envVar);
      } else {
        await context.secretEnv.setSecret(envVar, value);
      }
    }

    context.secretEnv.load();
  }

  const mcpSettingsChanged =
    Object.hasOwn(validation.update, "sanitizerModelId") ||
    Object.hasOwn(validation.update, "sanitizerProviderId") ||
    Object.hasOwn(validation.update, "commandRunner") ||
    Object.hasOwn(validation.update, "playwrightMcp");

  if (mcpSettingsChanged) {
    context.mcpSettings.updateMcpSettings(validation.update);
  }

  if (Object.hasOwn(validation.update, "playwrightMcp")) {
    await ensureGlobalMcpConfig({
      conversationWorkspacePath: context.options.conversationWorkspacePath,
      filesystemGrants: context.filesystemGrants,
      mcpSettings: context.mcpSettings,
      projectRoot: context.options.projectRoot,
      trussHome: context.options.trussHome,
      workspacePath: context.options.workspacePath,
    });
  }

  return mcpSettingsResponse(context);
}

export async function handleMcpReloadRoute(
  request: Request,
  context: ServerContext,
): Promise<Response> {
  if (request.method !== "POST") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await readJson<McpReloadRequest>(request);

    if (body?.approveStdioServers === true) {
      await approveCurrentMcpStdioServers({
        conversationWorkspacePath: context.options.conversationWorkspacePath,
        filesystemGrants: context.filesystemGrants,
        projectRoot: context.options.projectRoot,
        trussHome: context.options.trussHome,
        workspacePath: context.options.workspacePath,
      });
    }

    const mcp = await context.reloadMcpRuntime();

    return json<McpReloadResponse>({ mcp });
  } catch (caught) {
    return json<ApiError>(
      { error: caught instanceof Error ? caught.message : String(caught) },
      { status: 500 },
    );
  }
}

export async function handleMcpResourceReadRoute(
  request: Request,
  context: ServerContext,
): Promise<Response> {
  if (request.method !== "POST") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJson<McpResourceReadRequest>(request);
  const validation = validateMcpResourceReadRequest(body);

  if (!validation.ok) {
    return json<ApiError>({ error: validation.error }, { status: 400 });
  }

  try {
    const contents = await context.mcp.readResource(validation.request);

    return json<McpResourceReadResponse>({ contents });
  } catch (caught) {
    return json<ApiError>(
      { error: caught instanceof Error ? caught.message : String(caught) },
      { status: 400 },
    );
  }
}

export async function handleMcpPromptGetRoute(
  request: Request,
  context: ServerContext,
): Promise<Response> {
  if (request.method !== "POST") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJson<McpPromptGetRequest>(request);
  const validation = validateMcpPromptGetRequest(body);

  if (!validation.ok) {
    return json<ApiError>({ error: validation.error }, { status: 400 });
  }

  try {
    const prompt = await context.mcp.getPrompt(validation.request);

    return json<McpPromptGetResponse>(prompt);
  } catch (caught) {
    return json<ApiError>(
      { error: caught instanceof Error ? caught.message : String(caught) },
      { status: 400 },
    );
  }
}

export async function handleHistorySettingsRoute(
  request: Request,
  context: ServerContext,
): Promise<Response> {
  if (request.method === "GET") {
    return historySettingsResponse(context);
  }

  if (request.method !== "PATCH" && request.method !== "PUT") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJson<HistorySettingsUpdateRequest>(request);
  const validation = validateHistorySettingsUpdate(body);

  if (!validation.ok) {
    return json<ApiError>({ error: validation.error }, { status: 400 });
  }

  context.historySettings.updateHistorySettings(validation.update);
  return historySettingsResponse(context);
}

export async function handleRichFeatureSettingsRoute(
  request: Request,
  context: ServerContext,
): Promise<Response> {
  if (request.method === "GET") {
    return richFeatureSettingsResponse(context);
  }

  if (request.method !== "PATCH" && request.method !== "PUT") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJson<RichFeatureSettingsUpdateRequest>(request);
  const validation = validateRichFeatureSettingsUpdate(body);

  if (!validation.ok) {
    return json<ApiError>({ error: validation.error }, { status: 400 });
  }

  context.richFeatures.updateRichFeatureSettings(validation.update);
  return richFeatureSettingsResponse(context);
}

export async function handleSystemPromptSettingsRoute(
  request: Request,
  context: ServerContext,
  mode: string | null,
): Promise<Response> {
  if (!mode && request.method === "GET") {
    return systemPromptSettingsResponse(context);
  }

  if (!mode) {
    return json<ApiError>({ error: "System prompt mode is required" }, { status: 400 });
  }

  if (!isSystemPromptMode(mode)) {
    return json<ApiError>({ error: "Unknown system prompt mode" }, { status: 404 });
  }

  if (request.method !== "PATCH" && request.method !== "PUT") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJson<SystemPromptSettingsUpdateRequest>(request);
  const validation = validateSystemPromptUpdate(body);

  if (!validation.ok) {
    return json<ApiError>({ error: validation.error }, { status: 400 });
  }

  context.systemPrompts.updateSystemPrompt(mode, validation.template);
  return systemPromptSettingsResponse(context);
}

function providerSettingsResponse(context: ServerContext): Response {
  return json<LlmProviderSettingsResponse>({
    providers: context.getLlmProviders(),
  });
}

async function mcpSettingsResponse(context: ServerContext): Promise<Response> {
  const file = Bun.file(context.options.trussHome.mcpConfigPath);
  const exists = await file.exists();

  return json<McpSettingsResponse>({
    mcpConfigPath: context.options.trussHome.mcpConfigPath,
    mcpConfigText: exists ? await file.text() : "{\n  \"mcpServers\": {}\n}\n",
    secrets: mcpSecretSummaries(context),
    settings: context.mcpSettings.getMcpSettings(),
  });
}

function commandRunnerSecuritySummary(context: ServerContext) {
  return {
    settings: context.mcpSettings.getMcpSettings().commandRunner,
    whitelistEntries: context.commandWhitelist.listEntries(),
  };
}

function mcpSecretSummaries(context: ServerContext): LlmProviderSecretSummary[] {
  return context.secretEnv.listSecrets(mcpSecretEnvPrefix);
}

function publishFilesystemGrantsUpdated(
  context: ServerContext,
  fileAccess: FileAccessSecurityResponse,
): void {
  context.hub.publish({
    id: createId("evt"),
    type: "filesystem.grants.updated",
    createdAt: now(),
    fileAccess,
  });
}

function validateMcpResourceReadRequest(
  body: McpResourceReadRequest | null,
): { ok: true; request: McpResourceReadRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Request body must be an object" };
  }

  const serverId = typeof body.serverId === "string" ? body.serverId.trim() : "";
  const uri = typeof body.uri === "string" ? body.uri.trim() : "";

  if (!serverId) {
    return { ok: false, error: "serverId is required" };
  }

  if (!uri) {
    return { ok: false, error: "uri is required" };
  }

  return {
    ok: true,
    request: {
      serverId,
      uri,
    },
  };
}

function validateMcpPromptGetRequest(
  body: McpPromptGetRequest | null,
): { ok: true; request: McpPromptGetRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Request body must be an object" };
  }

  const serverId = typeof body.serverId === "string" ? body.serverId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!serverId) {
    return { ok: false, error: "serverId is required" };
  }

  if (!name) {
    return { ok: false, error: "name is required" };
  }

  const promptArguments: Record<string, string> = {};

  if (Object.hasOwn(body, "arguments")) {
    if (!body.arguments || typeof body.arguments !== "object" || Array.isArray(body.arguments)) {
      return { ok: false, error: "arguments must be an object" };
    }

    for (const [key, value] of Object.entries(body.arguments)) {
      const argumentName = key.trim();

      if (!argumentName) {
        return { ok: false, error: "argument names must not be empty" };
      }

      if (typeof value !== "string") {
        return { ok: false, error: `argument ${argumentName} must be a string` };
      }

      promptArguments[argumentName] = value;
    }
  }

  return {
    ok: true,
    request: {
      ...(Object.keys(promptArguments).length > 0 ? { arguments: promptArguments } : {}),
      name,
      serverId,
    },
  };
}

function historySettingsResponse(context: ServerContext): Response {
  return json<HistorySettingsResponse>({
    history: context.historySettings.getHistorySettings(),
  });
}

function richFeatureSettingsResponse(context: ServerContext): Response {
  return json<RichFeatureSettingsResponse>({
    richFeatures: context.richFeatures.getRichFeatureSettings(),
  });
}

function settingsResponse(context: ServerContext): Response {
  return json<SettingsResponse>({
    richFeatures: context.richFeatures.getRichFeatureSettings(),
  });
}

function systemPromptSettingsResponse(context: ServerContext): Response {
  const setup = context.setup.getSetup();

  return json<SystemPromptSettingsResponse>({
    placeholders: systemPromptPlaceholders,
    prompts: context.systemPrompts.listSystemPrompts().map((prompt) => ({
      defaultTemplate: getDefaultSystemPromptTemplate(prompt.mode),
      mode: prompt.mode,
      label: systemPromptLabels[prompt.mode],
      template: prompt.template || getDefaultSystemPromptTemplate(prompt.mode),
      renderedPreview: renderSystemPromptTemplate({
        setup,
        template: prompt.template || getDefaultSystemPromptTemplate(prompt.mode),
      }),
      updatedAt: prompt.updatedAt,
    })),
  });
}

function validateMcpSettingsUpdate(
  body: McpSettingsUpdateRequest | null,
): { ok: true; update: McpSettingsUpdateRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "MCP settings payload must be an object" };
  }

  const update: McpSettingsUpdateRequest = {};

  if (Object.hasOwn(body, "mcpConfigText")) {
    if (typeof body.mcpConfigText !== "string") {
      return { ok: false, error: "mcpConfigText must be a string" };
    }

    if (body.mcpConfigText.length > maxMcpConfigLength) {
      return { ok: false, error: "mcpConfigText is too long" };
    }

    try {
      JSON.parse(body.mcpConfigText);
    } catch {
      return { ok: false, error: "Please ensure the JSON is not formatted incorrectly" };
    }

    update.mcpConfigText = body.mcpConfigText;
  }

  if (Object.hasOwn(body, "approveStdioServers")) {
    if (typeof body.approveStdioServers !== "boolean") {
      return { ok: false, error: "approveStdioServers must be a boolean" };
    }

    update.approveStdioServers = body.approveStdioServers;
  }

  if (Object.hasOwn(body, "restoreTrussMcpDefault")) {
    if (typeof body.restoreTrussMcpDefault !== "boolean") {
      return { ok: false, error: "restoreTrussMcpDefault must be a boolean" };
    }

    update.restoreTrussMcpDefault = body.restoreTrussMcpDefault;
  }

  if (Object.hasOwn(body, "mcpSecrets")) {
    if (!body.mcpSecrets || typeof body.mcpSecrets !== "object" || Array.isArray(body.mcpSecrets)) {
      return { ok: false, error: "mcpSecrets must be an object" };
    }

    const mcpSecrets: Record<string, string | null> = {};

    for (const [envVar, value] of Object.entries(body.mcpSecrets)) {
      if (!isMcpSecretEnvVar(envVar)) {
        return {
          ok: false,
          error: `MCP secret names must start with ${mcpSecretEnvPrefix} and contain only uppercase letters, numbers, and underscores`,
        };
      }

      if (value !== null && typeof value !== "string") {
        return { ok: false, error: `MCP secret ${envVar} must be a string or null` };
      }

      if (typeof value === "string" && value.length > maxSecretLength) {
        return { ok: false, error: `MCP secret ${envVar} is too long` };
      }

      mcpSecrets[envVar] = typeof value === "string" && value.trim().length > 0 ? value : null;
    }

    update.mcpSecrets = mcpSecrets;
  }

  for (const key of ["sanitizerProviderId", "sanitizerModelId"] as const) {
    if (Object.hasOwn(body, key)) {
      const value = body[key];

      if (value !== null && value !== undefined && typeof value !== "string") {
        return { ok: false, error: `${key} must be a string or null` };
      }

      update[key] = typeof value === "string" ? value.trim() : null;
    }
  }

  if (Object.hasOwn(body, "commandRunner")) {
    const commandRunner = validateCommandRunnerSettingsPatch(body.commandRunner);

    if (!commandRunner.ok) {
      return { ok: false, error: commandRunner.error };
    }

    update.commandRunner = commandRunner.update;
  }

  if (Object.hasOwn(body, "playwrightMcp")) {
    const playwrightMcp = validatePlaywrightMcpSettingsPatch(body.playwrightMcp);

    if (!playwrightMcp.ok) {
      return { ok: false, error: playwrightMcp.error };
    }

    update.playwrightMcp = playwrightMcp.update;
  }

  return { ok: true, update };
}

function validateHistorySettingsUpdate(
  body: HistorySettingsUpdateRequest | null,
): { ok: true; update: HistorySettingsUpdate } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "History settings payload must be an object" };
  }

  const update: HistorySettingsUpdate = {};

  if (Object.hasOwn(body, "includeThinkingHistory")) {
    if (typeof body.includeThinkingHistory !== "boolean") {
      return { ok: false, error: "includeThinkingHistory must be a boolean" };
    }

    update.includeThinkingHistory = body.includeThinkingHistory;
  }

  if (Object.hasOwn(body, "includeToolHistory")) {
    if (typeof body.includeToolHistory !== "boolean") {
      return { ok: false, error: "includeToolHistory must be a boolean" };
    }

    update.includeToolHistory = body.includeToolHistory;
  }

  if (Object.hasOwn(body, "limitReasoningBudget")) {
    if (typeof body.limitReasoningBudget !== "boolean") {
      return { ok: false, error: "limitReasoningBudget must be a boolean" };
    }

    update.limitReasoningBudget = body.limitReasoningBudget;
  }

  if (Object.hasOwn(body, "maxReasoningTimeSeconds")) {
    if (!isReasoningLimit(body.maxReasoningTimeSeconds, maxReasoningTimeSeconds)) {
      return {
        ok: false,
        error: `maxReasoningTimeSeconds must be an integer from 0 to ${maxReasoningTimeSeconds}`,
      };
    }

    update.maxReasoningTimeSeconds = body.maxReasoningTimeSeconds;
  }

  if (Object.hasOwn(body, "maxReasoningWords")) {
    if (!isReasoningLimit(body.maxReasoningWords, maxReasoningWords)) {
      return {
        ok: false,
        error: `maxReasoningWords must be an integer from 0 to ${maxReasoningWords}`,
      };
    }

    update.maxReasoningWords = body.maxReasoningWords;
  }

  return { ok: true, update };
}

function isReasoningLimit(value: unknown, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;
}

function validateFileAccessSettingsUpdate(
  body: FileAccessSecurityUpdateRequest | null,
): { ok: true; update: FileAccessSecurityUpdateRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Security settings payload must be an object." };
  }

  if (Object.hasOwn(body, "directories") && !isDirectoryGrantArray(body.directories)) {
    return { ok: false, error: "directories must be an array of strings or directory grant objects." };
  }

  if (Object.hasOwn(body, "ignorePatterns") && !isStringArray(body.ignorePatterns)) {
    return { ok: false, error: "ignorePatterns must be an array of strings." };
  }

  const commandRunner = Object.hasOwn(body, "commandRunner")
    ? validateCommandRunnerSecurityPatch(body.commandRunner)
    : null;

  if (commandRunner && !commandRunner.ok) {
    return { ok: false, error: commandRunner.error };
  }

  return {
    ok: true,
    update: {
      ...(commandRunner?.ok ? { commandRunner: commandRunner.update } : {}),
      ...(Object.hasOwn(body, "directories") ? { directories: body.directories ?? [] } : {}),
      ...(Object.hasOwn(body, "ignorePatterns")
        ? { ignorePatterns: body.ignorePatterns ?? [] }
        : {}),
    },
  };
}

function validateCommandRunnerSettingsPatch(
  value: unknown,
): { ok: true; update: NonNullable<McpSettingsUpdateRequest["commandRunner"]> } | { ok: false; error: string } {
  const base = validateCommandRunnerPatchBase(value);

  if (!base.ok) {
    return base;
  }

  return { ok: true, update: base.update };
}

function validatePlaywrightMcpSettingsPatch(
  value: unknown,
): { ok: true; update: NonNullable<McpSettingsUpdateRequest["playwrightMcp"]> } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "playwrightMcp must be an object." };
  }

  const source = value as Record<string, unknown>;
  const update: NonNullable<McpSettingsUpdateRequest["playwrightMcp"]> = {};

  for (const key of ["enabled", "headless", "sharedBrowser"] as const) {
    if (!Object.hasOwn(source, key)) {
      continue;
    }

    if (typeof source[key] !== "boolean") {
      return { ok: false, error: `playwrightMcp.${key} must be a boolean.` };
    }

    update[key] = source[key];
  }

  if (Object.hasOwn(source, "tools")) {
    if (typeof source.tools !== "string") {
      return { ok: false, error: "playwrightMcp.tools must be a string." };
    }

    if (source.tools.length > 4000) {
      return { ok: false, error: "playwrightMcp.tools is too long." };
    }

    update.tools = source.tools;
  }

  return { ok: true, update };
}

function validateCommandRunnerSecurityPatch(
  value: unknown,
): { ok: true; update: NonNullable<FileAccessSecurityUpdateRequest["commandRunner"]> } | { ok: false; error: string } {
  const base = validateCommandRunnerPatchBase(value);

  if (!base.ok) {
    return base;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "commandRunner must be an object." };
  }

  const source = value as Record<string, unknown>;

  if (!Object.hasOwn(source, "whitelistEntries")) {
    return { ok: true, update: base.update };
  }

  if (!Array.isArray(source.whitelistEntries)) {
    return { ok: false, error: "commandRunner.whitelistEntries must be an array." };
  }

  if (!source.whitelistEntries.every(isCommandWhitelistEntryUpdate)) {
    return { ok: false, error: "commandRunner.whitelistEntries contains an invalid entry." };
  }

  return {
    ok: true,
    update: {
      ...base.update,
      whitelistEntries: source.whitelistEntries,
    },
  };
}

function validateCommandRunnerPatchBase(
  value: unknown,
): { ok: true; update: NonNullable<McpSettingsUpdateRequest["commandRunner"]> } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "commandRunner must be an object." };
  }

  const source = value as Record<string, unknown>;
  const update: NonNullable<McpSettingsUpdateRequest["commandRunner"]> = {};

  for (const key of ["guardProviderId", "guardModelId"] as const) {
    if (!Object.hasOwn(source, key)) {
      continue;
    }

    const candidate = source[key];

    if (candidate !== null && candidate !== undefined && typeof candidate !== "string") {
      return { ok: false, error: `commandRunner.${key} must be a string or null.` };
    }

    update[key] = typeof candidate === "string" ? candidate.trim() : null;
  }

  for (const key of ["preExecutionGuardEnabled", "postExecutionGuardEnabled"] as const) {
    if (!Object.hasOwn(source, key)) {
      continue;
    }

    if (typeof source[key] !== "boolean") {
      return { ok: false, error: `commandRunner.${key} must be a boolean.` };
    }

    update[key] = source[key];
  }

  for (const key of ["safeAction", "riskyAction", "dangerousAction"] as const) {
    if (!Object.hasOwn(source, key)) {
      continue;
    }

    const action = source[key];

    if (action !== "auto-allow" && action !== "ask" && action !== "auto-deny") {
      return { ok: false, error: `commandRunner.${key} must be auto-allow, ask, or auto-deny.` };
    }

    update[key] = action;
  }

  return { ok: true, update };
}

function isCommandWhitelistEntryUpdate(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const entry = value as Record<string, unknown>;
  const type = entry.type;
  const addedBy = entry.addedBy;

  return (
    typeof entry.pattern === "string" &&
    (type === "prefix" || type === "glob" || type === "regex") &&
    (entry.reason === undefined || entry.reason === null || typeof entry.reason === "string") &&
    (entry.expiresAt === undefined || entry.expiresAt === null || typeof entry.expiresAt === "string") &&
    (addedBy === undefined || addedBy === "user" || addedBy === "llm-request")
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isDirectoryGrantArray(value: unknown): value is Array<string | FileAccessDirectoryUpdate> {
  return Array.isArray(value) && value.every(isDirectoryGrantInput);
}

function isDirectoryGrantInput(value: unknown): value is string | FileAccessDirectoryUpdate {
  if (typeof value === "string") {
    return true;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const entry = value as Partial<FileAccessDirectoryUpdate>;

  return (
    typeof entry.path === "string" &&
    (entry.readOnly === undefined || typeof entry.readOnly === "boolean")
  );
}

function validateRichFeatureSettingsUpdate(
  body: RichFeatureSettingsUpdateRequest | null,
): { ok: true; update: RichFeatureSettingsUpdate } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Rich feature settings payload must be an object" };
  }

  const update: RichFeatureSettingsUpdate = {};
  const booleanKeys = [
    "agenticToolTurnLimitEnabled",
    "cardsEnabled",
    "calloutsEnabled",
    "followUpsEnabled",
    "katexEnabled",
    "plantUmlEnabled",
    "smartEventsEnabled",
    "smartEventsGoogleCalendarEnabled",
    "smartEventsIcsEnabled",
    "smartEventsOutlookCalendarEnabled",
    "smartTablesEnabled",
    "timelinesEnabled",
  ] as const;

  for (const key of booleanKeys) {
    if (!Object.hasOwn(body, key)) {
      continue;
    }

    if (typeof body[key] !== "boolean") {
      return { ok: false, error: `${key} must be a boolean` };
    }

    update[key] = body[key];
  }

  if (Object.hasOwn(body, "agenticToolTurnLimit")) {
    const agenticToolTurnLimit = body.agenticToolTurnLimit;

    if (
      !Number.isInteger(agenticToolTurnLimit) ||
      agenticToolTurnLimit === undefined ||
      agenticToolTurnLimit < 1 ||
      agenticToolTurnLimit > maxAgenticToolTurnLimit
    ) {
      return {
        ok: false,
        error: `agenticToolTurnLimit must be an integer from 1 to ${maxAgenticToolTurnLimit}`,
      };
    }

    update.agenticToolTurnLimit = agenticToolTurnLimit;
  }

  if (Object.hasOwn(body, "plantUmlFormat")) {
    if (!isPlantUmlFormat(body.plantUmlFormat)) {
      return { ok: false, error: "plantUmlFormat must be svg or png" };
    }

    update.plantUmlFormat = body.plantUmlFormat;
  }

  if (Object.hasOwn(body, "plantUmlServerUrl")) {
    if (typeof body.plantUmlServerUrl !== "string") {
      return { ok: false, error: "plantUmlServerUrl must be a string" };
    }

    const plantUmlServerUrl = body.plantUmlServerUrl.trim();

    if (plantUmlServerUrl.length > maxPlantUmlServerUrlLength) {
      return { ok: false, error: "plantUmlServerUrl is too long" };
    }

    if (plantUmlServerUrl && !isHttpUrl(plantUmlServerUrl)) {
      return { ok: false, error: "plantUmlServerUrl must be an HTTP or HTTPS URL" };
    }

    update.plantUmlServerUrl = plantUmlServerUrl;
  }

  if (Object.hasOwn(body, "plantUmlPrompt")) {
    if (typeof body.plantUmlPrompt !== "string") {
      return { ok: false, error: "plantUmlPrompt must be a string" };
    }

    if (body.plantUmlPrompt.length > maxPlantUmlPromptLength) {
      return { ok: false, error: "plantUmlPrompt is too long" };
    }

    update.plantUmlPrompt = body.plantUmlPrompt;
  }

  return { ok: true, update };
}

function validateSystemPromptUpdate(
  body: SystemPromptSettingsUpdateRequest | null,
): { ok: true; template: string } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "System prompt payload must be an object" };
  }

  if (typeof body.template !== "string") {
    return { ok: false, error: "template must be a string" };
  }

  const template = body.template.trim();

  if (!template) {
    return { ok: false, error: "template is required" };
  }

  if (template.length > maxSystemPromptLength) {
    return { ok: false, error: "template is too long" };
  }

  return { ok: true, template };
}

async function fetchProviderCatalog(
  url: string,
): Promise<Partial<Record<LlmModelProfileId, LlmModelCatalogDefault>>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), modelCatalogsTimeoutMs);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Could not fetch catalog: ${response.status} ${response.statusText}`);
    }

    return normalizeCatalogPayload(await response.json());
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") {
      throw new Error("Timed out while fetching model catalog.");
    }

    throw caught;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCatalogPayload(
  payload: unknown,
): Partial<Record<LlmModelProfileId, LlmModelCatalogDefault>> {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const defaults = (payload as Record<string, unknown>).defaults;

  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
    return {};
  }

  return Object.fromEntries(
    modelProfileIds
      .map((profileId) => [profileId, normalizeCatalogDefault(defaults, profileId)] as const)
      .filter((entry): entry is [LlmModelProfileId, LlmModelCatalogDefault] => Boolean(entry[1])),
  );
}

function normalizeCatalogDefault(
  defaults: object,
  profileId: LlmModelProfileId,
): LlmModelCatalogDefault | null {
  const value = (defaults as Record<string, unknown>)[profileId];

  if (typeof value === "string" && value.trim()) {
    return { modelId: value.trim() };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const modelId = (value as Record<string, unknown>).model;

  if (typeof modelId !== "string" || !modelId.trim()) {
    return null;
  }

  const parameters = normalizeCatalogParameters(
    (value as Record<string, unknown>).parameters,
  );

  return {
    modelId: modelId.trim(),
    parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
  };
}

function normalizeCatalogParameters(value: unknown): Partial<LlmGenerationParameters> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const source = value as Record<string, unknown>;
  const parameters: Partial<LlmGenerationParameters> = {};

  for (const key of ["temperature", "topP", "topK"] as const) {
    if (Object.hasOwn(source, key) && isNullableNumber(source[key])) {
      parameters[key] = source[key];
    }
  }

  return parameters;
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isPlantUmlFormat(value: unknown): value is PlantUmlRenderFormat {
  return value === "svg" || value === "png";
}

function validateUpdate(
  body: LlmProviderSettingsUpdateRequest | null,
  allowedSecretEnvVars: string[],
):
  | { ok: true; settings: LlmProviderSettingsUpdate; secrets: Record<string, string | null> }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Settings payload must be an object" };
  }

  const settings: LlmProviderSettingsUpdate = {};
  const secrets: Record<string, string | null> = {};

  if (Object.hasOwn(body, "enabled")) {
    if (typeof body.enabled !== "boolean") {
      return { ok: false, error: "enabled must be a boolean" };
    }

    settings.enabled = body.enabled;
  }

  if (Object.hasOwn(body, "baseUrl")) {
    if (body.baseUrl !== null && typeof body.baseUrl !== "string") {
      return { ok: false, error: "baseUrl must be a string or null" };
    }

    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : null;

    if (baseUrl && !isHttpUrl(baseUrl)) {
      return { ok: false, error: "baseUrl must be an HTTP or HTTPS URL" };
    }

    settings.baseUrl = baseUrl;
  }

  if (Object.hasOwn(body, "defaultModel")) {
    if (body.defaultModel !== null && typeof body.defaultModel !== "string") {
      return { ok: false, error: "defaultModel must be a string or null" };
    }

    const defaultModel = typeof body.defaultModel === "string" ? body.defaultModel.trim() : null;

    if (defaultModel && defaultModel.length > maxModelLength) {
      return { ok: false, error: "defaultModel is too long" };
    }

    settings.defaultModel = defaultModel;
  }

  if (Object.hasOwn(body, "models")) {
    if (!Array.isArray(body.models)) {
      return { ok: false, error: "models must be an array" };
    }

    if (body.models.length > maxModelCount) {
      return { ok: false, error: `models may contain at most ${maxModelCount} entries` };
    }

    const models: string[] = [];

    for (const model of body.models) {
      if (typeof model !== "string") {
        return { ok: false, error: "models must contain only strings" };
      }

      const trimmed = model.trim();

      if (trimmed.length > maxModelLength) {
        return { ok: false, error: "models contains an entry that is too long" };
      }

      if (trimmed) {
        models.push(trimmed);
      }
    }

    settings.models = models;
  }

  if (Object.hasOwn(body, "secrets")) {
    if (!body.secrets || typeof body.secrets !== "object" || Array.isArray(body.secrets)) {
      return { ok: false, error: "secrets must be an object" };
    }

    for (const [envVar, value] of Object.entries(body.secrets)) {
      if (!allowedSecretEnvVars.includes(envVar)) {
        return { ok: false, error: `Secret ${envVar} is not valid for this provider` };
      }

      if (value !== null && typeof value !== "string") {
        return { ok: false, error: `Secret ${envVar} must be a string or null` };
      }

      if (typeof value === "string" && value.length > maxSecretLength) {
        return { ok: false, error: `Secret ${envVar} is too long` };
      }

      secrets[envVar] = typeof value === "string" && value.trim().length > 0 ? value : null;
    }
  }

  return { ok: true, settings, secrets };
}

function validateProviderModelsRequest(
  body: LlmProviderModelsRequest | null,
):
  | { ok: true; apiKey: string | null; baseUrl: string | null }
  | { ok: false; error: string } {
  if (body !== null && (typeof body !== "object" || Array.isArray(body))) {
    return { ok: false, error: "Model list payload must be an object" };
  }

  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : null;

  if (apiKey && apiKey.length > maxSecretLength) {
    return { ok: false, error: "apiKey is too long" };
  }

  const baseUrl = typeof body?.baseUrl === "string" ? body.baseUrl.trim() : null;

  if (baseUrl && !isHttpUrl(baseUrl)) {
    return { ok: false, error: "baseUrl must be an HTTP or HTTPS URL" };
  }

  return {
    ok: true,
    apiKey: apiKey || null,
    baseUrl: baseUrl || null,
  };
}

async function fetchProviderModels({
  apiKey,
  baseUrl,
  providerId,
}: {
  apiKey: string | undefined;
  baseUrl: string;
  providerId: string;
}): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerModelsTimeoutMs);

  try {
    const response = await fetch(providerModelsUrl(providerId, baseUrl), {
      headers: providerModelsHeaders(apiKey),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Could not fetch models: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as unknown;
    const models = parseProviderModels(providerId, payload);

    if (models.length === 0) {
      throw new Error("The provider did not return any models.");
    }

    return models;
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") {
      throw new Error("Timed out while fetching provider models.");
    }

    throw caught;
  } finally {
    clearTimeout(timeout);
  }
}

function providerModelsUrl(providerId: string, baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");

  if (providerId === "ollama") {
    return `${trimmed}/api/tags`;
  }

  return `${trimmed}/models`;
}

function providerModelsHeaders(apiKey: string | undefined): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function parseProviderModels(providerId: string, payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  if (providerId === "ollama") {
    return uniqueModelIds(
      arrayProperty(payload, "models")
        .map((item) => stringProperty(item, "name") ?? stringProperty(item, "model"))
        .filter((item): item is string => Boolean(item)),
    );
  }

  return uniqueModelIds(
    arrayProperty(payload, "data")
      .map((item) => stringProperty(item, "id"))
      .filter((item): item is string => Boolean(item)),
  );
}

function arrayProperty(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>)[key])) {
    return [];
  }

  return (value as Record<string, unknown>)[key] as unknown[];
}

function stringProperty(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" && property.trim() ? property.trim() : null;
}

function uniqueModelIds(models: string[]): string[] {
  return [...new Set(models.filter((model) => model.length <= maxModelLength))];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isMcpSecretEnvVar(value: string): boolean {
  return value.startsWith(mcpSecretEnvPrefix) && /^[A-Z_][A-Z0-9_]*$/.test(value);
}
