import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentSessionSummary,
  ChatStreamEvent,
  ChatToolCallProgress,
  LlmGenerationParameters,
  LlmProviderSummary,
  RichFeatureSettingsSummary,
} from "../../src/shared/protocol.ts";
import { handleChatRoute } from "../../src/server/http/routes-chat.ts";
import type { ServerContext } from "../../src/server/http/context.ts";
import type { McpToolBinding } from "../../src/server/mcp/runtime.ts";
import {
  CommandExecutionRegistry,
  commandRunnerToolDefinitions,
  trussCommandRunnerServerName,
} from "../../src/server/tools/command-runner.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("handleChatRoute tool execution", () => {
  it("stops an active provider stream when the chat request aborts", async () => {
    let providerAborted = false;
    let providerStarted: (() => void) | null = null;
    const providerStartedPromise = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });

    globalThis.fetch = (async (_input, init) => {
      providerStarted?.();

      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const abort = () => {
          providerAborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        };

        if (signal?.aborted) {
          abort();
          return;
        }

        signal?.addEventListener("abort", abort, { once: true });
      });
    }) as typeof fetch;

    const controller = new AbortController();
    const response = await handleChatRoute(
      new Request("http://truss.test/api/chat", {
        body: JSON.stringify({
          messages: [{ content: "Keep going.", role: "user" }],
          sessionId: testSession.id,
          tools: {
            loadWebpageEnabled: true,
            webSearchEnabled: true,
          },
          type: "agentic",
        }),
        method: "POST",
        signal: controller.signal,
      }),
      testContext({
        callTool: async () => "unused",
        resolveTool: () => null,
        toolDefinitions: [],
      }),
    );
    const textPromise = response.text();

    await providerStartedPromise;
    controller.abort();

    const events = parseStreamEvents(await textPromise);

    expect(response.status).toBe(200);
    expect(providerAborted).toBe(true);
    expect(events.map((event) => event.type)).toEqual(["start"]);
  });

  it("hides MCP-provided sub-agent spawning outside agentic turns", async () => {
    const conversationSession: AgentSessionSummary = {
      ...testSession,
      id: "session-conversation",
      type: "conversation",
    };
    const requestBodies: Array<{
      tools?: unknown[];
    }> = [];

    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        tools?: unknown[];
      };
      requestBodies.push(body);

      return openAiStreamResponse([
        {
          choices: [
            {
              delta: {
                content: "No tools.",
              },
            },
          ],
        },
      ]);
    }) as typeof fetch;

    const response = await handleChatRoute(
      new Request("http://truss.test/api/chat", {
        body: JSON.stringify({
          messages: [{ content: "Answer directly.", role: "user" }],
          sessionId: conversationSession.id,
          tools: {
            loadWebpageEnabled: true,
            webSearchEnabled: true,
          },
          type: "conversation",
        }),
        method: "POST",
      }),
      testContext({
        callTool: async () => "unused",
        resolveTool: () => null,
        session: conversationSession,
        toolDefinitions: [
          {
            description: "Spawn a child agent session.",
            name: "spawn_sub_agent",
            parameters: { type: "object", properties: {} },
          },
        ],
      }),
    );

    const events = parseStreamEvents(await response.text());
    const done = events.find(
      (event): event is Extract<ChatStreamEvent, { type: "done" }> =>
        event.type === "done",
    );

    expect(response.status).toBe(200);
    expect(requestBodies[0]?.tools).toBeUndefined();
    expect(done?.message.content).toBe("No tools.");
  });

  it("does not duplicate MCP-provided sub-agent spawning in agentic turns", async () => {
    const requestBodies: Array<{
      tools?: Array<{ function?: { name?: string } }>;
    }> = [];

    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        tools?: Array<{ function?: { name?: string } }>;
      };
      requestBodies.push(body);

      return jsonResponse({
        choices: [
          {
            message: {
              content: "No spawn needed.",
            },
          },
        ],
      });
    }) as typeof fetch;

    const response = await handleChatRoute(
      new Request("http://truss.test/api/chat", {
        body: JSON.stringify({
          messages: [{ content: "Answer directly.", role: "user" }],
          sessionId: testSession.id,
          tools: {
            loadWebpageEnabled: true,
            webSearchEnabled: true,
          },
          type: "agentic",
        }),
        method: "POST",
      }),
      testContext({
        callTool: async () => "unused",
        resolveTool: () => null,
        toolDefinitions: [
          {
            description: "Spawn a child agent session.",
            name: "spawn_sub_agent",
            parameters: { type: "object", properties: {} },
          },
        ],
      }),
    );

    const events = parseStreamEvents(await response.text());
    const done = events.find(
      (event): event is Extract<ChatStreamEvent, { type: "done" }> =>
        event.type === "done",
    );
    const toolNames = requestBodies[0]?.tools?.map((tool) => tool.function?.name) ?? [];

    expect(response.status).toBe(200);
    expect(toolNames.filter((name) => name === "spawn_sub_agent")).toHaveLength(1);
    expect(done?.message.content).toBe("No spawn needed.");
  });

  it("runs provider-requested tool calls from the same turn in parallel", async () => {
    const toolDefinitions = [
      {
        description: "First test tool",
        name: "first_tool",
        parameters: { type: "object", properties: {} },
      },
      {
        description: "Second test tool",
        name: "second_tool",
        parameters: { type: "object", properties: {} },
      },
    ];
    const bindings = new Map<string, McpToolBinding>(
      toolDefinitions.map((definition) => [
        definition.name,
        {
          definition,
          serverId: "demo-server",
          serverName: "Demo Server",
          toolName: definition.name,
        },
      ]),
    );
    let activeToolCalls = 0;
    let maxActiveToolCalls = 0;
    let releaseTools: (() => void) | null = null;
    const releasePromise = new Promise<void>((resolve) => {
      releaseTools = resolve;
    });
    let providerCallCount = 0;
    const requestBodies: Array<{
      parallel_tool_calls?: boolean;
      stream?: boolean;
    }> = [];

    globalThis.fetch = (async (_input, init) => {
      providerCallCount += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        parallel_tool_calls?: boolean;
        stream?: boolean;
      };
      requestBodies.push(body);

      if (providerCallCount === 1) {
        expect(body.parallel_tool_calls).toBe(true);

        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  openAiToolCall("call_first", "first_tool"),
                  openAiToolCall("call_second", "second_tool"),
                ],
              },
            },
          ],
        });
      }

      return openAiStreamResponse([
        {
          choices: [
            {
              delta: {
                content: "Both tools",
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                content: " finished.",
              },
            },
          ],
        },
      ]);
    }) as typeof fetch;

    const response = await handleChatRoute(
      new Request("http://truss.test/api/chat", {
        body: JSON.stringify({
          messages: [{ content: "Use both tools.", role: "user" }],
          sessionId: testSession.id,
          tools: {
            loadWebpageEnabled: true,
            webSearchEnabled: true,
          },
          type: "agentic",
        }),
        method: "POST",
      }),
      testContext({
        callTool: async ({ binding }) => {
          activeToolCalls += 1;
          maxActiveToolCalls = Math.max(maxActiveToolCalls, activeToolCalls);

          if (activeToolCalls === 2) {
            releaseTools?.();
          }

          await Promise.race([releasePromise, sleep(50)]);
          activeToolCalls -= 1;

          return `${binding.toolName} result`;
        },
        resolveTool: (name) => bindings.get(name) ?? null,
        toolDefinitions,
      }),
    );

    const events = parseStreamEvents(await response.text());
    const done = events.find((event) => event.type === "done");
    const doneIndex = events.findIndex((event) => event.type === "done");
    const firstContentDeltaIndex = events.findIndex(
      (event) => event.type === "content_delta",
    );
    const streamedContent = events
      .filter((event) => event.type === "content_delta")
      .map((event) => event.delta)
      .join("");

    expect(response.status).toBe(200);
    expect(maxActiveToolCalls).toBe(2);
    expect(requestBodies[1]?.stream).toBe(true);
    expect(firstContentDeltaIndex).toBeGreaterThan(-1);
    expect(firstContentDeltaIndex).toBeLessThan(doneIndex);
    expect(streamedContent).toBe("Both tools finished.");
    expect(done?.type).toBe("done");
    expect(done?.message.content).toBe("Both tools finished.");
    expect(
      done?.type === "done" ? done.thinking?.toolCalls?.map((toolCall) => toolCall.turn) : [],
    ).toEqual([1, 1]);
  });

  it("streams MCP tool progress updates through tool call events", async () => {
    const toolDefinitions = [
      {
        description: "Load a webpage.",
        name: "load_webpage",
        parameters: { type: "object", properties: {} },
      },
    ];
    const binding: McpToolBinding = {
      definition: toolDefinitions[0]!,
      serverId: "truss-web-tools",
      serverName: "Truss Web Tools",
      toolName: "load_webpage",
    };
    let providerCallCount = 0;

    globalThis.fetch = (async (_input, init) => {
      providerCallCount += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{
          role?: string;
          tool_call_id?: string;
          tool_calls?: unknown[];
        }>;
      };

      if (providerCallCount === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  openAiToolCall("call_load_page", "load_webpage", {
                    url: "https://example.com/",
                  }),
                ],
              },
            },
          ],
        });
      }

      expect(body.messages?.at(-1)).toMatchObject({
        role: "tool",
        tool_call_id: "call_load_page",
      });

      return openAiStreamResponse([
        {
          choices: [
            {
              delta: {
                content: "Page loaded.",
              },
            },
          ],
        },
      ]);
    }) as typeof fetch;

    const response = await handleChatRoute(
      new Request("http://truss.test/api/chat", {
        body: JSON.stringify({
          messages: [{ content: "Load this page.", role: "user" }],
          sessionId: testSession.id,
          tools: {
            loadWebpageEnabled: true,
            webSearchEnabled: true,
          },
          type: "agentic",
        }),
        method: "POST",
      }),
      testContext({
        callTool: async ({ onProgress }) => {
          onProgress?.({ message: "Fetching page...", percent: 20 });
          onProgress?.({ message: "Converting page to text...", percent: 60 });
          onProgress?.({ message: "Sanitizing page...", percent: 100 });

          return "page result";
        },
        resolveTool: (name) => (name === "load_webpage" ? binding : null),
        toolDefinitions,
      }),
    );

    const events = parseStreamEvents(await response.text());
    const toolEvents = events.filter(
      (event): event is Extract<ChatStreamEvent, { type: "tool_call" }> =>
        event.type === "tool_call",
    );
    const done = events.find(
      (event): event is Extract<ChatStreamEvent, { type: "done" }> =>
        event.type === "done",
    );

    expect(response.status).toBe(200);
    expect(toolEvents.map((event) => event.call.progress?.percent)).toEqual([
      undefined,
      20,
      60,
      100,
      100,
    ]);
    expect(toolEvents.at(-1)?.call.status).toBe("completed");
    expect(toolEvents.at(-1)?.call.progress).toEqual({
      message: "Sanitizing page...",
      percent: 100,
    });
    expect(done?.message.content).toBe("Page loaded.");
    expect(done?.thinking?.toolCalls?.[0]?.progress).toEqual({
      message: "Sanitizing page...",
      percent: 100,
    });
  });

  it("continues conversation-mode tool use with tool observations in context", async () => {
    const toolDefinitions = [
      {
        description: "First test tool",
        name: "first_tool",
        parameters: { type: "object", properties: {} },
      },
      {
        description: "Second test tool",
        name: "second_tool",
        parameters: { type: "object", properties: {} },
      },
    ];
    const bindings = new Map<string, McpToolBinding>(
      toolDefinitions.map((definition) => [
        definition.name,
        {
          definition,
          serverId: "demo-server",
          serverName: "Demo Server",
          toolName: definition.name,
        },
      ]),
    );
    const conversationSession: AgentSessionSummary = {
      ...testSession,
      id: "session-conversation",
      type: "conversation",
    };
    const toolCallNames: string[] = [];
    const requestBodies: Array<{
      messages?: Array<{
        content?: unknown;
        role?: string;
        tool_call_id?: string;
        tool_calls?: unknown[];
      }>;
      stream?: boolean;
      tools?: unknown[];
    }> = [];
    let providerCallCount = 0;

    globalThis.fetch = (async (_input, init) => {
      providerCallCount += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{
          content?: unknown;
          role?: string;
          tool_call_id?: string;
          tool_calls?: unknown[];
        }>;
        stream?: boolean;
        tools?: unknown[];
      };
      requestBodies.push(body);

      if (providerCallCount === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [openAiToolCall("call_first", "first_tool")],
              },
            },
          ],
        });
      }

      if (providerCallCount === 2) {
        return openAiStreamResponse([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      function: {
                        arguments: "{}",
                        name: "second_tool",
                      },
                      id: "call_second",
                      index: 0,
                      type: "function",
                    },
                  ],
                },
              },
            ],
          },
        ]);
      }

      return openAiStreamResponse([
        {
          choices: [
            {
              delta: {
                content: "Finished after the second tool.",
              },
            },
          ],
        },
      ]);
    }) as typeof fetch;

    const response = await handleChatRoute(
      new Request("http://truss.test/api/chat", {
        body: JSON.stringify({
          messages: [{ content: "Use the tools.", role: "user" }],
          sessionId: conversationSession.id,
          tools: {
            loadWebpageEnabled: true,
            webSearchEnabled: true,
          },
          type: "conversation",
        }),
        method: "POST",
      }),
      testContext({
        callTool: async ({ binding }) => {
          toolCallNames.push(binding.toolName);

          return `${binding.toolName} result`;
        },
        resolveTool: (name) => bindings.get(name) ?? null,
        session: conversationSession,
        toolDefinitions,
      }),
    );

    const events = parseStreamEvents(await response.text());
    const done = events.find(
      (event): event is Extract<ChatStreamEvent, { type: "done" }> =>
        event.type === "done",
    );

    expect(response.status).toBe(200);
    expect(providerCallCount).toBe(3);
    expect(toolCallNames).toEqual(["first_tool", "second_tool"]);
    expect(requestBodies[1]?.tools).toHaveLength(2);
    expect(requestBodies[2]?.tools).toHaveLength(2);
    expect(requestBodies[1]?.messages?.at(-2)).toMatchObject({
      role: "assistant",
    });
    expect(requestBodies[1]?.messages?.at(-2)?.tool_calls).toHaveLength(1);
    expect(requestBodies[1]?.messages?.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "call_first",
    });
    expect(done?.message.content).toBe("Finished after the second tool.");
  });

  it("auto-approves directory access requests covered by active grants", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "truss-route-chat-"));
    const workspaceRoot = join(tempRoot, "workspace");
    const grantedRoot = join(tempRoot, "granted");
    const nestedDirectory = join(grantedRoot, "nested");

    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(nestedDirectory, { recursive: true });

    try {
      const definition = {
        description: "Request a file-access directory grant.",
        name: "request_directory_access",
        parameters: { type: "object", properties: {} },
      };
      const binding: McpToolBinding = {
        definition,
        serverId: "truss-chat-tools",
        serverName: "Truss Chat Tools",
        toolName: "request_directory_access",
      };
      const session: AgentSessionSummary = {
        ...testSession,
        id: "session-directory-access",
        workspacePath: workspaceRoot,
      };
      const createdMessages: Array<{ content: string; role: "assistant" }> = [];
      const publishedEvents: unknown[] = [];
      let providerCallCount = 0;

      globalThis.fetch = (async (_input, init) => {
        providerCallCount += 1;

        if (providerCallCount === 1) {
          return jsonResponse({
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    openAiToolCall("call_directory", "request_directory_access", {
                      directoryPath: nestedDirectory,
                      reason: "Need to inspect nested files.",
                    }),
                  ],
                },
              },
            ],
          });
        }

        const body = JSON.parse(String(init?.body ?? "{}")) as {
          messages?: Array<{ content?: string; role?: string }>;
        };
        const toolObservation = body.messages?.find((message) => message.role === "tool");

        expect(toolObservation?.content).toContain('"approvedAutomatically": true');

        return openAiStreamResponse([
          {
            choices: [
              {
                delta: {
                  content: "Access is already available.",
                },
              },
            ],
          },
        ]);
      }) as typeof fetch;

      const response = await handleChatRoute(
        new Request("http://truss.test/api/chat", {
          body: JSON.stringify({
            messages: [{ content: "Request the nested directory.", role: "user" }],
            sessionId: session.id,
            tools: {
              loadWebpageEnabled: true,
              webSearchEnabled: true,
            },
            type: "agentic",
          }),
          method: "POST",
        }),
        testContext({
          callTool: async () => {
            throw new Error("request_directory_access should be handled by the chat host.");
          },
          conversationWorkspacePath: workspaceRoot,
          createdMessages,
          filesystemGrantDirectories: [grantedRoot],
          publishedEvents,
          resolveTool: (name) => (name === "request_directory_access" ? binding : null),
          session,
          toolDefinitions: [definition],
        }),
      );

      const events = parseStreamEvents(await response.text());
      const done = events.find(
        (event): event is Extract<ChatStreamEvent, { type: "done" }> =>
          event.type === "done",
      );
      const toolCalls = events.filter(
        (event): event is Extract<ChatStreamEvent, { type: "tool_call" }> =>
          event.type === "tool_call",
      );
      const completedToolCall = toolCalls.at(-1)?.call;
      const toolResult = JSON.parse(completedToolCall?.result ?? "{}") as {
        approvedAutomatically?: boolean;
        mcpReloaded?: boolean;
      };

      expect(response.status).toBe(200);
      expect(events.some((event) => event.type === "user_choice_request")).toBe(false);
      expect(providerCallCount).toBe(2);
      expect(toolResult.approvedAutomatically).toBe(true);
      expect(toolResult.mcpReloaded).toBe(false);
      expect(done?.message.content).toBe("Access is already available.");
      expect(
        createdMessages.some((message) =>
          message.content.includes("[Truss system event]: Automatically approved directory access"),
        ),
      ).toBe(true);
      expect(
        publishedEvents.some(
          (event) =>
            typeof event === "object" &&
            event !== null &&
            (event as { type?: string }).type === "agent.message",
        ),
      ).toBe(true);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("keeps separate thinking blocks around multiple agent tool turns", async () => {
    const toolDefinitions = [
      {
        description: "Demo test tool",
        name: "demo_tool",
        parameters: { type: "object", properties: {} },
      },
    ];
    const bindings = new Map<string, McpToolBinding>(
      toolDefinitions.map((definition) => [
        definition.name,
        {
          definition,
          serverId: "demo-server",
          serverName: "Demo Server",
          toolName: definition.name,
        },
      ]),
    );
    let providerCallCount = 0;
    let toolCallCount = 0;

    globalThis.fetch = (async (_input, _init) => {
      providerCallCount += 1;

      if (providerCallCount === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                reasoning_content: "Check first result.",
                tool_calls: [openAiToolCall("call_first", "demo_tool")],
              },
            },
          ],
        });
      }

      if (providerCallCount === 2) {
        return openAiStreamResponse([
          {
            choices: [
              {
                delta: {
                  reasoning_content: "Use first result.",
                },
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      function: {
                        arguments: "{}",
                        name: "demo_tool",
                      },
                      id: "call_second",
                      index: 0,
                      type: "function",
                    },
                  ],
                },
              },
            ],
          },
        ]);
      }

      return openAiStreamResponse([
        {
          choices: [
            {
              delta: {
                reasoning_content: "Summarize second result.",
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                content: "Done.",
              },
            },
          ],
        },
      ]);
    }) as typeof fetch;

    const response = await handleChatRoute(
      new Request("http://truss.test/api/chat", {
        body: JSON.stringify({
          messages: [{ content: "Use tools until done.", role: "user" }],
          sessionId: testSession.id,
          tools: {
            loadWebpageEnabled: true,
            webSearchEnabled: true,
          },
          type: "agentic",
        }),
        method: "POST",
      }),
      testContext({
        callTool: async () => {
          toolCallCount += 1;

          return `tool result ${toolCallCount}`;
        },
        resolveTool: (name) => bindings.get(name) ?? null,
        toolDefinitions,
      }),
    );

    const events = parseStreamEvents(await response.text());
    const done = events.find(
      (event): event is Extract<ChatStreamEvent, { type: "done" }> =>
        event.type === "done",
    );
    const thinkingDeltas = events
      .filter(
        (event): event is Extract<ChatStreamEvent, { type: "thinking_delta" }> =>
          event.type === "thinking_delta",
      )
      .map((event) => event.delta);

    expect(response.status).toBe(200);
    expect(providerCallCount).toBe(3);
    expect(toolCallCount).toBe(2);
    expect(thinkingDeltas).toEqual([
      "Check first result.",
      "\n\nUse first result.",
      "\n\nSummarize second result.",
    ]);
    expect(done?.message.content).toBe("Done.");
    expect(done?.thinking?.content).toBe(
      "Check first result.\n\nUse first result.\n\nSummarize second result.",
    );
    expect(done?.thinking?.toolCalls?.map((toolCall) => toolCall.toolId)).toEqual([
      "demo_tool",
      "demo_tool",
    ]);
    expect(done?.thinking?.toolCalls?.map((toolCall) => toolCall.turn)).toEqual([1, 2]);
    expect(done?.thinking?.toolCalls?.[0]?.thinkingBefore).toBe("Check first result.");
    expect(done?.thinking?.toolCalls?.[0]?.thinkingAfter).toBe("Use first result.");
    expect(done?.thinking?.toolCalls?.[1]?.thinkingBefore).toBe("Use first result.");
    expect(done?.thinking?.toolCalls?.[1]?.thinkingAfter).toBeUndefined();
  });

  it("starts a new assistant block after visible text when tool use continues", async () => {
    const toolDefinitions = [
      {
        description: "Demo test tool",
        name: "demo_tool",
        parameters: { type: "object", properties: {} },
      },
    ];
    const binding: McpToolBinding = {
      definition: toolDefinitions[0]!,
      serverId: "demo-server",
      serverName: "Demo Server",
      toolName: "demo_tool",
    };
    const createdMessages: Array<{ content: string; role: "assistant"; thinking?: unknown }> = [];
    let providerCallCount = 0;
    let toolCallCount = 0;

    globalThis.fetch = (async (_input, _init) => {
      providerCallCount += 1;

      if (providerCallCount === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "Visible checkpoint.",
                reasoning_content: "Check first result.",
                tool_calls: [openAiToolCall("call_first", "demo_tool")],
              },
            },
          ],
        });
      }

      if (providerCallCount === 2) {
        return openAiStreamResponse([
          {
            choices: [
              {
                delta: {
                  reasoning_content: "Continue after checkpoint.",
                },
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      function: {
                        arguments: "{}",
                        name: "demo_tool",
                      },
                      id: "call_second",
                      index: 0,
                      type: "function",
                    },
                  ],
                },
              },
            ],
          },
        ]);
      }

      return openAiStreamResponse([
        {
          choices: [
            {
              delta: {
                content: "Final answer.",
              },
            },
          ],
        },
      ]);
    }) as typeof fetch;

    const response = await handleChatRoute(
      new Request("http://truss.test/api/chat", {
        body: JSON.stringify({
          messages: [{ content: "Use tools and keep me updated.", role: "user" }],
          sessionId: testSession.id,
          tools: {
            loadWebpageEnabled: true,
            webSearchEnabled: true,
          },
          type: "agentic",
        }),
        method: "POST",
      }),
      testContext({
        callTool: async () => {
          toolCallCount += 1;

          return `tool result ${toolCallCount}`;
        },
        createdMessages,
        resolveTool: (name) => (name === "demo_tool" ? binding : null),
        toolDefinitions,
      }),
    );

    const events = parseStreamEvents(await response.text());
    const intermediateMessages = events.filter(
      (event): event is Extract<ChatStreamEvent, { type: "assistant_message" }> =>
        event.type === "assistant_message",
    );
    const done = events.find(
      (event): event is Extract<ChatStreamEvent, { type: "done" }> =>
        event.type === "done",
    );
    const thinkingDeltas = events
      .filter(
        (event): event is Extract<ChatStreamEvent, { type: "thinking_delta" }> =>
          event.type === "thinking_delta",
      )
      .map((event) => event.delta);

    expect(response.status).toBe(200);
    expect(providerCallCount).toBe(3);
    expect(toolCallCount).toBe(2);
    expect(thinkingDeltas).toEqual([
      "Check first result.",
      "Continue after checkpoint.",
    ]);
    expect(intermediateMessages).toHaveLength(1);
    expect(intermediateMessages[0]?.message.content).toBe("Visible checkpoint.");
    expect(intermediateMessages[0]?.thinking?.content).toBe("Check first result.");
    expect(intermediateMessages[0]?.thinking?.toolCalls?.map((toolCall) => toolCall.turn)).toEqual([
      1,
    ]);
    expect(intermediateMessages[0]?.thinking?.toolCalls?.[0]?.thinkingAfter).toBeUndefined();
    expect(done?.message.content).toBe("Final answer.");
    expect(done?.thinking?.content).toBe("Continue after checkpoint.");
    expect(done?.thinking?.toolCalls?.map((toolCall) => toolCall.turn)).toEqual([2]);
    expect(done?.thinking?.toolCalls?.[0]?.thinkingBefore).toBe("Continue after checkpoint.");
    expect(done?.thinking?.toolCalls?.[0]?.thinkingAfter).toBeUndefined();
    expect(createdMessages.map((message) => message.content)).toEqual([
      "Visible checkpoint.",
      "Final answer.",
    ]);
  });

  it("preserves failed tool calls in an intermediate assistant block", async () => {
    const toolDefinitions = [
      {
        description: "Demo test tool",
        name: "demo_tool",
        parameters: { type: "object", properties: {} },
      },
    ];
    const binding: McpToolBinding = {
      definition: toolDefinitions[0]!,
      serverId: "demo-server",
      serverName: "Demo Server",
      toolName: "demo_tool",
    };
    const createdMessages: Array<{ content: string; role: "assistant"; thinking?: unknown }> = [];
    let providerCallCount = 0;

    globalThis.fetch = (async (_input, _init) => {
      providerCallCount += 1;

      if (providerCallCount === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "Visible checkpoint before the risky tool.",
                reasoning_content: "Try the risky tool.",
                tool_calls: [openAiToolCall("call_risky", "demo_tool")],
              },
            },
          ],
        });
      }

      return openAiStreamResponse([
        {
          choices: [
            {
              delta: {
                content: "Recovered after the tool error.",
              },
            },
          ],
        },
      ]);
    }) as typeof fetch;

    const response = await handleChatRoute(
      new Request("http://truss.test/api/chat", {
        body: JSON.stringify({
          messages: [{ content: "Use the risky tool.", role: "user" }],
          sessionId: testSession.id,
          tools: {
            loadWebpageEnabled: true,
            webSearchEnabled: true,
          },
          type: "agentic",
        }),
        method: "POST",
      }),
      testContext({
        callTool: async () => {
          throw new Error("Tool exploded.");
        },
        createdMessages,
        resolveTool: (name) => (name === "demo_tool" ? binding : null),
        toolDefinitions,
      }),
    );

    const events = parseStreamEvents(await response.text());
    const intermediateMessages = events.filter(
      (event): event is Extract<ChatStreamEvent, { type: "assistant_message" }> =>
        event.type === "assistant_message",
    );
    const done = events.find(
      (event): event is Extract<ChatStreamEvent, { type: "done" }> =>
        event.type === "done",
    );
    const failedToolCall = intermediateMessages[0]?.thinking?.toolCalls?.[0];

    expect(response.status).toBe(200);
    expect(providerCallCount).toBe(2);
    expect(intermediateMessages).toHaveLength(1);
    expect(intermediateMessages[0]?.message.content).toBe(
      "Visible checkpoint before the risky tool.",
    );
    expect(intermediateMessages[0]?.thinking?.content).toBe("Try the risky tool.");
    expect(failedToolCall?.status).toBe("error");
    expect(failedToolCall?.error).toBe("Tool exploded.");
    expect(failedToolCall?.thinkingBefore).toBe("Try the risky tool.");
    expect(done?.message.content).toBe("Recovered after the tool error.");
    expect(createdMessages.map((message) => message.content)).toEqual([
      "Visible checkpoint before the risky tool.",
      "Recovered after the tool error.",
    ]);
  });

  it("sends provider tool-use response failures back to the model before failing the turn", async () => {
    const toolDefinitions = [
      {
        description: "Demo test tool",
        name: "demo_tool",
        parameters: { type: "object", properties: {} },
      },
    ];
    const binding: McpToolBinding = {
      definition: toolDefinitions[0]!,
      serverId: "demo-server",
      serverName: "Demo Server",
      toolName: "demo_tool",
    };
    const requestBodies: Array<{ messages?: Array<{ content?: string; role?: string }> }> = [];
    let providerCallCount = 0;

    globalThis.fetch = (async (_input, init) => {
      providerCallCount += 1;
      requestBodies.push(JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ content?: string; role?: string }>;
      });

      if (providerCallCount === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                reasoning_content: "Use the demo tool.",
                tool_calls: [openAiToolCall("call_demo", "demo_tool")],
              },
            },
          ],
        });
      }

      if (providerCallCount === 2) {
        return openAiStreamResponse([]);
      }

      return openAiStreamResponse([
        {
          choices: [
            {
              delta: {
                content: "Recovered after the malformed tool-use response.",
              },
            },
          ],
        },
      ]);
    }) as typeof fetch;

    const response = await handleChatRoute(
      new Request("http://truss.test/api/chat", {
        body: JSON.stringify({
          messages: [{ content: "Use the demo tool.", role: "user" }],
          sessionId: testSession.id,
          tools: {
            loadWebpageEnabled: true,
            webSearchEnabled: true,
          },
          type: "agentic",
        }),
        method: "POST",
      }),
      testContext({
        callTool: async () => "tool result",
        resolveTool: (name) => (name === "demo_tool" ? binding : null),
        toolDefinitions,
      }),
    );

    const events = parseStreamEvents(await response.text());
    const done = events.find(
      (event): event is Extract<ChatStreamEvent, { type: "done" }> =>
        event.type === "done",
    );
    const recoveryMessages =
      requestBodies[2]?.messages?.filter(
        (message) =>
          message.role === "user" &&
          message.content?.includes("[Truss tool-use response error]"),
      ) ?? [];

    expect(response.status).toBe(200);
    expect(providerCallCount).toBe(3);
    expect(recoveryMessages).toHaveLength(1);
    expect(recoveryMessages[0]?.content).toContain(
      "The provider did not return a chat message or tool call.",
    );
    expect(done?.message.content).toBe(
      "Recovered after the malformed tool-use response.",
    );
    expect(done?.message.content).not.toContain("server stdout logs");
  });

  it("preserves image tool results beyond the model observation cap", async () => {
    const toolDefinitions = [
      {
        description: "Returns an image.",
        name: "image_tool",
        parameters: { type: "object", properties: {} },
      },
    ];
    const binding: McpToolBinding = {
      definition: toolDefinitions[0]!,
      serverId: "demo-server",
      serverName: "Demo Server",
      toolName: "image_tool",
    };
    const fullImageBase64 = `/9j/${"A".repeat(90_000)}`;
    const rawImageResult = JSON.stringify({
      type: "image",
      data: fullImageBase64,
    });
    const requestBodies: Array<{
      messages?: Array<{ content?: string; role?: string; tool_call_id?: string }>;
    }> = [];
    let providerCallCount = 0;

    globalThis.fetch = (async (_input, init) => {
      providerCallCount += 1;
      requestBodies.push(JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ content?: string; role?: string; tool_call_id?: string }>;
      });

      if (providerCallCount === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                reasoning_content: "Capture the image.",
                tool_calls: [openAiToolCall("call_image", "image_tool")],
              },
            },
          ],
        });
      }

      return openAiStreamResponse([
        {
          choices: [
            {
              delta: {
                content: "Image captured.",
              },
            },
          ],
        },
      ]);
    }) as typeof fetch;

    const response = await handleChatRoute(
      new Request("http://truss.test/api/chat", {
        body: JSON.stringify({
          messages: [{ content: "Capture an image.", role: "user" }],
          sessionId: testSession.id,
          tools: {
            loadWebpageEnabled: true,
            webSearchEnabled: true,
          },
          type: "agentic",
        }),
        method: "POST",
      }),
      testContext({
        callTool: async () => rawImageResult,
        resolveTool: (name) => (name === "image_tool" ? binding : null),
        toolDefinitions,
      }),
    );

    const events = parseStreamEvents(await response.text());
    const toolEvents = events.filter(
      (event): event is Extract<ChatStreamEvent, { type: "tool_call" }> =>
        event.type === "tool_call",
    );
    const completedCall = toolEvents.at(-1)?.call;
    const done = events.find(
      (event): event is Extract<ChatStreamEvent, { type: "done" }> =>
        event.type === "done",
    );
    const modelObservation = requestBodies[1]?.messages?.at(-1)?.content;

    expect(response.status).toBe(200);
    expect(providerCallCount).toBe(2);
    expect(modelObservation).toContain("[truncated: tool result exceeded 80000 characters]");
    expect(modelObservation).not.toBe(rawImageResult);
    expect(completedCall?.result).toContain(
      "[truncated: tool result exceeded 80000 characters]",
    );
    expect(completedCall?.imageResult).toEqual({
      contentType: "image/jpeg",
      data: fullImageBase64,
    });
    expect(done?.message.content).toBe("Image captured.");
    expect(done?.thinking?.toolCalls?.[0]?.imageResult).toEqual({
      contentType: "image/jpeg",
      data: fullImageBase64,
    });
  });

  it("streams command-runner guard assessments on completed tool calls", async () => {
    const workingDirectory = await realpath(process.cwd());
    const binding: McpToolBinding = {
      definition: commandRunnerToolDefinitions.run_command,
      serverId: "truss-command-runner",
      serverName: trussCommandRunnerServerName,
      toolName: "run_command",
    };
    const requestBodies: Array<{
      messages?: Array<{ content?: string; role?: string }>;
      stream?: boolean;
    }> = [];

    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ content?: string; role?: string }>;
        stream?: boolean;
      };
      const systemMessage = body.messages?.[0]?.content ?? "";
      requestBodies.push(body);

      if (systemMessage.includes("pre-execution security guard")) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  accesses_outside_whitelist: false,
                  command_tldr: "Print the Bun version.",
                  safety_level: "safe",
                  safety_reasoning: "The command only reads local tool version output.",
                }),
              },
            },
          ],
        });
      }

      if (systemMessage.includes("post-execution output guard")) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  deny_output: true,
                  output_tldr: "Version output was withheld for review.",
                  safety_level: "dangerous",
                  safety_reasoning: "The guard decided the command output should not be returned.",
                }),
              },
            },
          ],
        });
      }

      if (body.stream) {
        return openAiStreamResponse([
          {
            choices: [
              {
                delta: {
                  content: "Command completed with guard details.",
                },
              },
            ],
          },
        ]);
      }

      return jsonResponse({
        choices: [
          {
            message: {
              content: "",
              reasoning_content: "Check the local command.",
              tool_calls: [
                openAiToolCall("call_command", "run_command", {
                  command: "bun --version",
                  timeoutSeconds: 30,
                  workingDirectory,
                }),
              ],
            },
          },
        ],
      });
    }) as typeof fetch;

    const response = await handleChatRoute(
      new Request("http://truss.test/api/chat", {
        body: JSON.stringify({
          messages: [{ content: "Check Bun.", role: "user" }],
          sessionId: testSession.id,
          tools: {
            loadWebpageEnabled: true,
            webSearchEnabled: true,
          },
          type: "agentic",
        }),
        method: "POST",
      }),
      testContext({
        callTool: async () => "unused",
        conversationWorkspacePath: workingDirectory,
        resolveTool: (name) => (name === "run_command" ? binding : null),
        toolDefinitions: [commandRunnerToolDefinitions.run_command],
      }),
    );

    const events = parseStreamEvents(await response.text());
    const toolEvents = events.filter(
      (event): event is Extract<ChatStreamEvent, { type: "tool_call" }> =>
        event.type === "tool_call",
    );
    const completedCall = toolEvents.at(-1)?.call;
    const done = events.find(
      (event): event is Extract<ChatStreamEvent, { type: "done" }> =>
        event.type === "done",
    );

    expect(response.status).toBe(200);
    expect(requestBodies).toHaveLength(4);
    expect(completedCall?.result).toContain(
      "[Truss Command Runner output redacted by post-execution guard.]",
    );
    expect(completedCall?.security?.commandRunner?.preExecution).toMatchObject({
      enabled: true,
      model: {
        modelId: "demo-model",
        providerId: "openai-compatible",
        providerLabel: "OpenAI compatible",
      },
      verdict: {
        accessesOutsideWhitelist: false,
        safetyLevel: "safe",
        safetyReasoning: "The command only reads local tool version output.",
        tldr: "Print the Bun version.",
      },
    });
    expect(completedCall?.security?.commandRunner?.postExecution).toMatchObject({
      enabled: true,
      model: {
        modelId: "demo-model",
        providerId: "openai-compatible",
        providerLabel: "OpenAI compatible",
      },
      verdict: {
        denyOutput: true,
        safetyLevel: "dangerous",
        safetyReasoning: "The guard decided the command output should not be returned.",
        tldr: "Version output was withheld for review.",
      },
    });
    expect(done?.thinking?.toolCalls?.[0]?.security).toEqual(completedCall?.security);
  });

  it("executes recovered text tool calls instead of surfacing marker syntax", async () => {
    const definition = {
      description: "First test tool",
      name: "first_tool",
      parameters: { type: "object", properties: {} },
    };
    const toolDefinitions = [definition];
    const binding: McpToolBinding = {
      definition,
      serverId: "demo-server",
      serverName: "Demo Server",
      toolName: "first_tool",
    };
    let providerCallCount = 0;
    const observedArgs: Record<string, unknown>[] = [];

    globalThis.fetch = (async () => {
      providerCallCount += 1;

      if (providerCallCount === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                content:
                  'I need the tool.<tool_calls_section_begin><tool_call_begin>functions.first_tool:1<tool_call_argument_begin>{"path":"src"}<tool_call_end><tool_calls_section_end>',
              },
            },
          ],
        });
      }

      return openAiStreamResponse([
        {
          choices: [
            {
              delta: {
                content: "Recovered tool ran.",
              },
            },
          ],
        },
      ]);
    }) as unknown as typeof fetch;

    const response = await handleChatRoute(
      new Request("http://truss.test/api/chat", {
        body: JSON.stringify({
          messages: [{ content: "Use a tool.", role: "user" }],
          sessionId: testSession.id,
          tools: {
            loadWebpageEnabled: true,
            webSearchEnabled: true,
          },
          type: "agentic",
        }),
        method: "POST",
      }),
      testContext({
        callTool: async ({ args }) => {
          observedArgs.push(args);

          return "tool result";
        },
        resolveTool: (name) => (name === "first_tool" ? binding : null),
        toolDefinitions,
      }),
    );

    const events = parseStreamEvents(await response.text());
    const done = events.find(
      (event): event is Extract<ChatStreamEvent, { type: "done" }> =>
        event.type === "done",
    );
    const toolEvents = events.filter((event) => event.type === "tool_call");

    expect(response.status).toBe(200);
    expect(providerCallCount).toBe(2);
    expect(observedArgs).toEqual([{ path: "src" }]);
    expect(toolEvents).toHaveLength(2);
    expect(done?.message.content).toBe("Recovered tool ran.");
    expect(done?.message.content).not.toContain("<tool_call_begin>");
  });
});

