import { statSync } from "node:fs";
import type {
  AgentSessionCreateRequest,
  AgentSessionDeleteResponse,
  AgentSessionDetailResponse,
  AgentSessionMessageDeleteResponse,
  AgentSessionMessageUpdateRequest,
  AgentSessionRenameRequest,
  AgentSessionSummary,
  AgentSessionsResponse,
  AgentSessionType,
  ApiError,
  ChatAttachment,
  LlmGenerationParameters,
} from "../../shared/protocol.ts";
import {
  defaultProfileIdForAgentSessionType,
} from "../llm/model-profiles.ts";
import { getLlmProvider } from "../llm/registry.ts";
import { generateConversationTitle } from "../internal-ai/truss-internal-ai-services.ts";
import { createId } from "../utils/id.ts";
import { now } from "../utils/time.ts";
import { json, readJson } from "./responses.ts";
import { validateChatAttachments } from "./chat-attachments.ts";
import type { ServerContext } from "./context.ts";
import {
  exportSystemMessageForSession,
  exportToolDefinitionsForSession,
} from "./chat-system-prompt.ts";
import {
  isModelProfileId,
  validateGenerationParameters,
} from "./routes-model-profiles.ts";
import referenceDocPath from "../../assets/reference.docx" with {
  type: "file",
};
import { convertMarkdownToDocx } from "../pandoc.ts";

const agentSessionTypes: AgentSessionType[] = ["conversation", "agentic", "sub-agent"];
const maxTitleLength = 240;
const maxMessageContentLength = 80_000;
const maxModelLength = 160;
const maxAgentSessionListLimit = 200;

export async function handleAgentSessionsRoute(
  request: Request,
  context: ServerContext,
  sessionId: string | null = null,
  action: string | null = null,
): Promise<Response> {
  if (sessionId) {
    return handleAgentSessionDetailRoute(request, context, sessionId, action);
  }

  if (request.method === "GET") {
    return agentSessionsResponse(request, context);
  }

  if (request.method !== "POST") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJson<AgentSessionCreateRequest>(request);
  const validation = validateAgentSessionCreate(body, context);

  if (!validation.ok) {
    return json<ApiError>({ error: validation.error }, { status: 400 });
  }

  const created = context.agentSessions.createAgentSession({
    id: createId("session"),
    ...validation.session,
  });

  return json(withSessionOriginMetadata(created), { status: 201 });
}

export async function handleAgentSessionMessageRoute(
  request: Request,
  context: ServerContext,
  sessionId: string,
  messageId: string,
): Promise<Response> {
  if (!context.agentSessions.getAgentSession(sessionId)) {
    return json<ApiError>({ error: "Agent session does not exist" }, { status: 404 });
  }

  if (request.method === "PATCH") {
    const body = await readJson<AgentSessionMessageUpdateRequest>(request);
    const validation = validateAgentSessionMessageUpdate(body);

    if (!validation.ok) {
      return json<ApiError>({ error: validation.error }, { status: 400 });
    }

    const updated = context.chatMessages.updateSessionMessage(
      sessionId,
      messageId,
      {
        attachments: validation.attachments,
        content: validation.content,
      },
    );

    if (!updated) {
      return json<ApiError>({ error: "Message does not exist" }, { status: 404 });
    }

    return json(updated);
  }

  if (request.method === "DELETE") {
    const deleted = context.chatMessages.deleteSessionMessage(sessionId, messageId);

    if (!deleted) {
      return json<ApiError>({ error: "Message does not exist" }, { status: 404 });
    }

    return json<AgentSessionMessageDeleteResponse>({ deleted: true });
  }

  return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
}

