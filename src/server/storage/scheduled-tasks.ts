import type { Database } from "bun:sqlite";
import type {
  AgentSessionType,
  LlmGenerationParameters,
  ScheduledTaskCreatedBy,
  ScheduledTaskRunStatus,
  ScheduledTaskRunSummary,
  ScheduledTaskRunTrigger,
  ScheduledTaskSessionSummary,
  ScheduledTaskSummary,
} from "../../shared/protocol.ts";

export interface ScheduledTaskCreate {
  id: string;
  name: string;
  prompt: string;
  cronExpression: string;
  timezone?: string | null;
  workingDirectory?: string | null;
  workspacePath?: string | null;
  providerId: string;
  modelId: string;
  parameters: LlmGenerationParameters;
  allowOverlap?: boolean;
  enabled?: boolean;
  createdBy: ScheduledTaskCreatedBy;
  createdBySessionId?: string | null;
}

export interface ScheduledTaskUpdate {
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

interface ScheduledTaskListOptions {
  enabledOnly?: boolean;
}

interface ScheduledTaskRow {
  id: string;
  name: string;
  prompt: string;
  cron_expression: string;
  timezone: string | null;
  working_directory: string | null;
  workspace_path: string | null;
  provider_id: string;
  model_id: string;
  temperature: number | null;
  top_p: number | null;
  top_k: number | null;
  context_size: number | null;
  allow_overlap: number;
  enabled: number;
  created_by: ScheduledTaskCreatedBy;
  created_by_session_id: string | null;
  root_session_id: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ScheduledTaskRunRow {
  id: string;
  task_id: string;
  session_id: string | null;
  status: ScheduledTaskRunStatus;
  trigger: ScheduledTaskRunTrigger;
  allow_overlap: number;
  summary: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

interface ScheduledTaskSessionRow {
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
  task_id: string;
  task_name: string;
  run_started_at: string;
}

/**
 * Stores scheduled task definitions and their run history. Follows the
 * same workspace-scoping convention as AgentSessionsRepository: a repository
 * bound to a workspace path only ever reads/writes rows for that workspace,
 * while a repository bound to null (the global instance) sees every row.
 */
export class ScheduledTasksRepository {
  readonly #db: Database;
  readonly #workspacePath: string | null;

  constructor(db: Database, options: { workspacePath?: string | null } = {}) {
    this.#db = db;
    this.#workspacePath = normalizeWorkspacePath(options.workspacePath);
  }

  listScheduledTasks(options: ScheduledTaskListOptions = {}): ScheduledTaskSummary[] {
    const where: string[] = [];
    const params: Array<number | string> = [];
    const scope = this.#scopeWhere();

    if (scope) {
      where.push(scope.sql);
      params.push(...scope.params);
    }

    if (options.enabledOnly) {
      where.push("enabled = 1");
    }

    const rows = this.#db
      .query(
        `
          SELECT id, name, prompt, cron_expression, timezone, working_directory,
                 workspace_path, provider_id, model_id, temperature, top_p, top_k,
                 context_size, allow_overlap, enabled, created_by, created_by_session_id,
                 root_session_id, last_run_at, created_at, updated_at
          FROM scheduled_tasks
          ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY created_at DESC
        `,
      )
      .all(...params) as ScheduledTaskRow[];

    return rows.map(rowToScheduledTask);
  }

  getScheduledTask(taskId: string): ScheduledTaskSummary | null {
    const scope = this.#scopeWhere();
    const where = scope ? "id = ? AND " + scope.sql : "id = ?";
    const params = scope ? [taskId, ...scope.params] : [taskId];
    const row = this.#db
      .query(
        `
          SELECT id, name, prompt, cron_expression, timezone, working_directory,
                 workspace_path, provider_id, model_id, temperature, top_p, top_k,
                 context_size, allow_overlap, enabled, created_by, created_by_session_id,
                 root_session_id, last_run_at, created_at, updated_at
          FROM scheduled_tasks
          WHERE ${where}
        `,
      )
      .get(...params) as ScheduledTaskRow | null;

    return row ? rowToScheduledTask(row) : null;
  }

  /**
   * Lists only truly global tasks (workspace_path IS NULL), ignoring this
   * repository instance's own workspace scope. Used to grant a workspace-
   * scoped LLM read access to global tasks after it obtains a permission
   * grant, without exposing other workspaces' private tasks.
   */
  listGlobalScheduledTasks(options: ScheduledTaskListOptions = {}): ScheduledTaskSummary[] {
    const where = ["workspace_path IS NULL"];

    if (options.enabledOnly) {
      where.push("enabled = 1");
    }

    const rows = this.#db
      .query(
        `
          SELECT id, name, prompt, cron_expression, timezone, working_directory,
                 workspace_path, provider_id, model_id, temperature, top_p, top_k,
                 context_size, allow_overlap, enabled, created_by, created_by_session_id,
                 root_session_id, last_run_at, created_at, updated_at
          FROM scheduled_tasks
          WHERE ${where.join(" AND ")}
          ORDER BY created_at DESC
        `,
      )
      .all() as ScheduledTaskRow[];

    return rows.map(rowToScheduledTask);
  }

  /** Reads a single global task (workspace_path IS NULL) regardless of this repository's own scope. */
  getGlobalScheduledTask(taskId: string): ScheduledTaskSummary | null {
    const row = this.#db
      .query(
        `
          SELECT id, name, prompt, cron_expression, timezone, working_directory,
                 workspace_path, provider_id, model_id, temperature, top_p, top_k,
                 context_size, allow_overlap, enabled, created_by, created_by_session_id,
                 root_session_id, last_run_at, created_at, updated_at
          FROM scheduled_tasks
          WHERE id = ? AND workspace_path IS NULL
        `,
      )
      .get(taskId) as ScheduledTaskRow | null;

    return row ? rowToScheduledTask(row) : null;
  }

  createScheduledTask(input: ScheduledTaskCreate): ScheduledTaskSummary {
    const now = new Date().toISOString();
    const workspacePath = normalizeWorkspacePath(input.workspacePath ?? this.#workspacePath);

    this.#db
      .query(
        `
          INSERT INTO scheduled_tasks (
            id, name, prompt, cron_expression, timezone, working_directory,
            workspace_path, provider_id, model_id, temperature, top_p, top_k,
            context_size, allow_overlap, enabled, created_by, created_by_session_id,
            created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.id,
        input.name,
        input.prompt,
        input.cronExpression,
        input.timezone ?? null,
        input.workingDirectory ?? null,
        workspacePath,
        input.providerId,
        input.modelId,
        input.parameters.temperature,
        input.parameters.topP,
        input.parameters.topK,
        input.parameters.contextSize,
        input.allowOverlap ? 1 : 0,
        input.enabled === false ? 0 : 1,
        input.createdBy,
        input.createdBySessionId ?? null,
        now,
        now,
      );

    const created = this.getScheduledTask(input.id);

    if (!created) {
      throw new Error("Could not read created scheduled task");
    }

    return created;
  }

  updateScheduledTask(taskId: string, update: ScheduledTaskUpdate): ScheduledTaskSummary | null {
    const existing = this.getScheduledTask(taskId);

    if (!existing) {
      return null;
    }

    const now = new Date().toISOString();
    const parameters: LlmGenerationParameters = {
      contextSize: update.parameters?.contextSize ?? existing.parameters.contextSize,
      temperature: update.parameters?.temperature ?? existing.parameters.temperature,
      topK: update.parameters?.topK ?? existing.parameters.topK,
      topP: update.parameters?.topP ?? existing.parameters.topP,
    };

    const scope = this.#scopeWhere();
    const where = scope ? "id = ? AND " + scope.sql : "id = ?";
    const params = scope ? [taskId, ...scope.params] : [taskId];

    this.#db
      .query(
        `
          UPDATE scheduled_tasks
          SET name = ?,
              prompt = ?,
              cron_expression = ?,
              timezone = ?,
              working_directory = ?,
              provider_id = ?,
              model_id = ?,
              temperature = ?,
              top_p = ?,
              top_k = ?,
              context_size = ?,
              allow_overlap = ?,
              enabled = ?,
              updated_at = ?
          WHERE ${where}
        `,
      )
      .run(
        update.name ?? existing.name,
        update.prompt ?? existing.prompt,
        update.cronExpression ?? existing.cronExpression,
        update.timezone !== undefined ? update.timezone : existing.timezone,
        update.workingDirectory !== undefined ? update.workingDirectory : existing.workingDirectory,
        update.providerId ?? existing.providerId,
        update.modelId ?? existing.modelId,
        parameters.temperature,
        parameters.topP,
        parameters.topK,
        parameters.contextSize,
        (update.allowOverlap ?? existing.allowOverlap) ? 1 : 0,
        (update.enabled ?? existing.enabled) ? 1 : 0,
        now,
        ...params,
      );

    return this.getScheduledTask(taskId);
  }

  setRootSessionId(taskId: string, rootSessionId: string): void {
    this.#db
      .query("UPDATE scheduled_tasks SET root_session_id = ?, updated_at = ? WHERE id = ?")
      .run(rootSessionId, new Date().toISOString(), taskId);
  }

  markLastRunAt(taskId: string, lastRunAt: string): void {
    this.#db
      .query("UPDATE scheduled_tasks SET last_run_at = ?, updated_at = ? WHERE id = ?")
      .run(lastRunAt, new Date().toISOString(), taskId);
  }

  deleteScheduledTask(taskId: string): boolean {
    const scope = this.#scopeWhere();
    const where = scope ? "id = ? AND " + scope.sql : "id = ?";
    const params = scope ? [taskId, ...scope.params] : [taskId];
    const result = this.#db.query(`DELETE FROM scheduled_tasks WHERE ${where}`).run(...params);

    return result.changes > 0;
  }

  listScheduledTaskSessions(limit = 10): ScheduledTaskSessionSummary[] {
    const scope = this.#scopeWhere();
    const where: string[] = ["t.root_session_id IS NOT NULL"];
    const params: Array<number | string> = [];

    if (scope) {
      where.push("s.workspace_path = ?");
      params.push(...scope.params);
    }

    const rows = this.#db
      .query(
        `
          SELECT s.id, s.type, s.parent_session_id, s.title, s.provider_id, s.model_id,
                 s.temperature, s.top_p, s.top_k, s.context_size, s.workspace_path,
                 s.created_at, s.updated_at,
                 t.id AS task_id, t.name AS task_name,
                 COALESCE(r.started_at, s.created_at) AS run_started_at
          FROM scheduled_tasks t
          JOIN agent_sessions s ON s.id = (
            SELECT child.id
            FROM agent_sessions child
            WHERE child.parent_session_id = t.root_session_id
            ORDER BY child.updated_at DESC, child.created_at DESC
            LIMIT 1
          )
          LEFT JOIN scheduled_task_runs r ON r.session_id = s.id
          ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY s.updated_at DESC
          LIMIT ?
        `,
      )
      .all(...params, Math.max(1, Math.floor(limit))) as ScheduledTaskSessionRow[];

    return rows.map(rowToScheduledTaskSession);
  }

  #scopeWhere(): { params: string[]; sql: string } | null {
    return this.#workspacePath
      ? { sql: "workspace_path = ?", params: [this.#workspacePath] }
      : null;
  }
}

/**
 * Tracks individual firings of a scheduled task. Overlap prevention relies on
 * the partial unique index on (task_id) WHERE status='running': startRun()
 * attempts an INSERT and treats a constraint failure as "already running".
 */
export class ScheduledTaskRunsRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  listRuns(taskId: string, limit = 50): ScheduledTaskRunSummary[] {
    const rows = this.#db
      .query(
        `
          SELECT id, task_id, session_id, status, trigger, allow_overlap, summary, error, started_at, completed_at
          FROM scheduled_task_runs
          WHERE task_id = ?
          ORDER BY started_at DESC
          LIMIT ?
        `,
      )
      .all(taskId, Math.max(1, Math.floor(limit))) as ScheduledTaskRunRow[];

    return rows.map(rowToRun);
  }

  getRun(runId: string): ScheduledTaskRunSummary | null {
    const row = this.#db
      .query(
        `
          SELECT id, task_id, session_id, status, trigger, allow_overlap, summary, error, started_at, completed_at
          FROM scheduled_task_runs
          WHERE id = ?
        `,
      )
      .get(runId) as ScheduledTaskRunRow | null;

    return row ? rowToRun(row) : null;
  }

  isRunning(taskId: string): boolean {
    const row = this.#db
      .query("SELECT id FROM scheduled_task_runs WHERE task_id = ? AND status = 'running'")
      .get(taskId);

    return row !== null;
  }

  /**
   * Attempts to claim a run slot for the task. Returns null if a run is
   * already in progress (unique index violation), which is the primary
   * cross-process overlap guard. Tasks with allowOverlap=true are exempt
   * from the uniqueness guard entirely (see the partial index definition).
   */
  startRun(input: {
    id: string;
    taskId: string;
    trigger: ScheduledTaskRunTrigger;
    allowOverlap: boolean;
  }): ScheduledTaskRunSummary | null {
    const now = new Date().toISOString();

    try {
      this.#db
        .query(
          `
            INSERT INTO scheduled_task_runs (id, task_id, session_id, status, trigger, allow_overlap, started_at)
            VALUES (?, ?, NULL, 'running', ?, ?, ?)
          `,
        )
        .run(input.id, input.taskId, input.trigger, input.allowOverlap ? 1 : 0, now);
    } catch {
      return null;
    }

    return this.getRun(input.id);
  }

  attachSession(runId: string, sessionId: string): void {
    this.#db.query("UPDATE scheduled_task_runs SET session_id = ? WHERE id = ?").run(sessionId, runId);
  }

  completeRun(runId: string, result: { summary?: string | null; status: "done" | "error" | "skipped"; error?: string | null }): ScheduledTaskRunSummary | null {
    this.#db
      .query(
        `
          UPDATE scheduled_task_runs
          SET status = ?, summary = ?, error = ?, completed_at = ?
          WHERE id = ?
        `,
      )
      .run(result.status, result.summary ?? null, result.error ?? null, new Date().toISOString(), runId);

    return this.getRun(runId);
  }
}

/**
 * Permanent grants allowing a workspace-scoped LLM to view global scheduled
 * tasks and their run outputs. Unlike filesystem directory grants, these do
 * not expire once approved.
 */
export class ScheduledTaskAccessGrantsRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  hasGlobalAccess(workspacePath: string | null): boolean {
    const normalized = normalizeWorkspacePath(workspacePath);

    if (!normalized) {
      return true;
    }

    const row = this.#db
      .query("SELECT workspace_path FROM scheduled_task_global_access_grants WHERE workspace_path = ?")
      .get(normalized);

    return row !== null;
  }

  grantGlobalAccess(workspacePath: string): void {
    this.#db
      .query(
        `
          INSERT INTO scheduled_task_global_access_grants (workspace_path, granted_at)
          VALUES (?, ?)
          ON CONFLICT(workspace_path) DO NOTHING
        `,
      )
      .run(workspacePath, new Date().toISOString());
  }

  revokeGlobalAccess(workspacePath: string): boolean {
    const result = this.#db
      .query("DELETE FROM scheduled_task_global_access_grants WHERE workspace_path = ?")
      .run(workspacePath);

    return result.changes > 0;
  }
}

function rowToScheduledTask(row: ScheduledTaskRow): ScheduledTaskSummary {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    workingDirectory: row.working_directory,
    workspacePath: row.workspace_path,
    providerId: row.provider_id,
    modelId: row.model_id,
    parameters: {
      temperature: row.temperature,
      topP: row.top_p,
      topK: row.top_k,
      contextSize: row.context_size,
    },
    allowOverlap: row.allow_overlap === 1,
    enabled: row.enabled === 1,
    createdBy: row.created_by,
    createdBySessionId: row.created_by_session_id,
    rootSessionId: row.root_session_id,
    lastRunAt: row.last_run_at,
    nextRunAt: null,
    running: false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToScheduledTaskSession(row: ScheduledTaskSessionRow): ScheduledTaskSessionSummary {
  return {
    id: row.id,
    type: row.type,
    parentSessionId: row.parent_session_id,
    title: row.title,
    providerId: row.provider_id,
    modelId: row.model_id,
    messageCount: 0,
    wordCount: 0,
    parameters: {
      temperature: row.temperature,
      topP: row.top_p,
      topK: row.top_k,
      contextSize: row.context_size,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    workspacePath: row.workspace_path,
    taskId: row.task_id,
    taskName: row.task_name,
    runStartedAt: row.run_started_at,
  };
}

function rowToRun(row: ScheduledTaskRunRow): ScheduledTaskRunSummary {
  return {
    id: row.id,
    taskId: row.task_id,
    sessionId: row.session_id,
    status: row.status,
    trigger: row.trigger,
    summary: row.summary,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function normalizeWorkspacePath(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}
