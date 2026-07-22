import { afterEach, describe, expect, it } from "bun:test";
import type {
  ChatAttachment,
  LlmGenerationParameters,
  LlmProviderSummary,
} from "../../src/shared/protocol.ts";
import { generateChatCompletionWithTools } from "../../src/server/llm/chat-completions.ts";
import {
  ollamaOptions,
  openAiCompatiblePayload,
  toOllamaMessages,
} from "../../src/server/llm/chat-payloads.ts";

const baseParameters: LlmGenerationParameters = {
  contextSize: null,
  temperature: null,
  topK: null,
  topP: null,
};

const textAttachment: ChatAttachment = {
  dataUrl: "data:text/plain;base64,aGVsbG8=",
  id: "attachment-text",
  kind: "text",
  mimeType: "text/plain",
  name: "notes.txt",
  size: 15,
  text: "hello from file",
};

const imageAttachment: ChatAttachment = {
  dataUrl: "data:image/png;base64,abc123",
  id: "attachment-image",
  kind: "image",
  mimeType: "image/png",
  name: "chart.png",
  size: 3,
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("openAiCompatiblePayload", () => {
  it("converts attachments into multimodal OpenAI-compatible message content", () => {
    const payload = openAiCompatiblePayload({
      disableReasoning: false,
      messages: [
        {
          attachments: [textAttachment, imageAttachment],
          content: "Summarize it.",
          role: "user",
        },
      ],
      modelId: "demo-model",
      parameters: { ...baseParameters, temperature: 0.4 },
      providerId: "openai-compatible",
      stream: true,
    });

    const messages = payload.messages as Array<{
      content: Array<{ image_url?: { url: string }; text?: string; type: string }>;
      role: string;
    }>;

    expect(payload.temperature).toBe(0.4);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content[0]?.type).toBe("text");
    expect(messages[0]?.content[0]?.text).toContain("Attached file: notes.txt");
    expect(messages[0]?.content[0]?.text).toContain("hello from file");
    expect(messages[0]?.content[1]).toEqual({
      image_url: {
        url: "data:image/png;base64,abc123",
      },
      type: "image_url",
    });
  });

  it("applies provider-specific disabled reasoning payloads", () => {
    const openRouterPayload = openAiCompatiblePayload({
      disableReasoning: true,
      messages: [],
      modelId: "demo-model",
      parameters: baseParameters,
      providerId: "openrouter",
      stream: false,
    });
    const openAiPayload = openAiCompatiblePayload({
      disableReasoning: true,
      messages: [],
      modelId: "demo-model",
      parameters: baseParameters,
      providerId: "openai",
      stream: false,
    });
    const compatiblePayload = openAiCompatiblePayload({
      disableReasoning: true,
      messages: [],
      modelId: "demo-model",
      parameters: baseParameters,
      providerId: "llamacpp",
      stream: false,
    });

    expect(openRouterPayload.reasoning).toEqual({ effort: "none", exclude: true });
    expect(openAiPayload.reasoning).toBeUndefined();
    expect(compatiblePayload.reasoning_effort).toBe("none");
    expect(compatiblePayload.reasoning).toEqual({ effort: "none" });
  });

  it("sends OpenAI thinking history as encrypted content metadata", () => {
    const payload = openAiCompatiblePayload({
      disableReasoning: false,
      messages: [
        {
          content: "Final answer.",
          role: "assistant",
          thinkingHistory: {
            content: "visible chain",
            encryptedContent: "opaque-reasoning-state",
          },
        },
      ],
      modelId: "demo-model",
      parameters: baseParameters,
      providerId: "openai",
      stream: false,
    });

    const messages = payload.messages as Array<Record<string, unknown>>;

    expect(messages[0]).toEqual({
      content: "Final answer.",
      encrypted_content: "opaque-reasoning-state",
      role: "assistant",
    });
    expect(JSON.stringify(messages[0])).not.toContain("visible chain");
    expect(JSON.stringify(messages[0])).not.toContain("previous_assistant_thinking");
    expect(messages[0]?.thinkingHistory).toBeUndefined();
  });

  it("prefixes visible thinking history for non-OpenAI compatible providers", () => {
    const payload = openAiCompatiblePayload({
      disableReasoning: false,
      messages: [
        {
          content: "Final answer.",
          role: "assistant",
          thinkingHistory: {
            content: "visible chain",
            encryptedContent: "opaque-reasoning-state",
          },
        },
      ],
      modelId: "demo-model",
      parameters: baseParameters,
      providerId: "openai-compatible",
      stream: false,
    });

    const messages = payload.messages as Array<Record<string, unknown>>;

    expect(messages[0]).toEqual({
      content: "<thinking>\nvisible chain\n</thinking>\n\nFinal answer.",
      role: "assistant",
    });
    expect(JSON.stringify(messages[0])).not.toContain("previous_assistant_thinking");
    expect(messages[0]?.thinkingHistory).toBeUndefined();
  });
});

