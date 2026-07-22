import { describe, expect, it } from "bun:test";
import type { ChatToolCall } from "../../src/shared/protocol.ts";
import { shouldStopAfterContinuousToolFailures } from "../../src/server/http/routes-chat.ts";

describe("shouldStopAfterContinuousToolFailures", () => {
  it("stops after fifty consecutive tool failures", () => {
    const failures = toolCalls("tool", "error", 50);

    expect(shouldStopAfterContinuousToolFailures(failures, 50)).toBe(true);
  });

  it("continues before the consecutive failure limit", () => {
    const failures = toolCalls("tool", "error", 49);

    expect(shouldStopAfterContinuousToolFailures(failures, 50)).toBe(false);
  });

  it("resets the failure count after a completed tool call", () => {
    const earlyFailures = toolCalls("early", "error", 49);
    const completed = toolCall("tool-1", "completed");
    const latestFailures = toolCalls("latest", "error", 49);

    expect(
      shouldStopAfterContinuousToolFailures(
        [...earlyFailures, completed, ...latestFailures],
        50,
      ),
    ).toBe(false);
  });
});

function toolCalls(
  idPrefix: string,
  status: ChatToolCall["status"],
  count: number,
): ChatToolCall[] {
  return Array.from({ length: count }, (_, index) => toolCall(`${idPrefix}-${index + 1}`, status));
}

function toolCall(id: string, status: ChatToolCall["status"]): ChatToolCall {
  const base: ChatToolCall = {
    args: {},
    id,
    startedAt: "2026-06-23T00:00:00.000Z",
    status,
    title: `Tool ${id}`,
    toolId: "demo_tool",
  };

  if (status === "running") {
    return base;
  }

  return {
    ...base,
    completedAt: "2026-06-23T00:00:01.000Z",
    ...(status === "completed" ? { result: "result" } : { error: "MCP request timed out." }),
  };
}
