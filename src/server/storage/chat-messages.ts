import type { Database } from "bun:sqlite";
import type {
  AgentSessionSummary,
  ChatAttachment,
  ChatCompletionMetrics,
  ChatMessage,
  ChatThinking,
  ChatToolCall,
  StoredChatMessage,
} from "../../shared/protocol.ts";
import { createId } from "../utils/id.ts";

export interface ChatMessageCreate {
  attachments?: ChatAttachment[];
  content: string;
  id: string;
  role: "user" | "assistant";
  sessionId: string;
  status?: "error" | null;
  thinking?: ChatThinking | null;
  metrics?: ChatCompletionMetrics | null;
}

export interface ChatMessageUpdate {
  attachments?: ChatAttachment[];
  content: string;
}

interface ChatMessageRow {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  status: "error" | null;
  content: string;
  attachments_json: string;
  thinking_content: string | null;
  thinking_duration_ms: number | null;
  thinking_encrypted_content: string | null;
  thinking_word_count: number | null;
  tool_calls_json: string;
  created_at: string;
  metrics_json?: string | null;
}

interface ChatMessageStatsRow {
  session_id: string;
  content: string;
}

interface ChatMessageSearchRow extends ChatMessageRow {
  session_context_size: number | null;
  session_created_at: string;
  session_id: string;
  session_model_id: string;
  session_parent_session_id: string | null;
  session_provider_id: string;
  session_temperature: number | null;
  session_title: string | null;
  session_top_k: number | null;
  session_top_p: number | null;
  session_type: AgentSessionSummary["type"];
  session_updated_at: string;
  session_workspace_path: string | null;
}

export interface ChatSessionStats {
  messageCount: number;
  wordCount: number;
}

export interface ChatMessageSearchOptions {
  includeSubAgents?: boolean;
  limit?: number;
  query: string;
}

export interface ChatMessageSearchResult {
  message: StoredChatMessage;
  session: AgentSessionSummary;
  snippet: string;
}

export class ChatMessagesRepository {
  readonly #db: Database;
  readonly #workspacePath: string | null;

  constructor(db: Database, options: { workspacePath?: string | null } = {}) {
    this.#db = db;
    this.#workspacePath = normalizeWorkspacePath(options.workspacePath);
  }

  listSessionMessages(sessionId: string): StoredChatMessage[] {
    const rows = this.#db
      .query(
        `
          SELECT id, session_id, role, status, content, attachments_json,
                 thinking_content, thinking_duration_ms, thinking_encrypted_content, thinking_word_count,
                 tool_calls_json, created_at, metrics_json
          FROM chat_messages
          WHERE session_id = ?
          ORDER BY created_at ASC
        `,
      )
      .all(sessionId) as ChatMessageRow[];

    return rows.map(rowToStoredMessage);
  }

  listSessionStats(sessionIds: string[]): Map<string, ChatSessionStats> {
    const uniqueSessionIds = [...new Set(sessionIds)];

    if (uniqueSessionIds.length === 0) {
      return new Map();
    }

    const placeholders = uniqueSessionIds.map(() => "?").join(", ");
    const rows = this.#db
      .query(
        `
          SELECT session_id, content
          FROM chat_messages
          WHERE session_id IN (${placeholders})
        `,
      )
      .all(...uniqueSessionIds) as ChatMessageStatsRow[];
    const stats = new Map<string, ChatSessionStats>();

    for (const row of rows) {
      const current = stats.get(row.session_id) ?? { messageCount: 0, wordCount: 0 };

      stats.set(row.session_id, {
        messageCount: current.messageCount + 1,
        wordCount: current.wordCount + wordCount(row.content),
      });
    }

    return stats;
  }