async function handleAgentSessionDetailRoute(
  request: Request,
  context: ServerContext,
  sessionId: string,
  action: string | null,
): Promise<Response> {
  if (action === "duplicate") {
    return duplicateAgentSession(request, context, sessionId);
  }

  if (action === "auto-rename") {
    return autoRenameAgentSession(request, context, sessionId);
  }

  if (action === "export-docx") {
    return handleAgentSessionDocxExportRoute(request, context, sessionId);
  }

  if (action) {
    return json<ApiError>({ error: "Route not found" }, { status: 404 });
  }

  const session = context.agentSessions.getAgentSession(sessionId);

  if (!session) {
    return json<ApiError>({ error: "Agent session does not exist" }, { status: 404 });
  }

  if (request.method === "PATCH") {
    const body = await readJson<AgentSessionRenameRequest>(request);
    const validation = validateAgentSessionRename(body);

    if (!validation.ok) {
      return json<ApiError>({ error: validation.error }, { status: 400 });
    }

    const updated = context.agentSessions.updateAgentSessionTitle(sessionId, validation.title);

    if (!updated) {
      return json<ApiError>({ error: "Agent session does not exist" }, { status: 404 });
    }

    publishTitleEvent(context, updated);
    return json(withMessageStats(context, [updated])[0] ?? withSessionOriginMetadata(updated));
  }

  if (request.method === "DELETE") {
    const deleted = context.agentSessions.deleteAgentSession(sessionId);

    if (!deleted) {
      return json<ApiError>({ error: "Agent session does not exist" }, { status: 404 });
    }

    return json<AgentSessionDeleteResponse>({ deleted: true });
  }

  if (request.method !== "GET") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const sessionWithStats = withMessageStats(context, [session])[0] ?? withSessionOriginMetadata(session);

  return json<AgentSessionDetailResponse>({
    session: sessionWithStats,
    systemMessage: exportSystemMessageForSession({
      context,
      sessionType: session.type,
    }),
    tools: exportToolDefinitionsForSession({
      context,
      sessionType: session.type,
    }),
    messages: context.chatMessages.listSessionMessages(sessionId),
  });
}

function duplicateAgentSession(
  request: Request,
  context: ServerContext,
  sessionId: string,
): Response {
  if (request.method !== "POST") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const session = context.agentSessions.getAgentSession(sessionId);

  if (!session) {
    return json<ApiError>({ error: "Agent session does not exist" }, { status: 404 });
  }

  const created = context.agentSessions.createAgentSession({
    id: createId("session"),
    type: session.type === "sub-agent" ? "conversation" : session.type,
    parentSessionId: session.type === "sub-agent" ? null : session.parentSessionId,
    title: duplicateTitle(session.title),
    providerId: session.providerId,
    modelId: session.modelId,
    parameters: session.parameters,
    workspacePath: session.workspacePath,
  });

  context.chatMessages.copySessionMessages(session.id, created.id);

  return json(
    withMessageStats(context, [context.agentSessions.getAgentSession(created.id) ?? created])[0] ??
      withSessionOriginMetadata(created),
    {
      status: 201,
    },
  );
}

async function autoRenameAgentSession(
  request: Request,
  context: ServerContext,
  sessionId: string,
): Promise<Response> {
  if (request.method !== "POST") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const session = context.agentSessions.getAgentSession(sessionId);

  if (!session) {
    return json<ApiError>({ error: "Agent session does not exist" }, { status: 404 });
  }

  const messages = context.chatMessages.listSessionMessages(sessionId);

  try {
    const title = await generateConversationTitle(context, messages);

    if (!title) {
      return json<ApiError>({ error: "This conversation does not have enough text to rename." }, {
        status: 400,
      });
    }

    const updated = context.agentSessions.updateAgentSessionTitle(sessionId, title);

    if (!updated) {
      return json<ApiError>({ error: "Agent session does not exist" }, { status: 404 });
    }

    publishTitleEvent(context, updated);
    return json(withMessageStats(context, [updated])[0] ?? withSessionOriginMetadata(updated));
  } catch (caught) {
    return json<ApiError>({ error: errorMessage(caught) }, { status: 400 });
  }
}

