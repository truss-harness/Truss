import { describe, expect, it } from "bun:test";
import {
  executeTrussOrchestrationToolValue,
} from "../../src/server/mcp/servers/truss-orchestration-tools/server.ts";
import {
  createTrussOrchestrationToolsRuntime,
} from "../../src/server/mcp/servers/truss-orchestration-tools/runtime.ts";
import { formatToonToolResult } from "../../src/server/mcp/toon.ts";

describe("Truss Orchestration Tools MCP server", () => {
  it("maintains an in-memory todo and subtask plan", () => {
    const runtime = createTrussOrchestrationToolsRuntime();
    const meta = { sessionId: "session_one" };

    executeTrussOrchestrationToolValue({
      args: {
        todos: [
          {
            id: "filesystem",
            status: "pending",
            title: "Filesystem tools",
          },
        ],
      },
      meta,
      runtime,
      toolName: "plan_set_todos",
    });
    executeTrussOrchestrationToolValue({
      args: {
        subtasks: [
          {
            id: "grants",
            status: "in_progress",
            title: "Expose grants",
          },
        ],
        todoId: "filesystem",
      },
      meta,
      runtime,
      toolName: "plan_set_subtasks",
    });
    const plan = executeTrussOrchestrationToolValue({
      args: {
        id: "grants",
        status: "done",
        todoId: "filesystem",
      },
      meta,
      runtime,
      toolName: "plan_update_subtask",
    });

    expect(plan).toEqual({
      todos: [
        {
          description: undefined,
          id: "filesystem",
          status: "pending",
          subtasks: [
            {
              id: "grants",
              notes: undefined,
              status: "done",
              title: "Expose grants",
            },
          ],
          title: "Filesystem tools",
        },
      ],
    });
  });

  it("keeps todo plans scoped by Truss session metadata", () => {
    const runtime = createTrussOrchestrationToolsRuntime();

    executeTrussOrchestrationToolValue({
      args: {
        todos: [{ id: "one", status: "pending", title: "Session one todo" }],
      },
      meta: { sessionId: "session_one" },
      runtime,
      toolName: "plan_set_todos",
    });
    executeTrussOrchestrationToolValue({
      args: {
        todos: [{ id: "two", status: "pending", title: "Session two todo" }],
      },
      meta: { sessionId: "session_two" },
      runtime,
      toolName: "plan_set_todos",
    });

    expect(
      executeTrussOrchestrationToolValue({
        args: {},
        meta: { sessionId: "session_one" },
        runtime,
        toolName: "plan_get",
      }),
    ).toEqual({
      todos: [{ id: "one", status: "pending", subtasks: [], title: "Session one todo" }],
    });
    expect(
      executeTrussOrchestrationToolValue({
        args: {},
        meta: { sessionId: "session_two" },
        runtime,
        toolName: "plan_get",
      }),
    ).toEqual({
      todos: [{ id: "two", status: "pending", subtasks: [], title: "Session two todo" }],
    });
    expect(() =>
      executeTrussOrchestrationToolValue({
        args: {},
        runtime,
        toolName: "plan_get",
      }),
    ).toThrow("This tool requires Truss session metadata.");
  });

  it("formats orchestration results as TOON", () => {
    expect(
      formatToonToolResult("plan_get", {
        todos: [
          {
            id: "filesystem",
            status: "pending",
            subtasks: [],
            title: "Filesystem tools",
          },
        ],
      }),
    ).toBe(
      [
        "plan_get:",
        "  todos[1]:",
        "    - id: filesystem",
        "      status: pending",
        "      subtasks[0]: []",
        "      title: Filesystem tools",
        "",
      ].join("\n"),
    );
  });

  it("advertises spawn_sub_agent as a host-handled orchestration tool", () => {
    const runtime = createTrussOrchestrationToolsRuntime();

    expect(() =>
      executeTrussOrchestrationToolValue({
        args: {
          mcpServers: ["truss-web-tools"],
          task: "Find a short lorem ipsum source.",
          tools: ["web_search"],
        },
        runtime,
        toolName: "spawn_sub_agent",
      }),
    ).toThrow("spawn_sub_agent is handled by the Truss chat host");
  });

  it("limits timers to five per session", () => {
    const runtime = createTrussOrchestrationToolsRuntime();
    const meta = { sessionId: "session_one" };

    try {
      for (let index = 0; index < 5; index += 1) {
        executeTrussOrchestrationToolValue({
          args: {
            delaySeconds: 60,
            message: `Timer ${index + 1}`,
          },
          meta,
          runtime,
          toolName: "timer_set",
        });
      }

      expect(() =>
        executeTrussOrchestrationToolValue({
          args: {
            delaySeconds: 60,
            message: "Timer 6",
          },
          meta,
          runtime,
          toolName: "timer_set",
        }),
      ).toThrow("This session already has 5 pending timers.");
    } finally {
      runtime.close();
    }
  });

  it("limits timer reminder labels to 100 characters", () => {
    const runtime = createTrussOrchestrationToolsRuntime();

    try {
      const label = "x".repeat(100);
      const created = executeTrussOrchestrationToolValue({
        args: {
          delaySeconds: 60,
          label,
        },
        meta: { sessionId: "session_one" },
        runtime,
        toolName: "timer_set",
      });

      expect(created).toEqual(expect.objectContaining({ label }));
      expect(() =>
        executeTrussOrchestrationToolValue({
          args: {
            delaySeconds: 60,
            label: "x".repeat(101),
          },
          meta: { sessionId: "session_two" },
          runtime,
          toolName: "timer_set",
        }),
      ).toThrow("label is too long.");
    } finally {
      runtime.close();
    }
  });

  it("extends timers by adding to the current trigger time", () => {
    const runtime = createTrussOrchestrationToolsRuntime();
    const meta = { sessionId: "session_one" };

    try {
      const created = executeTrussOrchestrationToolValue({
        args: {
          delaySeconds: 30,
          label: "extend me",
        },
        meta,
        runtime,
        toolName: "timer_set",
      }) as { firesAt: string; lengthSeconds: number; startedAt: string; timerId: string };
      const extended = executeTrussOrchestrationToolValue({
        args: {
          delaySeconds: 30,
          timerId: created.timerId,
        },
        meta,
        runtime,
        toolName: "timer_extend",
      }) as {
        timer: { firesAt: string; lengthSeconds: number; startedAt: string; timerId: string };
      };

      expect(Date.parse(extended.timer.firesAt)).toBe(Date.parse(created.firesAt) + 30_000);
      expect(extended.timer.lengthSeconds).toBe(30);
      expect(extended.timer.startedAt).toBe(created.startedAt);
      expect(extended.timer.timerId).toBe(created.timerId);
    } finally {
      runtime.close();
    }
  });

  it("uses Truss system event text for fired timers", () => {
    const firedEvents: unknown[] = [];
    const runtime = createTrussOrchestrationToolsRuntime({
      onTimerFired: (event) => {
        firedEvents.push(event);
      },
    });
    const meta = { sessionId: "session_one" };

    try {
      const created = executeTrussOrchestrationToolValue({
        args: {
          delaySeconds: 120,
          label: "2-minute timer",
          message: "ignored model-provided text",
        },
        meta,
        runtime,
        toolName: "timer_set",
      }) as { lengthSeconds: number; message: string; timerId: string };

      expect(created.lengthSeconds).toBe(120);
      expect(created.message).toBe(
        "[Truss system event]: Timer set for 2 minutes are up.",
      );

      const fired = executeTrussOrchestrationToolValue({
        args: {
          timerId: created.timerId,
        },
        meta,
        runtime,
        toolName: "timer_fire",
      });

      expect(fired).toEqual({ fired: true });
      expect(firedEvents).toEqual([
        expect.objectContaining({
          label: "2-minute timer",
          lengthSeconds: 120,
          message: "[Truss system event]: Timer set for 2 minutes are up.",
          sessionId: "session_one",
          timerId: created.timerId,
        }),
      ]);
    } finally {
      runtime.close();
    }
  });
});