  searchSessionMessages(options: ChatMessageSearchOptions): ChatMessageSearchResult[] {
    const queryText = options.query.trim().toLowerCase();

    if (!queryText) {
      return [];
    }

    const limit =
      typeof options.limit === "number" && Number.isFinite(options.limit)
        ? Math.min(Math.max(1, Math.floor(options.limit)), 50)
        : 20;
    const where = [
      `(LOWER(m.content) LIKE ?
        OR LOWER(COALESCE(s.title, 'Untitled conversation')) LIKE ?)`,
    ];
    const params: Array<number | string> = [`%${queryText}%`, `%${queryText}%`];

    if (options.includeSubAgents === false) {
      where.push("s.type != 'sub-agent'");
    }

    if (this.#workspacePath) {
      where.push("s.workspace_path = ?");
      params.push(this.#workspacePath);
    }

    params.push(limit);

    const rows = this.#db
      .query(
        `
          SELECT
            m.id, m.session_id, m.role, m.status, m.content, m.attachments_json,
            m.thinking_content, m.thinking_duration_ms, m.thinking_encrypted_content, m.thinking_word_count,
            m.tool_calls_json, m.created_at, m.metrics_json,
            s.id AS session_id,
            s.type AS session_type,
            s.parent_session_id AS session_parent_session_id,
            s.title AS session_title,
            s.provider_id AS session_provider_id,
            s.model_id AS session_model_id,
            s.temperature AS session_temperature,
            s.top_p AS session_top_p,
            s.top_k AS session_top_k,
            s.context_size AS session_context_size,
            s.workspace_path AS session_workspace_path,
            s.created_at AS session_created_at,
            s.updated_at AS session_updated_at
          FROM chat_messages m
          INNER JOIN agent_sessions s ON s.id = m.session_id
          WHERE ${where.join(" AND ")}
          ORDER BY m.created_at DESC
          LIMIT ?
        `,
      )
      .all(...params) as ChatMessageSearchRow[];
    const stats = this.listSessionStats(rows.map((row) => row.session_id));

    return rows.map((row) => {
      const sessionStats = stats.get(row.session_id);

      return {
        message: rowToStoredMessage(row),
        session: {
          ...rowToSearchAgentSession(row),
          messageCount: sessionStats?.messageCount ?? 0,
          wordCount: sessionStats?.wordCount ?? 0,
        },
        snippet: createSearchSnippet(row.content, queryText),
      };
    });
  }

  syncSessionMessages(sessionId: string, messages: ChatMessage[]): void {
    const nextMessages = messages.filter(isPersistableChatMessage);

    if (nextMessages.length === 0) {
      return;
    }

    const currentMessages = this.listSessionMessages(sessionId);

    if (isMessagePrefix(currentMessages, nextMessages)) {
      this.appendSessionMessages(sessionId, nextMessages.slice(currentMessages.length));
      return;
    }

    this.replaceSessionMessages(sessionId, nextMessages);
  }

  createChatMessage(input: ChatMessageCreate): StoredChatMessage {
    const now = new Date().toISOString();
    const insert = this.#db.query(
      `
        INSERT INTO chat_messages (
          id,
          session_id,
          role,
          status,
          content,
          attachments_json,
          thinking_content,
          thinking_duration_ms,
          thinking_encrypted_content,
          thinking_word_count,
          tool_calls_json,
          created_at,
          metrics_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );
    const touchSession = this.#db.query(
      `
        UPDATE agent_sessions
        SET updated_at = ?
        WHERE id = ?
      `,
    );
    const save = this.#db.transaction(() => {
      insert.run(
        input.id,
        input.sessionId,
        input.role,
        input.status ?? null,
        input.content,
        JSON.stringify(input.attachments ?? []),
        input.thinking?.content ?? null,
        input.thinking?.durationMs ?? null,
        input.thinking?.encryptedContent ?? null,
        input.thinking?.wordCount ?? null,
        JSON.stringify(input.thinking?.toolCalls ?? []),
        now,
        input.metrics ? JSON.stringify(input.metrics) : null,
      );
      touchSession.run(now, input.sessionId);
    });

    save();

    return {
      attachments: input.attachments?.length ? input.attachments : undefined,
      content: input.content,
      createdAt: now,
      id: input.id,
      role: input.role,
      status: input.status,
      thinking: input.thinking ?? null,
      metrics: input.metrics,
    };
  }

  updateSessionMessage(
    sessionId: string,
    messageId: string,
    update: ChatMessageUpdate,
  ): StoredChatMessage | null {
    const existing = this.#db
      .query(
        `
          SELECT id, session_id, role, status, content, attachments_json,
                 thinking_content, thinking_duration_ms, thinking_encrypted_content, thinking_word_count,
                 tool_calls_json, created_at, metrics_json
          FROM chat_messages
          WHERE session_id = ? AND id = ?
        `,
      )
      .get(sessionId, messageId) as ChatMessageRow | null;

    if (!existing) {
      return null;
    }

    const nextAttachments =
      update.attachments ?? parseAttachments(existing.attachments_json) ?? [];
    const nextAttachmentsJson = JSON.stringify(nextAttachments);
    const now = new Date().toISOString();
    const updateMessage = this.#db.query(
      `
        UPDATE chat_messages
        SET content = ?, attachments_json = ?
        WHERE session_id = ? AND id = ?
      `,
    );
    const touchSession = this.#db.query(
      `
        UPDATE agent_sessions
        SET updated_at = ?
        WHERE id = ?
      `,
    );
    const save = this.#db.transaction(() => {
      updateMessage.run(update.content, nextAttachmentsJson, sessionId, messageId);
      touchSession.run(now, sessionId);
    });

    save();

    return rowToStoredMessage({
      ...existing,
      attachments_json: nextAttachmentsJson,
      content: update.content,
    });
  }

  deleteSessionMessage(sessionId: string, messageId: string): boolean {
    const now = new Date().toISOString();
    const deleteMessage = this.#db.query(
      `
        DELETE FROM chat_messages
        WHERE session_id = ? AND id = ?
      `,
    );
    const touchSession = this.#db.query(
      `
        UPDATE agent_sessions
        SET updated_at = ?
        WHERE id = ?
      `,
    );
    const remove = this.#db.transaction(() => {
      const result = deleteMessage.run(sessionId, messageId);

      if (result.changes > 0) {
        touchSession.run(now, sessionId);
      }

      return result.changes > 0;
    });

    return remove();
  }

  copySessionMessages(sourceSessionId: string, targetSessionId: string): void {
    const messages = this.listSessionMessages(sourceSessionId);

    if (messages.length === 0) {
      return;
    }

    const now = Date.now();
    const insert = this.#db.query(
      `
        INSERT INTO chat_messages (
          id,
          session_id,
          role,
          content,
          attachments_json,
          thinking_content,
          thinking_duration_ms,
          thinking_encrypted_content,
          thinking_word_count,
          tool_calls_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );
    const touchSession = this.#db.query(
      `
        UPDATE agent_sessions
        SET updated_at = ?
        WHERE id = ?
      `,
    );
    const copy = this.#db.transaction(() => {
      for (const [index, message] of messages.entries()) {
        insert.run(
          createId("msg"),
          targetSessionId,
          message.role,
          message.content,
          JSON.stringify(message.attachments ?? []),
          message.thinking?.content ?? null,
          message.thinking?.durationMs ?? null,
          message.thinking?.encryptedContent ?? null,
          message.thinking?.wordCount ?? null,
          JSON.stringify(message.thinking?.toolCalls ?? []),
          new Date(now + index).toISOString(),
        );
      }

      touchSession.run(new Date(now + messages.length).toISOString(), targetSessionId);
    });

    copy();
  }

  private appendSessionMessages(sessionId: string, messages: PersistableChatMessage[]): void {
    if (messages.length === 0) {
      return;
    }

    const now = Date.now();
    const insert = this.#db.query(
      `
        INSERT INTO chat_messages (
          id,
          session_id,
          role,
          status,
          content,
          attachments_json,
          thinking_content,
          thinking_duration_ms,
          thinking_encrypted_content,
          thinking_word_count,
          tool_calls_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, '[]', ?)
      `,
    );
    const touchSession = this.#db.query(
      `
        UPDATE agent_sessions
        SET updated_at = ?
        WHERE id = ?
      `,
    );
    const save = this.#db.transaction(() => {
      for (const [index, message] of messages.entries()) {
        insert.run(
          createId("msg"),
          sessionId,
          message.role,
          message.status ?? null,
          message.content,
          JSON.stringify(message.attachments ?? []),
          new Date(now + index).toISOString(),
        );
      }

      touchSession.run(new Date(now + messages.length).toISOString(), sessionId);
    });

    save();
  }

  private replaceSessionMessages(sessionId: string, messages: PersistableChatMessage[]): void {
    const now = Date.now();
    const deleteMessages = this.#db.query("DELETE FROM chat_messages WHERE session_id = ?");
    const insert = this.#db.query(
      `
        INSERT INTO chat_messages (
          id,
          session_id,
          role,
          status,
          content,
          attachments_json,
          thinking_content,
          thinking_duration_ms,
          thinking_encrypted_content,
          thinking_word_count,
          tool_calls_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, '[]', ?)
      `,
    );
    const touchSession = this.#db.query(
      `
        UPDATE agent_sessions
        SET updated_at = ?
        WHERE id = ?
      `,
    );
    const replace = this.#db.transaction(() => {
      deleteMessages.run(sessionId);

      for (const [index, message] of messages.entries()) {
        insert.run(
          createId("msg"),
          sessionId,
          message.role,
          message.status ?? null,
          message.content,
          JSON.stringify(message.attachments ?? []),
          new Date(now + index).toISOString(),
        );
      }

      touchSession.run(new Date(now + messages.length).toISOString(), sessionId);
    });

    replace();
  }
}