function agentSessionsResponse(request: Request, context: ServerContext): Response {
  const url = new URL(request.url);
  const search = normalizeOptionalText(url.searchParams.get("search"));
  const limit = normalizeListLimit(url.searchParams.get("limit"));
  const includeSubAgents = url.searchParams.get("includeSubAgents") !== "false";
  const includeWorkspaceSessions = context.options.conversationWorkspacePath
    ? true
    : url.searchParams.get("includeWorkspaceSessions") !== "false";
  const excludeScheduledTaskSessions =
    url.searchParams.get("excludeScheduledTaskSessions") === "true";

  return json<AgentSessionsResponse>({
    sessions: withMessageStats(
      context,
      context.agentSessions.listAgentSessions({
        excludeScheduledTaskSessions,
        includeSubAgents,
        includeWorkspaceSessions,
        limit,
        search,
      }),
    ),
  });
}

function withMessageStats(
  context: ServerContext,
  sessions: AgentSessionSummary[],
): AgentSessionSummary[] {
  const stats = context.chatMessages.listSessionStats(sessions.map((session) => session.id));

  return sessions.map((session) => {
    const sessionStats = stats.get(session.id);

    return withSessionOriginMetadata({
      ...session,
      messageCount: sessionStats?.messageCount ?? 0,
      wordCount: sessionStats?.wordCount ?? 0,
    });
  });
}

function withSessionOriginMetadata(session: AgentSessionSummary): AgentSessionSummary {
  if (!session.workspacePath) {
    return {
      ...session,
      originContext: "global",
    };
  }

  return {
    ...session,
    originContext: "workspace",
    workspaceDisplayName: workspaceDisplayName(session.workspacePath),
    workspaceExists: workspaceExists(session.workspacePath),
  };
}

function workspaceDisplayName(workspacePath: string): string {
  const trimmed = workspacePath.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]+/).filter(Boolean);

  return parts.at(-1) ?? workspacePath;
}

function workspaceExists(workspacePath: string): boolean {
  try {
    return statSync(workspacePath).isDirectory();
  } catch {
    return false;
  }
}

function validateAgentSessionCreate(
  body: AgentSessionCreateRequest | null,
  context: ServerContext,
):
  | {
      ok: true;
      session: {
        type: AgentSessionType;
        parentSessionId: string | null;
        title: string | null;
        providerId: string;
        modelId: string;
        parameters: LlmGenerationParameters;
      };
    }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Agent session payload must be an object" };
  }

  if (!isAgentSessionType(body.type)) {
    return { ok: false, error: "type must be conversation, agentic, or sub-agent" };
  }

  const parentSessionId = normalizeOptionalText(body.parentSessionId);

  if (body.type === "sub-agent" && !parentSessionId) {
    return { ok: false, error: "sub-agent sessions require parentSessionId" };
  }

  if (body.type !== "sub-agent" && parentSessionId) {
    return { ok: false, error: "Only sub-agent sessions may have parentSessionId" };
  }

  if (parentSessionId && !context.agentSessions.getAgentSession(parentSessionId)) {
    return { ok: false, error: "Parent session does not exist" };
  }

  const profileId = body.profileId ?? defaultProfileIdForAgentSessionType(body.type);

  if (!isModelProfileId(profileId)) {
    return { ok: false, error: "Unknown model profile" };
  }

  const profile = context.modelProfiles.getModelProfile(profileId);

  if (!profile) {
    return { ok: false, error: "Model profile is not configured" };
  }

  const providerId = normalizeOptionalText(body.providerId) ?? profile.providerId;

  if (!getLlmProvider(providerId)) {
    return { ok: false, error: "Unknown LLM provider" };
  }

  const modelId = normalizeOptionalText(body.modelId) ?? profile.modelId;

  if (modelId.length > maxModelLength) {
    return { ok: false, error: "modelId is too long" };
  }

  const parameterPatch = body.parameters
    ? validateGenerationParameters(body.parameters)
    : ({ ok: true, parameters: {} } as const);

  if (!parameterPatch.ok) {
    return parameterPatch;
  }

  const title = normalizeOptionalText(body.title);

  if (title && title.length > maxTitleLength) {
    return { ok: false, error: "title is too long" };
  }

  return {
    ok: true,
    session: {
      type: body.type,
      parentSessionId,
      title,
      providerId,
      modelId,
      parameters: {
        ...profile.parameters,
        ...parameterPatch.parameters,
      },
    },
  };
}

