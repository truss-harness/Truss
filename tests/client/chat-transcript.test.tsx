import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { defaultRichFeatureSettings } from "../../src/client/rich-features.ts";
import {
  ChatTranscript,
  ToolCallSecurityBlock,
} from "../../src/client/components/chat/ChatTranscript.tsx";
import type { ChatUiMessage } from "../../src/client/components/chat/types.ts";
import { toolResultImagePreview } from "../../src/shared/tool-result-images.ts";

describe("ChatTranscript", () => {
  it("does not display generated sub-agent completion messages", () => {
    const messages: ChatUiMessage[] = [
      {
        content: "Sub-agent completed in 8s.\n\nHidden child output.",
        createdAt: "2026-06-28T20:36:00.000Z",
        generated: {
          kind: "sub_agent_completion",
          subSessionId: "session_child",
        },
        id: "msg_child_completion",
        role: "assistant",
      },
      {
        content: "Visible parent response.",
        createdAt: "2026-06-28T20:37:00.000Z",
        id: "msg_parent",
        role: "assistant",
      },
    ];

    const markup = renderToStaticMarkup(
      createElement(ChatTranscript, {
        disabled: false,
        messages,
        onCopySuccess: () => undefined,
        onDeleteMessage: async () => undefined,
        onEditMessage: async () => undefined,
        onRetryMessage: async () => undefined,
        onUpdateAttachment: async () => undefined,
        readOnly: true,
        richFeatures: defaultRichFeatureSettings,
      }),
    );

    expect(markup).toContain("Visible parent response.");
    expect(markup).not.toContain("Sub-agent completed");
    expect(markup).not.toContain("Hidden child output");
    expect(markup).not.toContain("Open sub-agent");
  });

  it("includes interrupted tool use in the visible thought duration", () => {
    const messages: ChatUiMessage[] = [
      {
        content: "Request stopped.",
        createdAt: "2026-06-29T11:49:00.000Z",
        id: "msg_stopped",
        modelId: "gemini-3.5-flash",
        persisted: false,
        role: "assistant",
        status: "error",
        thinking: {
          content: "Inspect the files and verify behavior.",
          durationMs: 8_000,
          toolCalls: [
            {
              args: {},
              completedAt: "2026-06-29T11:49:20.000Z",
              id: "tool_one",
              result: "Done",
              startedAt: "2026-06-29T11:49:10.000Z",
              status: "completed",
              title: "Read file",
              toolId: "read_file",
              turn: 1,
            },
            {
              args: {},
              completedAt: "2026-06-29T11:49:16.000Z",
              error: "Request stopped.",
              id: "tool_two",
              startedAt: "2026-06-29T11:49:12.000Z",
              status: "error",
              title: "Search files",
              toolId: "search_files",
              turn: 1,
            },
          ],
          wordCount: 6,
        },
      },
    ];

    const markup = renderToStaticMarkup(
      createElement(ChatTranscript, {
        disabled: false,
        messages,
        onCopySuccess: () => undefined,
        onDeleteMessage: async () => undefined,
        onEditMessage: async () => undefined,
        onRetryMessage: async () => undefined,
        onUpdateAttachment: async () => undefined,
        readOnly: true,
        richFeatures: defaultRichFeatureSettings,
      }),
    );

    expect(markup).toContain("Thought for 18 seconds");
    expect(markup).toContain("2 tools, 1 failed");
  });

  it("does not add tool duration again for completed responses", () => {
    const messages: ChatUiMessage[] = [
      {
        content: "Done.",
        createdAt: "2026-06-29T11:49:00.000Z",
        id: "msg_done",
        modelId: "gemini-3.5-flash",
        persisted: true,
        role: "assistant",
        thinking: {
          content: "Inspect the files.",
          durationMs: 18_000,
          toolCalls: [
            {
              args: {},
              completedAt: "2026-06-29T11:49:20.000Z",
              id: "tool_one",
              result: "Done",
              startedAt: "2026-06-29T11:49:10.000Z",
              status: "completed",
              title: "Read file",
              toolId: "read_file",
              turn: 1,
            },
          ],
          wordCount: 3,
        },
      },
    ];

    const markup = renderToStaticMarkup(
      createElement(ChatTranscript, {
        disabled: false,
        messages,
        onCopySuccess: () => undefined,
        onDeleteMessage: async () => undefined,
        onEditMessage: async () => undefined,
        onRetryMessage: async () => undefined,
        onUpdateAttachment: async () => undefined,
        readOnly: true,
        richFeatures: defaultRichFeatureSettings,
      }),
    );

    expect(markup).toContain("Thought for 18 seconds");
    expect(markup).not.toContain("Thought for 28 seconds");
  });

  it("includes the active turn's raw LLM output in repeated tool-use response failures", () => {
    const messages: ChatUiMessage[] = [
      {
        content: "Find the project status.",
        createdAt: "2026-07-21T09:00:00.000Z",
        id: "msg_user",
        role: "user",
      },
      {
        content: "I will inspect the repository.",
        createdAt: "2026-07-21T09:00:01.000Z",
        id: "msg_intermediate",
        role: "assistant",
        thinking: {
          content: "I need to list the project files.",
          durationMs: 500,
          toolCalls: [
            {
              args: { path: "." },
              id: "tool_list",
              startedAt: "2026-07-21T09:00:01.000Z",
              status: "completed",
              title: "List files",
              toolId: "list_files",
            },
          ],
          wordCount: 7,
        },
      },
      {
        content:
          "I couldn't complete the requested tool use because the model's tool-use response kept failing.\n\nError: The provider did not return a chat message or tool call.",
        createdAt: "2026-07-21T09:00:02.000Z",
        id: "msg_failure",
        role: "assistant",
        thinking: {
          content: "Retry the tool call with corrected arguments.",
          durationMs: 900,
          wordCount: 7,
        },
      },
    ];

    const markup = renderToStaticMarkup(
      createElement(ChatTranscript, {
        disabled: false,
        messages,
        onCopySuccess: () => undefined,
        onDeleteMessage: async () => undefined,
        onEditMessage: async () => undefined,
        onRetryMessage: async () => undefined,
        onUpdateAttachment: async () => undefined,
        readOnly: true,
        richFeatures: defaultRichFeatureSettings,
      }),
    );

    expect(markup).toContain("<details");
    expect(markup).toContain("Raw LLM output");
    expect(markup).toContain("I will inspect the repository.");
    expect(markup).toContain("I need to list the project files.");
    expect(markup).toContain("Retry the tool call with corrected arguments.");
    expect(markup).toContain("language-json");
    expect(markup).not.toContain("<details open");
  });

  it("shows assistant run chrome only on the first and last adjacent assistant segment", () => {
    const messages: ChatUiMessage[] = [
      {
        content: "First segment.",
        createdAt: "2026-06-30T09:43:00.000Z",
        id: "msg_first",
        modelId: "deepseek-v4-pro",
        role: "assistant",
      },
      {
        content: "Second segment.",
        createdAt: "2026-06-30T09:44:00.000Z",
        id: "msg_second",
        modelId: "deepseek-v4-pro",
        role: "assistant",
      },
      {
        content: "Third segment.",
        createdAt: "2026-06-30T09:45:00.000Z",
        id: "msg_third",
        modelId: "deepseek-v4-pro",
        role: "assistant",
      },
    ];

    const markup = renderToStaticMarkup(
      createElement(ChatTranscript, {
        disabled: false,
        messages,
        onCopySuccess: () => undefined,
        onDeleteMessage: async () => undefined,
        onEditMessage: async () => undefined,
        onRetryMessage: async () => undefined,
        onUpdateAttachment: async () => undefined,
        richFeatures: defaultRichFeatureSettings,
      }),
    );

    expect(markup).toContain("First segment.");
    expect(markup).toContain("Second segment.");
    expect(markup).toContain("Third segment.");
    expect(countOccurrences(markup, "Deepseek v4 Pro")).toBe(1);
    expect(countOccurrences(markup, 'dateTime="2026-06-30T09:43:00.000Z"')).toBe(1);
    expect(countOccurrences(markup, 'dateTime="2026-06-30T09:44:00.000Z"')).toBe(0);
    expect(countOccurrences(markup, 'dateTime="2026-06-30T09:45:00.000Z"')).toBe(0);
    expect(countOccurrences(markup, 'aria-label="Copy as markdown"')).toBe(1);
    expect(countOccurrences(markup, 'aria-label="Retry"')).toBe(1);
  });

  it("hides thinking before a tool call outside the detail modal", () => {
    const messages: ChatUiMessage[] = [
      {
        content: "Done.",
        createdAt: "2026-06-30T14:15:00.000Z",
        id: "msg_command",
        modelId: "demo-model",
        role: "assistant",
        thinking: {
          content: "Plan the command.\n\nReview the guarded result.",
          durationMs: 12_000,
          toolCalls: [
            {
              args: {
                command: "php artisan db:show",
                timeoutSeconds: 30,
                workingDirectory: "C:\\repo",
              },
              completedAt: "2026-06-30T14:15:12.000Z",
              id: "tool_command",
              result: "run_command:\n  stdout: ok",
              startedAt: "2026-06-30T14:15:02.000Z",
              status: "completed",
              thinkingAfter: "Review the guarded result.",
              thinkingBefore: "Plan the command.",
              title: "Run command: php artisan db:show",
              toolId: "run_command",
              turn: 1,
            },
          ],
          wordCount: 7,
        },
      },
    ];

    const markup = renderToStaticMarkup(
      createElement(ChatTranscript, {
        disabled: false,
        messages,
        onCopySuccess: () => undefined,
        onDeleteMessage: async () => undefined,
        onEditMessage: async () => undefined,
        onRetryMessage: async () => undefined,
        onUpdateAttachment: async () => undefined,
        readOnly: true,
        richFeatures: defaultRichFeatureSettings,
      }),
    );

    expect(markup).toContain("Run command: php artisan db:show");
    expect(markup).toContain("Review the guarded result.");
    expect(markup).not.toContain("Plan the command.");
    expect(markup).not.toContain("2 reasoning phases");
  });

  it("renders command-runner guard assessments in the security block", () => {
    const markup = renderToStaticMarkup(
      createElement(ToolCallSecurityBlock, {
        toolCall: {
          args: {
            command: "php artisan db:show",
            timeoutSeconds: 30,
            workingDirectory: "C:\\repo",
          },
          completedAt: "2026-06-30T14:02:30.000Z",
          id: "tool_command",
          result: "[Truss Command Runner output redacted by post-execution guard.]",
          security: {
            commandRunner: {
              postExecution: {
                enabled: true,
                model: {
                  modelId: "gpt-5.4-mini",
                  providerId: "openai",
                  providerLabel: "OpenAI",
                },
                verdict: {
                  denyOutput: true,
                  safetyLevel: "dangerous",
                  safetyReasoning: "The output may contain private database details.",
                  tldr: "Database details were withheld.",
                },
              },
              preExecution: {
                enabled: true,
                model: {
                  modelId: "gpt-5.4-mini",
                  providerId: "openai",
                  providerLabel: "OpenAI",
                },
                verdict: {
                  accessesOutsideWhitelist: false,
                  safetyLevel: "safe",
                  safetyReasoning: "The command only reads application database status.",
                  tldr: "Show database status.",
                },
              },
            },
          },
          startedAt: "2026-06-30T14:02:00.000Z",
          status: "completed",
          title: "Run command: php artisan db:show",
          toolId: "run_command",
          turn: 1,
        },
      }),
    );

    expect(markup).toContain("Security");
    expect(markup).toContain("Pre-execution guard");
    expect(markup).toContain("Post-execution output guard");
    expect(markup).toContain("OpenAI / gpt-5.4-mini");
    expect(markup).toContain("Show database status.");
    expect(markup).toContain("Database details were withheld.");
    expect(markup).toContain("Output denied");
    expect(markup).toContain("The output may contain private database details.");
  });

  it("renders a terminate button for running command executions", () => {
    const messages: ChatUiMessage[] = [
      {
        content: "",
        createdAt: "2026-06-30T14:15:00.000Z",
        id: "msg_running_command",
        modelId: "demo-model",
        role: "assistant",
        status: "thinking",
        thinking: {
          content: "",
          durationMs: 4_000,
          toolCalls: [
            {
              args: {
                command: "Start-Sleep -Seconds 30",
                timeoutSeconds: 30,
                workingDirectory: "C:\\repo",
              },
              commandExecution: {
                command: "Start-Sleep -Seconds 30",
                executionId: "tool_running",
                label: "Start-Sleep -Seconds 30",
                startedAt: "2026-06-30T14:15:02.000Z",
                status: "running",
              },
              id: "tool_running",
              startedAt: "2026-06-30T14:15:02.000Z",
              status: "running",
              title: "Run command: Start-Sleep -Seconds 30",
              toolId: "run_command",
              turn: 1,
            },
          ],
          wordCount: 0,
        },
      },
    ];

    const markup = renderToStaticMarkup(
      createElement(ChatTranscript, {
        disabled: false,
        messages,
        onCopySuccess: () => undefined,
        onDeleteMessage: async () => undefined,
        onEditMessage: async () => undefined,
        onRetryMessage: async () => undefined,
        onTerminateCommand: async () => undefined,
        onUpdateAttachment: async () => undefined,
        readOnly: true,
        richFeatures: defaultRichFeatureSettings,
      }),
    );

    expect(markup).toContain("Terminate Run command: Start-Sleep -Seconds 30");
    expect(markup).toContain("Terminate command");
  });
});

describe("toolResultImagePreview", () => {
  it("detects JSON image tool results with base64 data", () => {
    const image = toolResultImagePreview(
      JSON.stringify({
        type: "image",
        data: "/9j/4AAQSkZJRg==",
      }),
    );

    expect(image).toEqual({
      contentType: "image/jpeg",
      src: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
    });
  });

  it("detects TOON image_base64 tool results", () => {
    const image = toolResultImagePreview(
      [
        "website_screenshot:",
        "  content_type: image/jpeg",
        "  encoding: base64",
        "  data_url_prefix: data:image/jpeg;base64,",
        "  image_base64: |-",
        "    AQID",
      ].join("\n"),
    );

    expect(image).toEqual({
      contentType: "image/jpeg",
      src: "data:image/jpeg;base64,AQID",
    });
  });
});

function countOccurrences(value: string, search: string): number {
  return value.split(search).length - 1;
}
