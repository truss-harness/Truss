import { describe, expect, it } from "bun:test";
import {
  activeTimerFromToolCall,
  removedTimerIdFromToolCall,
  upsertActiveTimer,
} from "../../src/client/components/chat/timer-tool-state.ts";
import type { ChatToolCall } from "../../src/shared/protocol.ts";

describe("timer tool state", () => {
  it("creates active timers from TOON timer_set tool results", () => {
    const timer = activeTimerFromToolCall(
      toolCall({
        args: { delaySeconds: 90 },
        result: [
          "timer_set:",
          "  firesAt: 2026-06-26T10:00:00.000Z",
          "  label: Check build",
          "  lengthSeconds: 90",
          "  message: [Truss system event]: Timer set for 1 minute 30 seconds are up.",
          "  startedAt: 2026-06-26T09:58:30.000Z",
          "  timerId: timer_one",
          "",
        ].join("\n"),
        toolId: "mcp__Truss_Orchestration_Tools__timer_set",
      }),
      "session_one",
    );

    expect(timer).toEqual({
      firesAt: "2026-06-26T10:00:00.000Z",
      label: "Check build",
      lengthSeconds: 90,
      message: "[Truss system event]: Timer set for 1 minute 30 seconds are up.",
      sessionId: "session_one",
      startedAt: "2026-06-26T09:58:30.000Z",
      timerId: "timer_one",
    });
  });

  it("creates active timers from nested TOON timer_extend tool results", () => {
    const timer = activeTimerFromToolCall(
      toolCall({
        args: { delaySeconds: 120, timerId: "timer_one" },
        result: [
          "timer_extend:",
          "  timer:",
          "    firesAt: 2026-06-26T10:02:00.000Z",
          "    lengthSeconds: 120",
          "    message: [Truss system event]: Timer set for 2 minutes are up.",
          "    startedAt: 2026-06-26T10:00:00.000Z",
          "    timerId: timer_one",
          "",
        ].join("\n"),
        toolId: "timer_extend",
      }),
      "session_one",
    );

    expect(timer).toMatchObject({
      firesAt: "2026-06-26T10:02:00.000Z",
      lengthSeconds: 120,
      sessionId: "session_one",
      startedAt: "2026-06-26T10:00:00.000Z",
      timerId: "timer_one",
    });
  });

  it("removes timers from TOON cancel, fire, and missing extend results", () => {
    expect(
      removedTimerIdFromToolCall(
        toolCall({
          args: { timerId: "timer_cancelled" },
          result: "timer_cancel:\n  cancelled: true\n",
          toolId: "timer_cancel",
        }),
      ),
    ).toBe("timer_cancelled");

    expect(
      removedTimerIdFromToolCall(
        toolCall({
          args: { timerId: "timer_fired" },
          result: "timer_fire:\n  fired: true\n",
          toolId: "timer_fire",
        }),
      ),
    ).toBe("timer_fired");

    expect(
      removedTimerIdFromToolCall(
        toolCall({
          args: { delaySeconds: 60, timerId: "timer_missing" },
          result: "timer_extend:\n  timer: null\n",
          toolId: "timer_extend",
        }),
      ),
    ).toBe("timer_missing");
  });

  it("upserts active timers in fire-time order", () => {
    expect(
      upsertActiveTimer(
        [
          {
            firesAt: "2026-06-26T10:05:00.000Z",
            lengthSeconds: 300,
            message: "Later",
            sessionId: "session_one",
            timerId: "later",
          },
        ],
        {
          firesAt: "2026-06-26T10:01:00.000Z",
          lengthSeconds: 60,
          message: "Sooner",
          sessionId: "session_one",
          timerId: "sooner",
        },
      ).map((timer) => timer.timerId),
    ).toEqual(["sooner", "later"]);
  });
});

function toolCall({
  args,
  result,
  toolId,
}: {
  args: Record<string, unknown>;
  result: string;
  toolId: string;
}): ChatToolCall {
  return {
    args,
    completedAt: "2026-06-26T09:00:01.000Z",
    id: "tool_one",
    result,
    startedAt: "2026-06-26T09:00:00.000Z",
    status: "completed",
    title: `Truss Orchestration Tools: ${toolId}`,
    toolId,
  };
}
