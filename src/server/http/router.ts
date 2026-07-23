import { serveStatic } from "../static.ts";
import { createSessionSnapshot } from "./session.ts";
import { InvalidJsonRequestError, json, readJson } from "./responses.ts";
import {
  handleAgentSessionMessageRoute,
  handleAgentSessionsRoute,
} from "./routes-agent-sessions.ts";
import {
  handleAttachmentConversionRoute,
  handleAttachmentImageRenderRoute,
} from "./routes-attachments.ts";
import { handleChatRoute } from "./routes-chat.ts";
import { handleChatUserChoiceResolutionRoute } from "./routes-chat-user-choices.ts";
import { handleCommandRoute } from "./routes-command.ts";
import { handleOrchestrationTimerRoute } from "./routes-orchestration-timers.ts";
import { handleScheduledTasksRoute } from "./routes-scheduled-tasks.ts";
import {
  handleLlmModelCatalogsRoute,
  handleLlmProviderModelsRoute,
  handleLlmProviderSettingsRoute,
  handleFileAccessSettingsRoute,
  handleFileAccessWorkspaceTreeRoute,
  handleHistorySettingsRoute,
  handleMcpPromptGetRoute,
  handleMcpReloadRoute,
  handleMcpResourceReadRoute,
  handleMcpSettingsRoute,
  handleRichFeatureSettingsRoute,
  handleSettingsRoute,
  handleSystemPromptSettingsRoute,
  handleSystemSettingsRoute,
} from "./routes-settings.ts";
import { handleModelProfilesRoute } from "./routes-model-profiles.ts";
import { handleSetupLocationRoute, handleSetupRoute } from "./routes-setup.ts";
import { handleSkillReadRoute } from "./routes-skills.ts";
import { handleSpawnedProcessesRoute } from "./routes-spawned-processes.ts";
import { handleToolResolutionRoute } from "./routes-tools.ts";
import { handleWorkspaceLaunchRoute } from "./routes-workspace-launch.ts";
import {
  handleWorkspaceDeleteRoute,
  handleWorkspaceDirectoryPickRoute,
  handleWorkspacesRoute,
} from "./routes-workspaces.ts";
import type {
  ApiError,
  ChatCommandExecutionReference,
  CommandTerminalSummary,
  SessionInfo,
  SystemReadyEvent,
} from "../../shared/protocol.ts";
import type { ServerContext } from "./context.ts";
import { createId } from "../utils/id.ts";
import { now } from "../utils/time.ts";

export async function routeRequest(
  request: Request,
  context: ServerContext,
  port: number,
): Promise<Response> {
  try {
    return await routeRequestUnchecked(request, context, port);
  } catch (caught) {
    if (caught instanceof InvalidJsonRequestError) {
      return json<ApiError>({ error: caught.message }, { status: 400 });
    }

    throw caught;
  }
}