describe("generateChatCompletionWithTools", () => {
  it("enables parallel tool calls for OpenAI-compatible tool requests", async () => {
    let requestBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "done",
              },
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await generateChatCompletionWithTools({
      messages: [
        {
          content: "Use the tool.",
          role: "user",
        },
      ],
      modelId: "demo-model",
      parameters: baseParameters,
      provider: testProvider,
      tools: [
        {
          description: "Demo tool",
          name: "demo_tool",
          parameters: {
            type: "object",
            properties: {},
          },
        },
      ],
    });

    expect(result.content).toBe("done");
    expect(requestBody).not.toBeNull();
    const body = requestBody as unknown as Record<string, unknown>;

    expect(body.tool_choice).toBe("auto");
    expect(body.parallel_tool_calls).toBe(true);
  });

  it("recovers DSML text tool calls from OpenAI-compatible content", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: String.raw`< | | DSML | | tool_calls>< | | DSML | | invoke name="list_directory">< | | DSML | | parameter name="path" string="true">C:\repo\src</ | | DSML | | parameter></ | | DSML | | invoke>< | | DSML | | invoke name="read_text_file">< | | DSML | | parameter name="path" string="true">C:\repo\src\server.ts</ | | DSML | | parameter>< | | DSML | | parameter name="startLine" string="false">200</ | | DSML | | parameter></ | | DSML | | invoke></ | | DSML | | tool_calls>`,
              },
            },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const result = await generateChatCompletionWithTools({
      messages: [
        {
          content: "Inspect files.",
          role: "user",
        },
      ],
      modelId: "demo-model",
      parameters: baseParameters,
      provider: testProvider,
      tools: [
        {
          description: "List directory",
          name: "list_directory",
          parameters: { type: "object", properties: {} },
        },
        {
          description: "Read text file",
          name: "read_text_file",
          parameters: { type: "object", properties: {} },
        },
      ],
    });

    expect(result.content).toBe("");
    expect(result.toolCalls).toEqual([
      {
        arguments: {
          path: String.raw`C:\repo\src`,
        },
        id: "call_recovered_0_list_directory",
        name: "list_directory",
      },
      {
        arguments: {
          path: String.raw`C:\repo\src\server.ts`,
          startLine: 200,
        },
        id: "call_recovered_1_read_text_file",
        name: "read_text_file",
      },
    ]);
  });

  it("recovers streamed MiniMax-style text tool calls from OpenAI-compatible content", async () => {
    globalThis.fetch = (async () =>
      openAiStreamResponse([
        {
          choices: [
            {
              delta: {
                content:
                  '<tool_call>\n]<]minimax[>[<invoke name="web_search">]<]minimax[>[<query>lorem ipsum text]<]minimax[>[</query>]<]minimax[>[</invoke>\n]<]minimax[>[</tool_call>',
              },
            },
          ],
        },
      ])) as unknown as typeof fetch;

    const result = await generateChatCompletionWithTools({
      messages: [
        {
          content: "Search after a failed tool call.",
          role: "user",
        },
      ],
      modelId: "demo-model",
      parameters: baseParameters,
      provider: testProvider,
      stream: true,
      tools: [
        {
          description: "Search the web",
          name: "web_search",
          parameters: { type: "object", properties: {} },
        },
      ],
    });

    expect(result.content).toBe("");
    expect(result.toolCalls).toEqual([
      {
        arguments: {
          query: "lorem ipsum text",
        },
        id: "call_recovered_0_web_search",
        name: "web_search",
      },
    ]);
  });

  it("recovers Kimi-style text tool calls and resolves active MCP suffix names", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  'I will inspect it.<tool_calls_section_begin><tool_call_begin>functions.read_file:3<tool_call_argument_begin>{"path":"C:\\\\repo\\\\src\\\\server.ts"}<tool_call_end><tool_calls_section_end>',
              },
            },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const result = await generateChatCompletionWithTools({
      messages: [
        {
          content: "Read the file.",
          role: "user",
        },
      ],
      modelId: "demo-model",
      parameters: baseParameters,
      provider: testProvider,
      tools: [
        {
          description: "Read file",
          name: "mcp__filesystem__read_text_file",
          parameters: { type: "object", properties: {} },
        },
      ],
    });

    expect(result.content).toBe("I will inspect it.");
    expect(result.toolCalls).toEqual([
      {
        arguments: {
          path: String.raw`C:\repo\src\server.ts`,
        },
        id: "call_recovered_3",
        name: "mcp__filesystem__read_text_file",
      },
    ]);
  });

  it("streams OpenAI-compatible content deltas for tool-enabled completions", async () => {
    const deltas: string[] = [];
    const requestBodies: Record<string, unknown>[] = [];

    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);

      return openAiStreamResponse([
        {
          choices: [
            {
              delta: {
                content: "streamed",
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                content: " answer",
              },
            },
          ],
        },
      ]);
    }) as typeof fetch;

    const result = await generateChatCompletionWithTools({
      messages: [
        {
          content: "Summarize the tool result.",
          role: "user",
        },
      ],
      modelId: "demo-model",
      onContentDelta: (delta) => deltas.push(delta),
      parameters: baseParameters,
      provider: testProvider,
      stream: true,
      tools: [],
    });

    expect(result.content).toBe("streamed answer");
    expect(result.toolCalls).toEqual([]);
    expect(deltas).toEqual(["streamed", " answer"]);
    expect(requestBodies[0]?.stream).toBe(true);
  });

  it("parses streamed OpenAI-compatible tool-call deltas", async () => {
    globalThis.fetch = (async (_input, _init) =>
      openAiStreamResponse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    function: {
                      arguments: "{\"query\"",
                      name: "demo_tool",
                    },
                    id: "call_demo",
                    index: 0,
                    type: "function",
                  },
                ],
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
                      arguments: ":\"latest\"}",
                    },
                    index: 0,
                  },
                ],
              },
            },
          ],
        },
      ])) as typeof fetch;

    const result = await generateChatCompletionWithTools({
      messages: [
        {
          content: "Use the tool.",
          role: "user",
        },
      ],
      modelId: "demo-model",
      onContentDelta: () => undefined,
      parameters: baseParameters,
      provider: testProvider,
      stream: true,
      tools: [
        {
          description: "Demo tool",
          name: "demo_tool",
          parameters: {
            type: "object",
            properties: {},
          },
        },
      ],
    });

    expect(result.content).toBe("");
    expect(result.toolCalls).toEqual([
      {
        arguments: {
          query: "latest",
        },
        id: "call_demo",
        name: "demo_tool",
      },
    ]);
  });
});