function validateAgentSessionRename(
  body: AgentSessionRenameRequest | null,
): { ok: true; title: string | null } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Agent session rename payload must be an object" };
  }

  const title = normalizeOptionalText(body.title);

  if (title && title.length > maxTitleLength) {
    return { ok: false, error: "title is too long" };
  }

  return { ok: true, title };
}

function validateAgentSessionMessageUpdate(
  body: AgentSessionMessageUpdateRequest | null,
): { ok: true; attachments?: ChatAttachment[]; content: string } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Message update payload must be an object" };
  }

  if (typeof body.content !== "string") {
    return { ok: false, error: "Message content is required" };
  }

  if (body.content.length > maxMessageContentLength) {
    return { ok: false, error: "Message content is too long" };
  }

  const attachmentValidation = validateChatAttachments(body.attachments);

  if (!attachmentValidation.ok) {
    return attachmentValidation;
  }

  if (
    body.attachments !== undefined &&
    !body.content.trim() &&
    attachmentValidation.attachments.length === 0
  ) {
    return { ok: false, error: "Message content or attachments are required." };
  }

  return {
    ok: true,
    attachments: body.attachments === undefined ? undefined : attachmentValidation.attachments,
    content: body.content,
  };
}

function isAgentSessionType(value: string): value is AgentSessionType {
  return agentSessionTypes.includes(value as AgentSessionType);
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeListLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.min(parsed, maxAgentSessionListLimit);
}

function duplicateTitle(title: string | null): string {
  const base = title ?? "Untitled conversation";
  const nextTitle = `Copy of ${base}`;

  return nextTitle.length <= maxTitleLength ? nextTitle : `${nextTitle.slice(0, maxTitleLength - 3)}...`;
}

function publishTitleEvent(context: ServerContext, session: AgentSessionSummary): void {
  context.hub.publish({
    id: createId("evt"),
    type: "agent.session.title",
    createdAt: now(),
    sessionId: session.id,
    title: session.title,
  });
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

export async function handleAgentSessionDocxExportRoute(
  request: Request,
  context: ServerContext,
  sessionId: string,
): Promise<Response> {
  if (request.method !== "GET") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const session = context.agentSessions.getAgentSession(sessionId);

  if (!session) {
    return json<ApiError>({ error: "Agent session does not exist" }, { status: 404 });
  }

  const messages = context.chatMessages.listSessionMessages(sessionId);
  const sessionWithStats = withMessageStats(context, [session])[0] ?? withSessionOriginMetadata(session);

  const title = sessionWithStats.title ?? "Untitled conversation";
  const lines = [
    `# ${title}`,
    "",
    `Exported from Truss on ${new Date().toLocaleString()}.`,
    "",
    `Model: ${sessionWithStats.modelId}`,
    "",
  ];

  for (const message of messages) {
    const label = message.role === "user" ? "You" : "Assistant";
    lines.push(`## ${label}`, "");

    if (message.thinking?.content) {
      lines.push("### Thinking", "", message.thinking.content, "");
    }

    lines.push(message.content || "_No message content._", "");

    if (message.attachments?.length) {
      lines.push("Attachments:", "");

      for (const attachment of message.attachments) {
        lines.push(
          `- ${attachment.name} (${attachment.mimeType || "file"}, ${formatLocalFileSize(
            attachment.size,
          )})`,
        );
      }

      lines.push("");
    }
  }

  const markdown = `${lines.join("\n").trim()}\n`;

  try {
    const referenceDocBlob = Bun.file(referenceDocPath);
    const docxBlob = await convertMarkdownToDocx(markdown, referenceDocBlob);
    const docxBuffer = await docxBlob.arrayBuffer();

    const fileBaseName = title
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 80)
      .trim() || "truss-conversation";

    return new Response(docxBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${fileBaseName}.docx"`,
        "Content-Length": String(docxBuffer.byteLength),
      },
    });
  } catch (error) {
    return json<ApiError>(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

function formatLocalFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
