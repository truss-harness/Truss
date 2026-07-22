import { describe, expect, it } from "bun:test";
import type { ServerContext } from "../../src/server/http/context.ts";
import { handleScheduledTasksRoute } from "../../src/server/http/routes-scheduled-tasks.ts";
import { handleAgentSessionsRoute } from "../../src/server/http/routes-agent-sessions.ts";

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
