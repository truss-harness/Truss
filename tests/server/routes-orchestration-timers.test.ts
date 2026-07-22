import { describe, expect, it } from "bun:test";
import type { ServerContext } from "../../src/server/http/context.ts";
import { handleOrchestrationTimerRoute } from "../../src/server/http/routes-orchestration-timers.ts";

describe("handleOrchestrationTimerRoute", () => {
  it("lists timers from structured MCP tool results", async () => {
    let call: unknown;
    const context = {
      mcp: {
        callToolStructuredByServerName: async (request: unknown) => {
          call = request;

          return {
            timers: [
              {
                firesAt: "2026-06-26T10:00:00.000Z",
                label: "Check",
                lengthSeconds: 60,
                message: "Timer fired.",
                timerId: "timer_one",
              },
            ],
          };
        },
      },
    } as unknown as ServerContext;

    const response = await handleOrchestrationTimerRoute(
      new Request("http://127.0.0.1/api/orchestration/timers?sessionId=session_one"),
      context,
      null,
      null,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      timers: [
        {
          firesAt: "2026-06-26T10:00:00.000Z",
          label: "Check",
          lengthSeconds: 60,
          message: "Timer fired.",
          timerId: "timer_one",
        },
      ],
    });
    expect(call).toEqual({
      args: {},
      meta: { sessionId: "session_one" },
      serverName: "Truss Orchestration Tools",
      toolName: "timer_list",
    });
  });
});