function testContext({
  callTool,
  conversationWorkspacePath = testSession.workspacePath ?? "C:\\repo\\workspace",
  createdMessages,
  filesystemGrantDirectories = [],
  publishedEvents,
  resolveTool,
  session = testSession,
  toolDefinitions,
}: {
  callTool(input: {
    args: Record<string, unknown>;
    binding: McpToolBinding;
    meta?: Record<string, unknown>;
    onProgress?: (progress: ChatToolCallProgress) => void;
    signal?: AbortSignal;
  }): Promise<string>;
  conversationWorkspacePath?: string;
  createdMessages?: Array<{ content: string; role: "assistant"; thinking?: unknown }>;
  filesystemGrantDirectories?: string[];
  publishedEvents?: unknown[];
  resolveTool(name: string): McpToolBinding | null;
  session?: AgentSessionSummary;
  toolDefinitions: Array<{
    description: string;
    name: string;
    parameters: Record<string, unknown>;
  }>;
}): ServerContext {
  return {
    agentSessions: {
      getAgentSession: (id: string) => (id === session.id ? session : null),
    },
    chatMessages: {
      createChatMessage: (message: {
        content: string;
        id: string;
        role: "assistant";
        thinking?: unknown;
      }) => {
        const created = {
          attachments: [],
          content: message.content,
          createdAt: "2026-06-25T00:00:01.000Z",
          id: message.id,
          role: message.role,
          thinking: message.thinking,
        };

        createdMessages?.push({
          content: created.content,
          role: created.role,
          thinking: created.thinking,
        });

        return created;
      },
      listSessionMessages: () => [],
      syncSessionMessages: () => undefined,
    },
    chatUserChoices: {
      waitForChoice: async () => ({
        cancelled: false,
        question: "",
        selectedOption: {
          id: "allow-command-once",
          index: 0,
          label: "Allow once",
          value: "allow",
        },
        selectionType: "option",
      }),
    },
    commandExecutions: new CommandExecutionRegistry(),
    commandTerminals: {
      addGuardVerdict: () => undefined,
      kill: () => {
        throw new Error("No test terminal exists.");
      },
      list: () => [],
      spawn: async () => {
        throw new Error("Terminal spawning is not available in this test context.");
      },
      write: async () => {
        throw new Error("Terminal writing is not available in this test context.");
      },
    },
    commandWhitelist: {
      matchingEntry: () => null,
    },
    filesystemGrants: {
      listGrantsForContext: () =>
        filesystemGrantDirectories.map((directoryPath, index) => ({
          directoryPath,
          expiresAt: "2026-06-26T00:00:00.000Z",
          grantedAt: "2026-06-25T00:00:00.000Z",
          grantSource: "user-dialog",
          id: index + 1,
          readOnly: false,
          workspacePath: conversationWorkspacePath,
        })),
    },
    getLlmProviders: () => [testProvider],
    getModelProfiles: () => [],
    historySettings: {
      getHistorySettings: () => ({
        includeThinkingHistory: false,
        includeToolHistory: false,
        limitReasoningBudget: false,
        maxReasoningTimeSeconds: 300,
        maxReasoningWords: 10_000,
        thinkingHistoryAvailable: true,
        toolHistoryAvailable: true,
      }),
    },
    mcp: {
      callTool,
      getToolDefinitions: () => toolDefinitions,
      resolveTool,
    },
    mcpSettings: {
      getMcpSettings: () => ({
        commandRunner: {
          dangerousAction: "ask",
          guardModelId: null,
          guardProviderId: null,
          postExecutionGuardEnabled: true,
          preExecutionGuardEnabled: true,
          riskyAction: "ask",
          safeAction: "auto-allow",
        },
        playwrightMcp: {
          enabled: true,
          tools: "all",
        },
        sanitizerModelId: null,
        sanitizerProviderId: null,
      }),
    },
    hub: {
      publish: (event: unknown) => {
        publishedEvents?.push(event);
      },
    },
    options: {
      conversationWorkspacePath,
      workspacePath: conversationWorkspacePath,
    },
    richFeatures: {
      getRichFeatureSettings: () => disabledRichFeatures,
    },
    secretEnv: {
      mergedWithProcessEnv: () => ({}),
    },
    setup: {
      getSetup: () => emptySetup,
    },
    systemPrompts: {
      getSystemPrompt: () => ({ mode: "agentic", template: "Base prompt." }),
    },
  } as unknown as ServerContext;
}