async function routeRequestUnchecked(
  request: Request,
  context: ServerContext,
  port: number,
): Promise<Response> {
  const url = new URL(request.url);
  const session = createCurrentSession(context, port);
  context.spawnLifecycle?.touch();

  if (url.pathname === "/api/health") {
    return json({ ok: true, session });
  }

  if (url.pathname === "/api/session") {
    return json(session);
  }

  if (url.pathname === "/api/settings") {
    return handleSettingsRoute(request, context);
  }

  const spawnedProcessesMatch = url.pathname.match(
    /^\/api\/spawned-processes(?:\/([^/]+)(?:\/([^/]+))?)?$/,
  );

  if (spawnedProcessesMatch) {
    return handleSpawnedProcessesRoute(
      request,
      context,
      spawnedProcessesMatch[1] ? decodeURIComponent(spawnedProcessesMatch[1]) : null,
      spawnedProcessesMatch[2] ? decodeURIComponent(spawnedProcessesMatch[2]) : null,
    );
  }

  if (url.pathname === "/api/setup") {
    return handleSetupRoute(request, context);
  }

  if (url.pathname === "/api/setup/location") {
    return handleSetupLocationRoute(request);
  }

  if (url.pathname === "/api/skills/read") {
    return handleSkillReadRoute(request, context);
  }

  if (url.pathname === "/api/settings/model-catalogs") {
    return handleLlmModelCatalogsRoute(request);
  }

  if (url.pathname === "/api/settings/system") {
    return handleSystemSettingsRoute(request, context);
  }

  if (url.pathname === "/api/settings/security") {
    return handleFileAccessSettingsRoute(request, context);
  }

  if (url.pathname === "/api/settings/security/workspace-access") {
    return handleFileAccessWorkspaceTreeRoute(request, context);
  }

  if (url.pathname === "/api/settings/history") {
    return handleHistorySettingsRoute(request, context);
  }

  if (url.pathname === "/api/settings/mcp/reload") {
    return handleMcpReloadRoute(request, context);
  }

  if (url.pathname === "/api/settings/mcp/resources/read") {
    return handleMcpResourceReadRoute(request, context);
  }

  if (url.pathname === "/api/settings/mcp/prompts/get") {
    return handleMcpPromptGetRoute(request, context);
  }

  if (url.pathname === "/api/settings/mcp") {
    return handleMcpSettingsRoute(request, context);
  }

  const commandExecutionKillMatch = url.pathname.match(
    /^\/api\/command-executions\/([^/]+)\/kill$/,
  );

  if (commandExecutionKillMatch && request.method === "POST") {
    const body = await readJson<{ sessionId?: unknown }>(request);
    const requestSessionId = body?.sessionId;

    if (typeof requestSessionId !== "string" || !requestSessionId.trim()) {
      return json<ApiError>({ error: "sessionId is required." }, { status: 400 });
    }

    try {
      const execution = context.commandExecutions.kill(
        requestSessionId,
        decodeURIComponent(commandExecutionKillMatch[1] ?? ""),
      );

      return json<{ execution: ChatCommandExecutionReference }>({ execution });
    } catch (caught) {
      return json<ApiError>(
        { error: caught instanceof Error ? caught.message : String(caught) },
        { status: 404 },
      );
    }
  }

  if (url.pathname === "/api/command-terminals" && request.method === "GET") {
    const requestSessionId = url.searchParams.get("sessionId");

    if (!requestSessionId || !requestSessionId.trim()) {
      return json<ApiError>({ error: "sessionId is required." }, { status: 400 });
    }

    const terminals = context.commandTerminals.list(requestSessionId);

    return json<{ terminals: CommandTerminalSummary[] }>({ terminals });
  }

  const commandTerminalKillMatch = url.pathname.match(
    /^\/api\/command-terminals\/([^/]+)\/kill$/,
  );

  if (commandTerminalKillMatch && request.method === "POST") {
    const body = await readJson<{ sessionId?: unknown }>(request);
    const requestSessionId = body?.sessionId;

    if (typeof requestSessionId !== "string" || !requestSessionId.trim()) {
      return json<ApiError>({ error: "sessionId is required." }, { status: 400 });
    }

    try {
      const terminal = context.commandTerminals.kill(
        requestSessionId,
        decodeURIComponent(commandTerminalKillMatch[1] ?? ""),
      );

      return json<{ terminal: CommandTerminalSummary }>({ terminal });
    } catch (caught) {
      return json<ApiError>(
        { error: caught instanceof Error ? caught.message : String(caught) },
        { status: 404 },
      );
    }
  }

  if (url.pathname === "/api/settings/rich-features") {
    return handleRichFeatureSettingsRoute(request, context);
  }

  const systemPromptSettingsMatch = url.pathname.match(
    /^\/api\/settings\/system-prompts(?:\/([^/]+))?$/,
  );

  if (systemPromptSettingsMatch) {
    return handleSystemPromptSettingsRoute(
      request,
      context,
      systemPromptSettingsMatch[1] ? decodeURIComponent(systemPromptSettingsMatch[1]) : null,
    );
  }

  const providerModelsMatch = url.pathname.match(
    /^\/api\/settings\/llm-providers\/([^/]+)\/models$/,
  );

  if (providerModelsMatch) {
    return handleLlmProviderModelsRoute(
      request,
      context,
      decodeURIComponent(providerModelsMatch[1] ?? ""),
    );
  }

  const providerSettingsMatch = url.pathname.match(/^\/api\/settings\/llm-providers(?:\/([^/]+))?$/);

  if (providerSettingsMatch) {
    return handleLlmProviderSettingsRoute(
      request,
      context,
      providerSettingsMatch[1] ? decodeURIComponent(providerSettingsMatch[1]) : null,
    );
  }

  const modelProfilesMatch = url.pathname.match(/^\/api\/settings\/model-profiles(?:\/([^/]+))?$/);

  if (modelProfilesMatch) {
    return handleModelProfilesRoute(
      request,
      context,
      modelProfilesMatch[1] ? decodeURIComponent(modelProfilesMatch[1]) : null,
    );
  }

  const agentSessionMessageMatch = url.pathname.match(
    /^\/api\/agent-sessions\/([^/]+)\/messages\/([^/]+)$/,
  );

  if (agentSessionMessageMatch) {
    return handleAgentSessionMessageRoute(
      request,
      context,
      decodeURIComponent(agentSessionMessageMatch[1] ?? ""),
      decodeURIComponent(agentSessionMessageMatch[2] ?? ""),
    );
  }

  const agentSessionsMatch = url.pathname.match(/^\/api\/agent-sessions(?:\/([^/]+)(?:\/([^/]+))?)?$/);

  if (agentSessionsMatch) {
    return handleAgentSessionsRoute(
      request,
      context,
      agentSessionsMatch[1] ? decodeURIComponent(agentSessionsMatch[1]) : null,
      agentSessionsMatch[2] ? decodeURIComponent(agentSessionsMatch[2]) : null,
    );
  }

  if (url.pathname === "/api/attachments/convert") {
    return handleAttachmentConversionRoute(request);
  }

  if (url.pathname === "/api/attachments/render-image") {
    return handleAttachmentImageRenderRoute(request);
  }

  if (url.pathname === "/api/events") {
    return context.hub.stream(createReadyEvent(session));
  }

  const chatUserChoiceResolutionMatch = url.pathname.match(
    /^\/api\/chat\/user-choices\/([^/]+)\/resolve$/,
  );

  if (chatUserChoiceResolutionMatch) {
    return handleChatUserChoiceResolutionRoute(
      request,
      context,
      decodeURIComponent(chatUserChoiceResolutionMatch[1] ?? ""),
    );
  }

  if (url.pathname === "/api/chat") {
    return handleChatRoute(request, context);
  }

  const orchestrationTimerMatch = url.pathname.match(
    /^\/api\/orchestration\/timers(?:\/([^/]+)\/([^/]+))?$/,
  );

  if (orchestrationTimerMatch) {
    return handleOrchestrationTimerRoute(
      request,
      context,
      orchestrationTimerMatch[1] ? decodeURIComponent(orchestrationTimerMatch[1]) : null,
      orchestrationTimerMatch[2] ? decodeURIComponent(orchestrationTimerMatch[2]) : null,
    );
  }

  const scheduledTasksMatch = url.pathname.match(
    /^\/api\/scheduled-tasks(?:\/(sessions)|\/([^/]+)(?:\/([^/]+))?)?$/,
  );

  if (scheduledTasksMatch) {
    return handleScheduledTasksRoute(
      request,
      context,
      scheduledTasksMatch[2] ? decodeURIComponent(scheduledTasksMatch[2]) : null,
      scheduledTasksMatch[1]
        ? decodeURIComponent(scheduledTasksMatch[1])
        : scheduledTasksMatch[3]
          ? decodeURIComponent(scheduledTasksMatch[3])
          : null,
    );
  }

  if (url.pathname === "/api/workspaces/launch") {
    return handleWorkspaceLaunchRoute(request, context, port);
  }
  if (url.pathname === "/api/workspaces/pick-directory") {
    return handleWorkspaceDirectoryPickRoute(request);
  }

  if (url.pathname === "/api/workspaces/delete") {
    return handleWorkspaceDeleteRoute(request, context);
  }

  if (url.pathname === "/api/workspaces") {
    return handleWorkspacesRoute(request, context);
  }

  if (url.pathname === "/api/commands" && request.method === "POST") {
    return handleCommandRoute(request, context.agent);
  }

  const toolResolutionMatch = url.pathname.match(/^\/api\/tools\/([^/]+)\/resolve$/);

  if (toolResolutionMatch && request.method === "POST") {
    return handleToolResolutionRoute(
      request,
      decodeURIComponent(toolResolutionMatch[1] ?? ""),
      context.agent,
    );
  }

  if (url.pathname.startsWith("/api/")) {
    return json<ApiError>({ error: "Route not found" }, { status: 404 });
  }

  return serveStatic(request, context.options.publicDir);
}

function createCurrentSession(context: ServerContext, port: number): SessionInfo {
  return createSessionSnapshot({
    conversationWorkspacePath: context.options.conversationWorkspacePath,
    databasePath: context.database.path,
    llmProviders: context.getLlmProviders(),
    modelProfiles: context.getModelProfiles(),
    mcp: context.mcp.summary,
    port,
    serviceMode: context.options.serviceMode === true,
    setup: context.setup.getSetup(),
    skills: context.skills,
    startedAt: context.startedAt,
    workspacePath: context.options.workspacePath,
  });
}

function createReadyEvent(session: SessionInfo): SystemReadyEvent {
  return {
    id: createId("evt"),
    type: "system.ready",
    createdAt: now(),
    session,
  };
}
