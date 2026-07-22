import { describe, expect, it } from "bun:test";
import type { AgentSessionDetailResponse } from "../../src/shared/protocol.ts";
import type { ChatUiMessage } from "../../src/client/components/chat/types.ts";
import {
  assistantFailureContent,
  formatConversationAtif,
  formatConversationJson,
} from "../../src/client/components/chat/chat-utils.ts";

describe("conversation exports", () => {
  it("includes failed tool calls and error observations in JSON exports", () => {
    const exported = JSON.parse(formatConversationJson(conversationWithFailedToolCall())) as {
      messages: Array<Record<string, unknown>>;
    };

    const assistantToolCallMessage = exported.messages[2] as {
      tool_calls?: Array<{
        function: { arguments: string; name: string };
        id: string;
      }>;
    };
    const toolObservation = exported.messages[3] as {
      content: string;
      role: string;
      tool_call_id: string;
    };
    const finalAssistantMessage = exported.messages[4] as {
      content: string;
      role: string;
    };

    expect(assistantToolCallMessage.tool_calls?.[0]?.id).toBe("tool_failed");
    expect(assistantToolCallMessage.tool_calls?.[0]?.function.name).toBe("web_search");
    expect(JSON.parse(assistantToolCallMessage.tool_calls?.[0]?.function.arguments ?? "{}")).toEqual({
      query: "site:telex.hu/english 2026",
    });
    expect(toolObservation).toMatchObject({
      role: "tool",
      tool_call_id: "tool_failed",
    });
    expect(toolObservation.content).toContain("tool_error:");
    expect(toolObservation.content).toContain("Web search request failed");
    expect(finalAssistantMessage).toMatchObject({
      role: "assistant",
      content: "I couldn't complete the requested tool use.",
    });
  });

  it("includes failed tool calls and error observations in ATIF exports", () => {
    const exported = JSON.parse(formatConversationAtif(conversationWithFailedToolCall())) as AtifExport;
    const assistantStep = exported.steps[2];

    if (!assistantStep) {
      throw new Error("Expected assistant step in ATIF export.");
    }

    expect(assistantStep.tool_calls?.[0]).toMatchObject({
      tool_call_id: "tool_failed",
      function_name: "web_search",
      extra: {
        status: "error",
        truss_tool_turn: 1,
      },
    });
    expect(assistantStep.observation?.results?.[0]).toMatchObject({
      source_call_id: "tool_failed",
      extra: {
        error: "Web search request failed.",
        status: "error",
        truss_tool_turn: 1,
      },
    });
  });
});

describe("assistantFailureContent", () => {
  it("identifies stream failures after successful tool calls as final response failures", () => {
    const content = assistantFailureContent(
      assistantMessageWithToolCall("completed"),
      new Error("Error in input stream"),
    );

    expect(content).toContain(
      "The tool calls completed, but I couldn't finish the final model response.",
    );
    expect(content).toContain("Error: Error in input stream");
    expect(content).toContain("completed tool results");
    expect(content).not.toContain("one or more tool calls failed");
  });

  it("keeps failed tool calls grouped as tool-use failures", () => {
    const content = assistantFailureContent(
      assistantMessageWithToolCall("error"),
      new Error("Network stream failed."),
    );

    expect(content).toContain("one or more tool calls failed");
    expect(content).toContain("- Web search: Web search request failed");
  });

  it("preserves partial assistant content when a stream fails mid-answer", () => {
    const content = assistantFailureContent(
      {
        ...assistantMessageWithToolCall("completed"),
        content: "Partial answer",
      },
      new Error("Error in input stream"),
    );

    expect(content).toBe("Partial answer");
  });
});

interface AtifExport {
  steps: AtifStep[];
}

interface AtifStep extends Record<string, unknown> {
  observation?: {
    results?: Array<Record<string, unknown>>;
  };
  tool_calls?: Array<Record<string, unknown>>;
}

function conversationWithFailedToolCall(): AgentSessionDetailResponse {
  return {
    messages: [
      {
        content: "What is the news on telex.hu?",
        createdAt: "2026-06-23T07:11:31.000Z",
        id: "msg_user",
        role: "user",
      },
      {
        content: "I couldn't complete the requested tool use.",
        createdAt: "2026-06-23T07:11:33.000Z",
        id: "msg_assistant",
        role: "assistant",
        thinking: {
          content: "",
          durationMs: 1_400,
          toolCalls: [
            {
              args: {
                query: "site:telex.hu/english 2026",
              },
              completedAt: "2026-06-23T07:11:32.000Z",
              error: "Web search request failed.",
              id: "tool_failed",
              startedAt: "2026-06-23T07:11:31.100Z",
              status: "error",
              title: "Web search: site:telex.hu/english 2026",
              turn: 1,
              toolId: "web_search",
            },
          ],
          wordCount: 0,
        },
      },
    ],
    session: {
      createdAt: "2026-06-23T07:11:30.000Z",
      id: "session_1",
      messageCount: 2,
      modelId: "google/gemini-3.5-flash",
      parameters: {
        contextSize: null,
        temperature: 0.7,
        topK: null,
        topP: 0.95,
      },
      parentSessionId: null,
      providerId: "google",
      title: "Telex.hu's latest news updates",
      type: "conversation",
      updatedAt: "2026-06-23T07:11:33.000Z",
      wordCount: 7,
      workspacePath: null,
    },
    systemMessage: {
      content: "System prompt",
      role: "system",
    },
    tools: [
      {
        function: {
          description: "Search the web",
          name: "web_search",
          parameters: {
            type: "object",
          },
        },
        type: "function",
      },
    ],
  };
}

function assistantMessageWithToolCall(status: "completed" | "error"): ChatUiMessage {
  return {
    content: "",
    createdAt: "2026-06-23T07:11:33.000Z",
    id: "msg_assistant",
    modelId: "claude-sonnet-4.6",
    persisted: false,
    role: "assistant",
    status: "thinking",
    thinking: {
      content: "",
      durationMs: 1_400,
      toolCalls: [
        {
          args: {
            query: "latest news telex.hu 2026",
          },
          completedAt: "2026-06-23T07:11:32.000Z",
          id: "tool_search",
          ...(status === "completed"
            ? { result: "Search result", status }
            : {
                error: "Web search request failed.",
                status,
              }),
          startedAt: "2026-06-23T07:11:31.100Z",
          title: "Web search",
          toolId: "web_search",
        },
      ],
      wordCount: 0,
    },
  };
}