type PersistableChatMessage = ChatMessage & { role: "user" | "assistant" };

function isPersistableChatMessage(message: ChatMessage): message is PersistableChatMessage {
  return message.role === "user" || message.role === "assistant";
}

function isMessagePrefix(
  currentMessages: StoredChatMessage[],
  nextMessages: PersistableChatMessage[],
): boolean {
  if (currentMessages.length > nextMessages.length) {
    return false;
  }

  return currentMessages.every((currentMessage, index) => {
    const nextMessage = nextMessages[index];

    return nextMessage ? messagesMatch(currentMessage, nextMessage) : false;
  });
}

function messagesMatch(
  currentMessage: StoredChatMessage,
  nextMessage: PersistableChatMessage,
): boolean {
  return (
    currentMessage.role === nextMessage.role &&
    currentMessage.content === nextMessage.content &&
    (currentMessage.status ?? null) === (nextMessage.status ?? null) &&
    JSON.stringify(currentMessage.attachments ?? []) ===
      JSON.stringify(nextMessage.attachments ?? [])
  );
}

function rowToStoredMessage(row: ChatMessageRow): StoredChatMessage {
  const toolCalls = parseToolCalls(row.tool_calls_json);
  const encryptedContent = row.thinking_encrypted_content?.trim() || undefined;
  const metrics = row.metrics_json ? parseMetrics(row.metrics_json) : null;

  return {
    attachments: parseAttachments(row.attachments_json),
    content: row.content,
    createdAt: row.created_at,
    id: row.id,
    role: row.role,
    status: row.status || undefined,
    thinking:
      row.thinking_content !== null
        ? {
            content: row.thinking_content,
            durationMs: row.thinking_duration_ms ?? 0,
            ...(encryptedContent ? { encryptedContent } : {}),
            toolCalls,
            wordCount: row.thinking_word_count ?? wordCount(row.thinking_content),
          }
        : toolCalls.length > 0 || encryptedContent
          ? {
              content: "",
              durationMs: row.thinking_duration_ms ?? 0,
              ...(encryptedContent ? { encryptedContent } : {}),
              toolCalls,
              wordCount: row.thinking_word_count ?? 0,
            }
        : null,
    metrics,
  };
}

