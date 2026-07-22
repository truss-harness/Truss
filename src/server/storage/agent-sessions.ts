import type { Database } from "bun:sqlite";
import type {
  AgentSessionSummary,
  AgentSessionType,
  LlmGenerationParameters,
  WorkspaceSummary,
} from "../../shared/protocol.ts";

export interface AgentSessionCreate {
  id: string;
  type: AgentSessionType;
  parentSessionId: string | null;
  title: string | null;
  providerId: string;
  modelId: string;
  parameters: LlmGenerationParameters;
  workspacePath?: string | null;
}

interface AgentSessionListOptions {
  excludeScheduledTaskSessions?: boolean;
  includeSubAgents?: boolean;
  includeWorkspaceSessions?: boolean;
  limit?: number;
  search?: string | null;
}

interface AgentSessionRow {
  id: string;
  type: AgentSessionType;
  parent_session_id: string | null;
  title: string | null;
  provider_id: string;
  model_id: string;
  temperature: number | null;
  top_p: number | null;
  top_k: number | null;
  context_size: number | null;
  workspace_path: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkspaceSummaryRow {
  first_created_at: string;
  last_active_at: string;
  last_created_at: string;
  session_count: number;
  workspace_path: string;
}

interface CountRow {
  count: number;
}

export class AgentSessionsRepository {
  readonly #db: Database;
  readonly #workspacePath: string | null;

  constructor(db: Database, options: { workspacePath?: string | null } = {}) {
    this.#db = db;
    this.#workspacePath = normalizeWorkspacePath(options.workspacePath);
  }

  listAgentSessions(options: AgentSessionListOptions = {}): AgentSessionSummary[] {
    const where: string[] = [];
    const params: Array<number | string> = [];
    const search = options.search?.trim().toLowerCase();
    const scope = this.#scopeWhere("workspace_path");

    if (scope) {
      where.push(scope.sql);
      params.push(...scope.params);
    }

    if (options.includeSubAgents === false) {
      where.push("type != 'sub-agent'");
    }

    if (options.includeWorkspaceSessions === false) {
      where.push("workspace_path IS NULL");
    }

    if (options.excludeScheduledTaskSessions) {
      where.push(
        "id NOT IN (SELECT root_session_id FROM scheduled_tasks WHERE root_session_id IS NOT NULL)",
      );
    }

    if (search) {
      const query = `%${search}%`;

      where.push(
        `(LOWER(COALESCE(title, 'Untitled conversation')) LIKE ?
          OR LOWER(type) LIKE ?
          OR LOWER(model_id) LIKE ?
          OR LOWER(provider_id) LIKE ?)`,
      );
      params.push(query, query, query, query);
    }

    const limitSql =
      typeof options.limit === "number" && Number.isFinite(options.limit)
        ? "LIMIT ?"
        : "";

    if (limitSql) {
      params.push(Math.max(1, Math.floor(options.limit ?? 1)));
    }

    const rows = this.#db
      .query(
        `
          SELECT id, type, parent_session_id, title, provider_id, model_id,
                 temperature, top_p, top_k, context_size, workspace_path,
                 created_at, updated_at
          FROM agent_sessions
          ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY updated_at DESC
          ${limitSql}
        `,
      )
      .all(...params) as AgentSessionRow[];

    return rows.map(rowToAgentSession);
  }

  listWorkspaces(): WorkspaceSummary[] {
    const rows = this.#db
      .query(
        `
          SELECT
            workspace_path,
            COUNT(*) AS session_count,
            MIN(created_at) AS first_created_at,
            MAX(created_at) AS last_created_at,
            MAX(updated_at) AS last_active_at
          FROM agent_sessions
          WHERE workspace_path IS NOT NULL
            AND TRIM(workspace_path) <> ''
            AND type != 'sub-agent'
          GROUP BY workspace_path
          ORDER BY MAX(updated_at) DESC, workspace_path COLLATE NOCASE ASC
        `,
      )
      .all() as WorkspaceSummaryRow[];

    return rows.map(rowToWorkspaceSummary);
  }

  getAgentSession(sessionId: string): AgentSessionSummary | null {
    const scope = this.#scopeWhere("workspace_path");
    const where = scope ? "id = ? AND " + scope.sql : "id = ?";
    const params = scope ? [sessionId, ...scope.params] : [sessionId];
    const row = this.#db
      .query(
        `
          SELECT id, type, parent_session_id, title, provider_id, model_id,
                 temperature, top_p, top_k, context_size, workspace_path,
                 created_at, updated_at
          FROM agent_sessions
          WHERE ${where}
        `,
      )
      .get(...params) as AgentSessionRow | null;

    return row ? rowToAgentSession(row) : null;
  }