describe("Ollama payload helpers", () => {
  it("maps generation parameters to Ollama option names", () => {
    expect(
      ollamaOptions({
        contextSize: 8192,
        temperature: 0.2,
        topK: 20,
        topP: 0.8,
      }),
    ).toEqual({
      num_ctx: 8192,
      temperature: 0.2,
      top_k: 20,
      top_p: 0.8,
    });
  });

  it("strips the data URL prefix from Ollama image inputs", () => {
    const messages = toOllamaMessages([
      {
        attachments: [imageAttachment],
        content: "Look at this chart.",
        role: "user",
      },
    ]) as Array<{ content: string; images?: string[]; role: string }>;

    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.images).toEqual(["abc123"]);
    expect(messages[0]?.content).toContain("model-visible image input");
  });

  it("omits the images field from Ollama payloads when there are no images", () => {
    const messages = toOllamaMessages([
      {
        attachments: [textAttachment],
        content: "Read these notes.",
        role: "user",
      },
    ]) as Array<{ content: string; images?: string[]; role: string }>;

    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.images).toBeUndefined();
  });

  it("prefixes visible thinking history for Ollama messages", () => {
    const messages = toOllamaMessages([
      {
        content: "Final answer.",
        role: "assistant",
        thinkingHistory: {
          content: "visible chain",
        },
      },
    ]) as Array<Record<string, unknown>>;

    expect(messages[0]?.content).toBe(
      "<thinking>\nvisible chain\n</thinking>\n\nFinal answer.",
    );
    expect(messages[0]?.thinkingHistory).toBeUndefined();
  });
});

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

function openAiStreamResponse(chunks: unknown[]): Response {
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
    },
    status: 200,
  });
}