function openAiToolCall(
  id: string,
  name: string,
  args: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    function: {
      arguments: JSON.stringify(args),
      name,
    },
    id,
    type: "function",
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
    status: 200,
  });
}

function openAiStreamResponse(chunks: unknown[]): Response {
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
    },
    status: 200,
  });
}

function parseStreamEvents(text: string): ChatStreamEvent[] {
  return text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChatStreamEvent);
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

const baseParameters: LlmGenerationParameters = {
  contextSize: null,
  temperature: null,
  topK: null,
  topP: null,
};

const testSession: AgentSessionSummary = {
  createdAt: "2026-06-25T00:00:00.000Z",
  id: "session-test",
  messageCount: 1,
  modelId: "demo-model",
  parameters: baseParameters,
  parentSessionId: null,
  providerId: "openai-compatible",
  title: "Existing title",
  type: "agentic",
  updatedAt: "2026-06-25T00:00:00.000Z",
  wordCount: 0,
  workspacePath: "C:\\repo\\workspace",
};

const testProvider: LlmProviderSummary = {
  baseUrl: "http://provider.test/v1",
  baseUrlSource: "default",
  configured: true,
  credentialEnvVars: [],
  credentialRequired: false,
  enabled: true,
  id: "openai-compatible",
  kind: "custom",
  label: "OpenAI compatible",
  models: ["demo-model"],
  secrets: [],
};

const emptySetup = {
  completed: true,
  location: null,
  modelCatalogUrl: null,
  nickname: null,
  preferredLanguage: null,
};

const disabledRichFeatures: RichFeatureSettingsSummary = {
  agenticToolTurnLimit: 300,
  agenticToolTurnLimitEnabled: true,
  calloutsEnabled: false,
  cardsEnabled: false,
  followUpsEnabled: false,
  katexEnabled: false,
  plantUmlEnabled: false,
  plantUmlFormat: "svg",
  plantUmlPrompt: "",
  plantUmlServerUrl: "",
  smartEventsEnabled: false,
  smartEventsGoogleCalendarEnabled: false,
  smartEventsIcsEnabled: false,
  smartEventsOutlookCalendarEnabled: false,
  smartTablesEnabled: false,
  timelinesEnabled: false,
};
