import { describe, expect, it } from "bun:test";
import { planFromMessages, planFromToolCall } from "../../src/client/components/chat/plan-tool-state.ts";
import type { ChatToolCall } from "../../src/shared/protocol.ts";
import type { ChatUiMessage } from "../../src/client/components/chat/types.ts";

describe("plan tool state", () => {
  it("creates an activity plan from TOON plan tool results", () => {
    const plan = planFromToolCall(
      toolCall({
        result: [
          "plan_update_subtask:",
          "  todos[1]:",
          "    - id: filesystem",
          "      status: in_progress",
          "      subtasks[2]:",
          "        - id: grants",
          "          notes: Keep expiry visible",
          "          status: done",
          "          title: Expose grants",
          "        - id: search",
          "          status: pending",
          "          title: Search files",
          "      title: Filesystem tools",
          "",
        ].join("\n"),
        toolId: "mcp__Truss_Orchestration_Tools__plan_update_subtask",
      }),
    );

    expect(plan).toEqual({
      todos: [
        {
          id: "filesystem",
          status: "in_progress",
          subtasks: [
            {
              id: "grants",
              notes: "Keep expiry visible",
              status: "done",
              title: "Expose grants",
            },
            {
              id: "search",
              status: "pending",
              title: "Search files",
            },
          ],
          title: "Filesystem tools",
        },
      ],
    });
  });

  it("uses the latest completed plan tool call across messages", () => {
    const messages: ChatUiMessage[] = [
      messageWithToolCall(
        toolCall({
          result: JSON.stringify({
            todos: [{ id: "old", status: "pending", subtasks: [], title: "Old todo" }],
          }),
          toolId: "plan_set_todos",
        }),
      ),
      messageWithToolCall(
        toolCall({
          result: JSON.stringify({
            todos: [{ id: "new", status: "done", subtasks: [], title: "New todo" }],
          }),
          toolId: "plan_update_todo",
        }),
      ),
    ];

    expect(planFromMessages(messages)?.todos.map((todo) => todo.id)).toEqual(["new"]);
  });
});

function messageWithToolCall(toolCall: ChatToolCall): ChatUiMessage {
  return {
    content: "",
    createdAt: "2026-06-27T10:00:00.000Z",
    id: `msg_${toolCall.id}`,
    role: "assistant",
    thinking: {
      content: "",
      durationMs: 0,
      toolCalls: [toolCall],
      wordCount: 0,
    },
  };
}

function toolCall({
  result,
  toolId,
}: {
  result: string;
  toolId: string;
}): ChatToolCall {
  return {
    args: {},
    completedAt: "2026-06-27T10:00:01.000Z",
    id: `call_${toolId}`,
    result,
    startedAt: "2026-06-27T10:00:00.000Z",
    status: "completed",
    title: `Truss Orchestration Tools: ${toolId}`,
    toolId,
  };
}