  createAgentSession(input: AgentSessionCreate): AgentSessionSummary {
    if (input.type === "sub-agent" && !input.parentSessionId) {
      throw new Error("Sub-agent sessions require a parent session");
    }

    if (input.type !== "sub-agent" && input.parentSessionId) {
      throw new Error("Only sub-agent sessions may have a parent session");
    }

    const parentSession = input.parentSessionId
      ? this.getAgentSession(input.parentSessionId)
      : null;

    if (input.parentSessionId && !parentSession) {
      throw new Error("Parent session does not exist");
    }

    const now = new Date().toISOString();
    const workspacePath = normalizeWorkspacePath(
      input.workspacePath ?? parentSession?.workspacePath ?? this.#workspacePath,
    );

    this.#db
      .query(
        `
          INSERT INTO agent_sessions (
            id,
            type,
            parent_session_id,
            title,
            provider_id,
            model_id,
            temperature,
            top_p,
            top_k,
            context_size,
            workspace_path,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.id,
        input.type,
        input.parentSessionId,
        input.title,
        input.providerId,
        input.modelId,
        input.parameters.temperature,
        input.parameters.topP,
        input.parameters.topK,
        input.parameters.contextSize,
        workspacePath,
        now,
        now,
      );

    const created = this.getAgentSession(input.id);

    if (!created) {
      throw new Error("Could not read created agent session");
    }

    return created;
  }

  updateAgentSessionTitle(sessionId: string, title: string | null): AgentSessionSummary | null {
    const scope = this.#scopeWhere("workspace_path");
    const where = scope ? "id = ? AND " + scope.sql : "id = ?";
    const params = scope ? [sessionId, ...scope.params] : [sessionId];

    this.#db
      .query(
        `
          UPDATE agent_sessions
          SET title = ?,
              updated_at = ?
          WHERE ${where}
        `,
      )
      .run(title, new Date().toISOString(), ...params);

    return this.getAgentSession(sessionId);
  }

  deleteAgentSession(sessionId: string): boolean {
    const scope = this.#scopeWhere("workspace_path");
    const where = scope ? "id = ? AND " + scope.sql : "id = ?";
    const params = scope ? [sessionId, ...scope.params] : [sessionId];
    const result = this.#db
      .query(`DELETE FROM agent_sessions WHERE ${where}`)
      .run(...params);

    return result.changes > 0;
  }

  deleteWorkspaceSessions(workspacePath: string): number {
    const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);

    if (!normalizedWorkspacePath) {
      return 0;
    }

    const row = this.#db
      .query(
        `
          SELECT COUNT(*) AS count
          FROM agent_sessions
          WHERE workspace_path = ?
            AND type != 'sub-agent'
        `,
      )
      .get(normalizedWorkspacePath) as CountRow | null;
    const sessionCount = row?.count ?? 0;

    this.#db
      .query(
        `
          DELETE FROM agent_sessions
          WHERE workspace_path = ?
            AND type != 'sub-agent'
        `,
      )
      .run(normalizedWorkspacePath);

    return sessionCount;
  }

  #scopeWhere(column: string): { params: string[]; sql: string } | null {
    return this.#workspacePath ? { sql: `${column} = ?`, params: [this.#workspacePath] } : null;
  }
}

function rowToAgentSession(row: AgentSessionRow): AgentSessionSummary {
  return {
    id: row.id,
    type: row.type,
    parentSessionId: row.parent_session_id,
    title: row.title,
    providerId: row.provider_id,
    modelId: row.model_id,
    messageCount: 0,
    parameters: {
      temperature: row.temperature,
      topP: row.top_p,
      topK: row.top_k,
      contextSize: row.context_size,
    },
    wordCount: 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    workspacePath: row.workspace_path,
  };
}

function rowToWorkspaceSummary(row: WorkspaceSummaryRow): WorkspaceSummary {
  return {
    displayName: workspaceDisplayName(row.workspace_path),
    firstCreatedAt: row.first_created_at,
    lastActiveAt: row.last_active_at,
    lastCreatedAt: row.last_created_at,
    sessionCount: row.session_count,
    workspacePath: row.workspace_path,
  };
}

function workspaceDisplayName(workspacePath: string): string {
  const trimmed = workspacePath.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]+/).filter(Boolean);

  return parts.at(-1) ?? workspacePath;
}

function normalizeWorkspacePath(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}
