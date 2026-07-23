import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import type { ServerContext } from "../../src/server/http/context.ts";
import { handleScheduledTasksRoute } from "../../src/server/http/routes-scheduled-tasks.ts";
import { handleAgentSessionsRoute } from "../../src/server/http/routes-agent-sessions.ts";
import { ScheduledTasksRepository } from "../../src/server/storage/scheduled-tasks.ts";

describe("scheduled task sessions", () => {
  it("lists the latest scheduled task run session via /api/scheduled-tasks/sessions", async () => {
    const sessions = [
      {
        id: "session_one",
        type: "sub-agent",
        parentSessionId: "task_root",
        title: "Task run",
        providerId: "openai",
        modelId: "gpt-4",
        messageCount: 0,
        wordCount: 0,
        parameters: {},
        createdAt: "2026-07-15T10:00:00.000Z",
        updatedAt: "2026-07-15T13:00:00.000Z",
        workspacePath: null,
        taskId: "task_one",
        taskName: "Daily summary",
        runStartedAt: "2026-07-15T13:00:00.000Z",
      },
    ];

    const context = {
      scheduledTasks: {
        listScheduledTaskSessions: () => sessions,
      },
    } as unknown as ServerContext;

    const response = await handleScheduledTasksRoute(
      new Request("http://127.0.0.1/api/scheduled-tasks/sessions?limit=10"),
      context,
      null,
      "sessions",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sessions });
  });

  it("lists workspace-scoped task sessions without an ambiguous workspace path", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE scheduled_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_session_id TEXT,
        workspace_path TEXT
      );
      CREATE TABLE agent_sessions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        parent_session_id TEXT,
        title TEXT,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        temperature REAL,
        top_p REAL,
        top_k INTEGER,
        context_size INTEGER,
        workspace_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE scheduled_task_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        started_at TEXT NOT NULL
      );
    `);

    db.query(`
      INSERT INTO agent_sessions (
        id, type, parent_session_id, title, provider_id, model_id, workspace_path, created_at, updated_at
      ) VALUES
        ('root_workspace_a', 'agentic', NULL, 'Root', 'openai', 'gpt-4', '/workspace-a', '2026-07-15T10:00:00.000Z', '2026-07-15T10:00:00.000Z'),
        ('child_workspace_a', 'sub-agent', 'root_workspace_a', 'Task run', 'openai', 'gpt-4', '/workspace-a', '2026-07-15T11:00:00.000Z', '2026-07-15T11:00:00.000Z'),
        ('root_workspace_b', 'agentic', NULL, 'Root', 'openai', 'gpt-4', '/workspace-b', '2026-07-15T10:00:00.000Z', '2026-07-15T10:00:00.000Z'),
        ('child_workspace_b', 'sub-agent', 'root_workspace_b', 'Task run', 'openai', 'gpt-4', '/workspace-b', '2026-07-15T12:00:00.000Z', '2026-07-15T12:00:00.000Z');
    `).run();
    db.query(`
      INSERT INTO scheduled_tasks (id, name, root_session_id, workspace_path) VALUES
        ('task_workspace_a', 'Workspace A task', 'root_workspace_a', '/workspace-a'),
        ('task_workspace_b', 'Workspace B task', 'root_workspace_b', '/workspace-b');
    `).run();

    const sessions = new ScheduledTasksRepository(db, { workspacePath: "/workspace-a" })
      .listScheduledTaskSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: "child_workspace_a",
      taskId: "task_workspace_a",
      workspacePath: "/workspace-a",
    });
  });

  it("copies an automatic task into an independent conversation", async () => {
    const source = {
      id: "session_automatic",
      type: "sub-agent" as const,
      parentSessionId: "session_root",
      title: "Daily summary",
      providerId: "openai",
      modelId: "gpt-4",
      messageCount: 0,
      wordCount: 0,
      parameters: {},
      createdAt: "2026-07-15T10:00:00.000Z",
      updatedAt: "2026-07-15T13:00:00.000Z",
      workspacePath: null,
    };
    let createInput: unknown;
    const copied = { from: "", to: "" };
    const context = {
      agentSessions: {
        createAgentSession: (input: unknown) => {
          createInput = input;
          return {
            ...source,
            ...(input as { id: string; parentSessionId: null; type: "conversation" }),
          };
        },
        getAgentSession: (sessionId: string) =>
          sessionId === source.id ? source : { ...source, id: sessionId, parentSessionId: null, type: "conversation" },
      },
      chatMessages: {
        copySessionMessages: (from: string, to: string) => {
          copied.from = from;
          copied.to = to;
        },
        listSessionStats: () => new Map(),
      },
    } as unknown as ServerContext;

    const response = await handleAgentSessionsRoute(
      new Request("http://127.0.0.1/api/agent-sessions/session_automatic/duplicate", {
        method: "POST",
      }),
      context,
      "session_automatic",
      "duplicate",
    );

    expect(response.status).toBe(201);
    expect(createInput).toMatchObject({ parentSessionId: null, type: "conversation" });
    expect(copied.from).toBe(source.id);
    expect(copied.to).toBeTruthy();
  });

  it("excludes scheduled task root sessions from /api/agent-sessions when requested", async () => {
    const sessions = [
      {
        id: "session_user",
        type: "conversation",
        parentSessionId: null,
        title: "User chat",
        providerId: "openai",
        modelId: "gpt-4",
        messageCount: 0,
        wordCount: 0,
        parameters: {},
        createdAt: "2026-07-15T10:00:00.000Z",
        updatedAt: "2026-07-15T13:00:00.000Z",
        workspacePath: null,
      },
    ];

    let receivedOptions: unknown;

    const context = {
      options: {},
      agentSessions: {
        listAgentSessions: (options: unknown) => {
          receivedOptions = options;
          return sessions;
        },
      },
      chatMessages: {
        listSessionStats: () => new Map(),
      },
    } as unknown as ServerContext;

    const response = await handleAgentSessionsRoute(
      new Request(
        "http://127.0.0.1/api/agent-sessions?excludeScheduledTaskSessions=true&includeSubAgents=false",
      ),
      context,
      null,
      null,
    );

    expect(response.status).toBe(200);
    expect(receivedOptions).toEqual({
      excludeScheduledTaskSessions: true,
      includeSubAgents: false,
      includeWorkspaceSessions: true,
      limit: undefined,
      search: null,
    });
    await expect(response.json()).resolves.toEqual({
      sessions: sessions.map((session) => ({ ...session, originContext: "global" })),
    });
  });
});