function parseMetrics(value: string): ChatCompletionMetrics | null {
  try {
    return JSON.parse(value) as ChatCompletionMetrics;
  } catch {
    return null;
  }
}

function rowToSearchAgentSession(row: ChatMessageSearchRow): AgentSessionSummary {
  return {
    id: row.session_id,
    type: row.session_type,
    parentSessionId: row.session_parent_session_id,
    title: row.session_title,
    providerId: row.session_provider_id,
    modelId: row.session_model_id,
    messageCount: 0,
    parameters: {
      temperature: row.session_temperature,
      topP: row.session_top_p,
      topK: row.session_top_k,
      contextSize: row.session_context_size,
    },
    wordCount: 0,
    createdAt: row.session_created_at,
    updatedAt: row.session_updated_at,
    workspacePath: row.session_workspace_path,
  };
}

function normalizeWorkspacePath(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function createSearchSnippet(content: string, queryText: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  const matchIndex = lower.indexOf(queryText);

  if (matchIndex < 0) {
    return truncateSnippet(normalized, 240);
  }

  const start = Math.max(0, matchIndex - 90);
  const end = Math.min(normalized.length, matchIndex + queryText.length + 130);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalized.length ? "..." : "";

  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}

function truncateSnippet(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function parseAttachments(value: string): ChatAttachment[] | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return undefined;
    }

    return parsed.filter(isChatAttachment);
  } catch {
    return undefined;
  }
}

function isChatAttachment(value: unknown): value is ChatAttachment {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as ChatAttachment).id === "string" &&
    typeof (value as ChatAttachment).name === "string" &&
    typeof (value as ChatAttachment).dataUrl === "string" &&
    typeof (value as ChatAttachment).mimeType === "string" &&
    typeof (value as ChatAttachment).size === "number" &&
    ["image", "text", "document"].includes((value as ChatAttachment).kind)
  );
}

function parseToolCalls(value: string): ChatToolCall[] {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isChatToolCall);
  } catch {
    return [];
  }
}

function isChatToolCall(value: unknown): value is ChatToolCall {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const call = value as Partial<ChatToolCall>;

  return (
    typeof call.id === "string" &&
    typeof call.startedAt === "string" &&
    typeof call.title === "string" &&
    typeof call.toolId === "string" &&
    call.toolId.trim().length > 0 &&
    (call.status === "running" || call.status === "completed" || call.status === "error") &&
    Boolean(call.args) &&
    typeof call.args === "object" &&
    !Array.isArray(call.args)
  );
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}
