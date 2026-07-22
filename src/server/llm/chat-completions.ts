import type {
  ChatThinking,
  ChatCompletionMetrics,
  LlmGenerationParameters,
  LlmProviderSummary,
} from "../../shared/protocol.ts";
import {
  type ProviderChatMessage,
  type ProviderToolCall,
  ollamaOptions,
  openAiCompatiblePayload,
  toOllamaMessages,
} from "./chat-payloads.ts";
import {
  fetchWithTimeout,
  providerErrorMessage,
  readErrorBody,
  readResponseLines,
} from "./http-stream.ts";
import {
  createReasoningBudgetMonitor,
  ReasoningBudgetExceededError,
} from "./reasoning-budget.ts";
import type { ReasoningBudgetLimit } from "./reasoning-budget.ts";
import {
  ThinkBlockParser,
  thinkingFromLiveText,
  thinkingFromOllamaResponse,
  thinkingFromOpenAiCompatibleResponse,
  thinkingFromText,
  splitThinkBlocksFromText,
} from "./thinking.ts";
import { recoverTextToolCalls } from "./tool-call-recovery.ts";
import { errorForLog, logToStdout, truncateForLog } from "../utils/logging.ts";

export { ReasoningBudgetExceededError } from "./reasoning-budget.ts";
export type { ReasoningBudgetLimit } from "./reasoning-budget.ts";

export interface ChatCompletionResult {
  content: string;
  metrics?: ChatCompletionMetrics | null;
  status?: "error" | null;
  thinking: ChatThinking | null;
}

export interface LlmToolDefinition {
  description: string;
  name: string;
  parameters: Record<string, unknown>;
}

export interface ChatCompletionToolResult extends ChatCompletionResult {
  toolCalls: ProviderToolCall[];
}

export interface ChatCompletionStreamHandlers {
  onContentDelta(delta: string): void;
  onThinkingDelta(delta: string, thinking: ChatThinking): void;
}

export async function generateChatCompletion({
  apiKey,
  messages,
  modelId,
  parameters,
  provider,
  signal,
}: {
  apiKey?: string;
  messages: ProviderChatMessage[];
  modelId: string;
  parameters: LlmGenerationParameters;
  provider: LlmProviderSummary;
  signal?: AbortSignal;
}): Promise<string> {
  const result = await generateChatCompletionResult({
    apiKey,
    messages,
    modelId,
    parameters,
    provider,
    signal,
  });

  return result.content;
}

export async function generateChatCompletionResult({
  apiKey,
  messages,
  modelId,
  parameters,
  provider,
  signal,
}: {
  apiKey?: string;
  messages: ProviderChatMessage[];
  modelId: string;
  parameters: LlmGenerationParameters;
  provider: LlmProviderSummary;
  signal?: AbortSignal;
}): Promise<ChatCompletionResult> {
  if (provider.id === "ollama") {
    return generateOllamaChatCompletion({
      messages,
      modelId,
      parameters,
      provider,
      signal,
    });
  }

  return generateOpenAiCompatibleChatCompletion({
    apiKey,
    messages,
    modelId,
    parameters,
    provider,
    signal,
  });
}

export async function generateChatCompletionWithTools({
  apiKey,
  disableReasoning = false,
  messages,
  modelId,
  onContentDelta,
  parameters,
  provider,
  signal,
  stream = false,
  tools,
}: {
  apiKey?: string;
  disableReasoning?: boolean;
  messages: ProviderChatMessage[];
  modelId: string;
  onContentDelta?: (delta: string) => void;
  parameters: LlmGenerationParameters;
  provider: LlmProviderSummary;
  signal?: AbortSignal;
  stream?: boolean;
  tools: LlmToolDefinition[];
}): Promise<ChatCompletionToolResult> {
  if (provider.id === "ollama") {
    if (stream) {
      return streamOllamaChatCompletionWithTools({
        disableReasoning,
        messages,
        modelId,
        onContentDelta: onContentDelta ?? (() => undefined),
        parameters,
        provider,
        signal,
        tools,
      });
    }

    return generateOllamaChatCompletionWithTools({
      disableReasoning,
      messages,
      modelId,
      parameters,
      provider,
      signal,
      tools,
    });
  }

  if (stream) {
    return streamOpenAiCompatibleChatCompletionWithTools({
      apiKey,
      disableReasoning,
      messages,
      modelId,
      onContentDelta: onContentDelta ?? (() => undefined),
      parameters,
      provider,
      signal,
      tools,
    });
  }

  return generateOpenAiCompatibleChatCompletionWithTools({
    apiKey,
    disableReasoning,
    messages,
    modelId,
    parameters,
    provider,
    signal,
    tools,
  });
}

export async function streamChatCompletion({
  apiKey,
  disableReasoning = false,
  messages,
  modelId,
  onContentDelta,
  onThinkingDelta,
  parameters,
  provider,
  reasoningBudget = null,
  signal,
}: {
  apiKey?: string;
  disableReasoning?: boolean;
  messages: ProviderChatMessage[];
  modelId: string;
  parameters: LlmGenerationParameters;
  provider: LlmProviderSummary;
  reasoningBudget?: ReasoningBudgetLimit | null;
  signal?: AbortSignal;
} & ChatCompletionStreamHandlers): Promise<ChatCompletionResult> {
  if (provider.id === "ollama") {
    return streamOllamaChatCompletion({
      disableReasoning,
      messages,
      modelId,
      onContentDelta,
      onThinkingDelta,
      parameters,
      provider,
      reasoningBudget,
      signal,
    });
  }

  return streamOpenAiCompatibleChatCompletion({
    apiKey,
    disableReasoning,
    messages,
    modelId,
    onContentDelta,
    onThinkingDelta,
    parameters,
    provider,
    reasoningBudget,
    signal,
  });
}

async function streamOpenAiCompatibleChatCompletion({
  apiKey,
  disableReasoning,
  messages,
  modelId,
  onContentDelta,
  onThinkingDelta,
  parameters,
  provider,
  reasoningBudget,
  signal,
}: {
  apiKey?: string;
  disableReasoning: boolean;
  messages: ProviderChatMessage[];
  modelId: string;
  parameters: LlmGenerationParameters;
  provider: LlmProviderSummary;
  reasoningBudget: ReasoningBudgetLimit | null;
  signal?: AbortSignal;
} & ChatCompletionStreamHandlers): Promise<ChatCompletionResult> {
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const payload = openAiCompatiblePayload({
    disableReasoning,
    messages,
    modelId,
    parameters,
    providerId: provider.id,
    stream: true,
  });
  const startedAt = Date.now();
  let content = "";
  let thinkingContent = "";
  let thinkingStartedAt: number | null = null;
  let streamUsage: OpenAiUsage | null = null;
  const fetchController = new AbortController();
  const budgetMonitor = createReasoningBudgetMonitor(reasoningBudget, () => fetchController.abort());
  const thinkBlockParser = provider.id === "openai" ? null : new ThinkBlockParser();

  const appendContent = (delta: string) => {
    if (!delta) {
      return;
    }

    content += delta;
    onContentDelta(delta);
  };

  const startThinking = () => {
    if (thinkingStartedAt !== null) {
      return;
    }

    thinkingStartedAt = Date.now();
    budgetMonitor.start();
  };

  const appendThinking = (delta: string, forceStart = false) => {
    if (disableReasoning) {
      return;
    }

    if (forceStart) {
      startThinking();
    }

    if (!delta) {
      return;
    }

    startThinking();
    thinkingContent += delta;

    const thinking = thinkingFromLiveText(thinkingContent, thinkingStartedAt ?? Date.now());
    budgetMonitor.check(thinking);
    onThinkingDelta(delta, thinking);
  };

  try {
    const response = await fetchWithTimeout(
      `${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      },
      { controller: fetchController, signal },
    );

    if (!response.ok) {
      throw new Error(providerErrorMessage(await readErrorBody(response), response));
    }

    if (!response.body) {
      throw new Error("The provider did not return a streaming response.");
    }

    try {
      for await (const line of readResponseLines(response.body)) {
        const trimmed = line.trim();

        if (!trimmed || !trimmed.startsWith("data:")) {
          continue;
        }

        const data = trimmed.slice("data:".length).trim();

        if (data === "[DONE]") {
          break;
        }

        const chunk = parseProviderStreamChunk<OpenAiChatCompletionStreamChunk>(data, {
          modelId,
          providerId: provider.id,
          transport: "openai-compatible",
        });

        if (chunk.usage) {
          streamUsage = chunk.usage;
        }

        const delta = chunk.choices?.[0]?.delta;
        const contentDelta = firstString(delta?.content);
        const thinkingDelta = firstString(
          delta?.reasoning_content,
          delta?.reasoning,
          delta?.thinking,
        );

        if (thinkingDelta) {
          appendThinking(thinkingDelta);
        }

        if (contentDelta) {
          if (thinkBlockParser) {
            const parsed = thinkBlockParser.push(contentDelta);

            appendThinking(parsed.thinking, parsed.thinkingStarted);
            appendContent(parsed.content);
          } else {
            appendContent(contentDelta);
          }
        }
      }
    } catch (caught) {
      if (budgetMonitor.exceeded) {
        throw new ReasoningBudgetExceededError(budgetMonitor.thinking);
      }

      throw caught;
    }

    if (thinkBlockParser) {
      const parsed = thinkBlockParser.flush();

      appendThinking(parsed.thinking, parsed.thinkingStarted);
      appendContent(parsed.content);
    }
  } finally {
    budgetMonitor.dispose();
  }

  if (!content.trim()) {
    throw new Error("The provider did not return a chat message.");
  }

  const endedAt = Date.now();

  return {
    content,
    metrics: metricsFromOpenAiUsage(streamUsage, startedAt, endedAt),
    thinking: thinkingFromText(thinkingContent, thinkingStartedAt ?? endedAt),
  };
}

async function streamOpenAiCompatibleChatCompletionWithTools({
  apiKey,
  disableReasoning,
  messages,
  modelId,
  onContentDelta,
  parameters,
  provider,
  signal,
  tools,
}: {
  apiKey?: string;
  disableReasoning: boolean;
  messages: ProviderChatMessage[];
  modelId: string;
  onContentDelta(delta: string): void;
  parameters: LlmGenerationParameters;
  provider: LlmProviderSummary;
  signal?: AbortSignal;
  tools: LlmToolDefinition[];
}): Promise<ChatCompletionToolResult> {
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const payload = openAiCompatiblePayload({
    disableReasoning,
    messages,
    modelId,
    parameters,
    providerId: provider.id,
    stream: true,
  });

  if (tools.length > 0) {
    payload.tools = tools.map(toOpenAiCompatibleTool);
    payload.tool_choice = "auto";
    payload.parallel_tool_calls = true;
  }

  const startedAt = Date.now();
  let content = "";
  let thinkingContent = "";
  let thinkingStartedAt: number | null = null;
  let streamUsage: OpenAiUsage | null = null;
  const thinkBlockParser = provider.id === "openai" ? null : new ThinkBlockParser();
  const toolCallParts = new Map<number, OpenAiStreamToolCallPart>();

  const appendContent = (delta: string) => {
    if (!delta) {
      return;
    }

    content += delta;
    onContentDelta(delta);
  };

  const startThinking = () => {
    if (thinkingStartedAt !== null) {
      return;
    }

    thinkingStartedAt = Date.now();
  };

  const appendThinking = (delta: string, forceStart = false) => {
    if (disableReasoning) {
      return;
    }

    if (forceStart) {
      startThinking();
    }

    if (!delta) {
      return;
    }

    startThinking();
    thinkingContent += delta;
  };

  const response = await fetchWithTimeout(
    `${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
    { signal },
  );

  if (!response.ok) {
    throw new Error(providerErrorMessage(await readErrorBody(response), response));
  }

  if (!response.body) {
    throw new Error("The provider did not return a streaming response.");
  }

  for await (const line of readResponseLines(response.body)) {
    const trimmed = line.trim();

    if (!trimmed || !trimmed.startsWith("data:")) {
      continue;
    }

    const data = trimmed.slice("data:".length).trim();

    if (data === "[DONE]") {
      break;
    }

    const chunk = parseProviderStreamChunk<OpenAiChatCompletionStreamChunk>(data, {
      modelId,
      providerId: provider.id,
      transport: "openai-compatible-tools",
    });

    if (chunk.usage) {
      streamUsage = chunk.usage;
    }

    const delta = chunk.choices?.[0]?.delta;
    const contentDelta = firstString(delta?.content);
    const thinkingDelta = firstString(
      delta?.reasoning_content,
      delta?.reasoning,
      delta?.thinking,
    );

    appendOpenAiStreamToolCallDeltas(delta?.tool_calls, toolCallParts);

    if (thinkingDelta) {
      appendThinking(thinkingDelta);
    }

    if (contentDelta) {
      if (thinkBlockParser) {
        const parsed = thinkBlockParser.push(contentDelta);

        appendThinking(parsed.thinking, parsed.thinkingStarted);
        appendContent(parsed.content);
      } else {
        appendContent(contentDelta);
      }
    }
  }

  if (thinkBlockParser) {
    const parsed = thinkBlockParser.flush();

    appendThinking(parsed.thinking, parsed.thinkingStarted);
    appendContent(parsed.content);
  }

  const parsedToolCalls = openAiStreamToolCallPartsToProviderToolCalls(toolCallParts);
  const recovered = parsedToolCalls.length
    ? { content, toolCalls: parsedToolCalls }
    : recoverTextToolCalls(content, tools);

  if (!recovered.content.trim() && recovered.toolCalls.length === 0) {
    throw new Error("The provider did not return a chat message or tool call.");
  }

  const endedAt = Date.now();

  return {
    content: recovered.content,
    metrics: metricsFromOpenAiUsage(streamUsage, startedAt, endedAt),
    thinking: thinkingFromText(thinkingContent, thinkingStartedAt ?? startedAt),
    toolCalls: recovered.toolCalls,
  };
}

async function streamOllamaChatCompletion({
  disableReasoning,
  messages,
  modelId,
  onContentDelta,
  onThinkingDelta,
  parameters,
  provider,
  reasoningBudget,
  signal,
}: {
  disableReasoning: boolean;
  messages: ProviderChatMessage[];
  modelId: string;
  parameters: LlmGenerationParameters;
  provider: LlmProviderSummary;
  reasoningBudget: ReasoningBudgetLimit | null;
  signal?: AbortSignal;
} & ChatCompletionStreamHandlers): Promise<ChatCompletionResult> {
  const options = ollamaOptions(parameters);
  let content = "";
  let thinkingContent = "";
  let thinkingStartedAt: number | null = null;
  const fetchController = new AbortController();
  const budgetMonitor = createReasoningBudgetMonitor(reasoningBudget, () => fetchController.abort());
  const thinkBlockParser = new ThinkBlockParser();

  const appendContent = (delta: string) => {
    if (!delta) {
      return;
    }

    content += delta;
    onContentDelta(delta);
  };

  const startThinking = () => {
    if (thinkingStartedAt !== null) {
      return;
    }

    thinkingStartedAt = Date.now();
    budgetMonitor.start();
  };

  const appendThinking = (delta: string, forceStart = false) => {
    if (disableReasoning) {
      return;
    }

    if (forceStart) {
      startThinking();
    }

    if (!delta) {
      return;
    }

    startThinking();
    thinkingContent += delta;

    const thinking = thinkingFromLiveText(thinkingContent, thinkingStartedAt ?? Date.now());
    budgetMonitor.check(thinking);
    onThinkingDelta(delta, thinking);
  };

  try {
    const response = await fetchWithTimeout(
      `${provider.baseUrl.replace(/\/+$/, "")}/api/chat`,
      {
        method: "POST",
        headers: {
          Accept: "application/x-ndjson",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
          messages: toOllamaMessages(messages),
          options,
          stream: true,
          ...(disableReasoning ? { think: false } : {}),
        }),
      },
      { controller: fetchController, signal },
    );

    if (!response.ok) {
      throw new Error(providerErrorMessage(await readErrorBody(response), response));
    }

    if (!response.body) {
      throw new Error("The provider did not return a streaming response.");
    }

    try {
      for await (const line of readResponseLines(response.body)) {
        const trimmed = line.trim();

        if (!trimmed) {
          continue;
        }

        const chunk = parseProviderStreamChunk<OllamaChatCompletionStreamChunk>(trimmed, {
          modelId,
          providerId: provider.id,
          transport: "ollama",
        });
        const contentDelta =
          typeof chunk.message?.content === "string" ? chunk.message.content : "";
        const thinkingDelta =
          typeof chunk.message?.thinking === "string" ? chunk.message.thinking : "";

        if (thinkingDelta) {
          appendThinking(thinkingDelta);
        }

        if (contentDelta) {
          const parsed = thinkBlockParser.push(contentDelta);

          appendThinking(parsed.thinking, parsed.thinkingStarted);
          appendContent(parsed.content);
        }
      }
    } catch (caught) {
      if (budgetMonitor.exceeded) {
        throw new ReasoningBudgetExceededError(budgetMonitor.thinking);
      }

      throw caught;
    }

    const parsed = thinkBlockParser.flush();

    appendThinking(parsed.thinking, parsed.thinkingStarted);
    appendContent(parsed.content);
  } finally {
    budgetMonitor.dispose();
  }

  if (!content.trim()) {
    throw new Error("The provider did not return a chat message.");
  }

  return {
    content,
    thinking: thinkingFromText(thinkingContent, thinkingStartedAt ?? Date.now()),
  };
}

async function streamOllamaChatCompletionWithTools({
  disableReasoning,
  messages,
  modelId,
  onContentDelta,
  parameters,
  provider,
  signal,
  tools,
}: {
  disableReasoning: boolean;
  messages: ProviderChatMessage[];
  modelId: string;
  onContentDelta(delta: string): void;
  parameters: LlmGenerationParameters;
  provider: LlmProviderSummary;
  signal?: AbortSignal;
  tools: LlmToolDefinition[];
}): Promise<ChatCompletionToolResult> {
  const options = ollamaOptions(parameters);
  const startedAt = Date.now();
  let content = "";
  let thinkingContent = "";
  let thinkingStartedAt: number | null = null;
  let toolCalls: ProviderToolCall[] = [];
  const thinkBlockParser = new ThinkBlockParser();

  const appendContent = (delta: string) => {
    if (!delta) {
      return;
    }

    content += delta;
    onContentDelta(delta);
  };

  const startThinking = () => {
    if (thinkingStartedAt !== null) {
      return;
    }

    thinkingStartedAt = Date.now();
  };

  const appendThinking = (delta: string, forceStart = false) => {
    if (disableReasoning) {
      return;
    }

    if (forceStart) {
      startThinking();
    }

    if (!delta) {
      return;
    }

    startThinking();
    thinkingContent += delta;
  };

  const response = await fetchWithTimeout(
    `${provider.baseUrl.replace(/\/+$/, "")}/api/chat`,
    {
      method: "POST",
      headers: {
        Accept: "application/x-ndjson",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: toOllamaMessages(messages),
        options,
        stream: true,
        ...(disableReasoning ? { think: false } : {}),
        ...(tools.length > 0 ? { tools: tools.map(toOpenAiCompatibleTool) } : {}),
      }),
    },
    { signal },
  );

  if (!response.ok) {
    throw new Error(providerErrorMessage(await readErrorBody(response), response));
  }

  if (!response.body) {
    throw new Error("The provider did not return a streaming response.");
  }

  for await (const line of readResponseLines(response.body)) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const chunk = parseProviderStreamChunk<OllamaChatCompletionStreamChunk>(trimmed, {
      modelId,
      providerId: provider.id,
      transport: "ollama-tools",
    });
    const contentDelta =
      typeof chunk.message?.content === "string" ? chunk.message.content : "";
    const thinkingDelta =
      typeof chunk.message?.thinking === "string" ? chunk.message.thinking : "";
    const parsedToolCalls = parseOllamaToolCalls(chunk.message?.tool_calls);

    if (parsedToolCalls.length > 0) {
      toolCalls = parsedToolCalls;
    }

    if (thinkingDelta) {
      appendThinking(thinkingDelta);
    }

    if (contentDelta) {
      const parsed = thinkBlockParser.push(contentDelta);

      appendThinking(parsed.thinking, parsed.thinkingStarted);
      appendContent(parsed.content);
    }
  }

  const parsed = thinkBlockParser.flush();

  appendThinking(parsed.thinking, parsed.thinkingStarted);
  appendContent(parsed.content);

  const recovered = toolCalls.length
    ? { content, toolCalls }
    : recoverTextToolCalls(content, tools);

  if (!recovered.content.trim() && recovered.toolCalls.length === 0) {
    throw new Error("The provider did not return a chat message or tool call.");
  }

  return {
    content: recovered.content,
    thinking: thinkingFromText(thinkingContent, thinkingStartedAt ?? startedAt),
    toolCalls: recovered.toolCalls,
  };
}

async function generateOpenAiCompatibleChatCompletion({
  apiKey,
  messages,
  modelId,
  parameters,
  provider,
  signal,
}: {
  apiKey?: string;
  messages: ProviderChatMessage[];
  modelId: string;
  parameters: LlmGenerationParameters;
  provider: LlmProviderSummary;
  signal?: AbortSignal;
}): Promise<ChatCompletionResult> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const payload = openAiCompatiblePayload({
    disableReasoning: false,
    messages,
    modelId,
    parameters,
    providerId: provider.id,
    stream: false,
  });
  const startedAt = Date.now();

  const response = await fetchWithTimeout(
    `${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
    { signal },
  );

  const body = await readProviderJson(response, {
    modelId,
    providerId: provider.id,
    transport: "openai-compatible",
  });

  if (!response.ok) {
    throw new Error(providerErrorMessage(body, response));
  }

  const rawContent = (body as OpenAiChatCompletionResponse).choices?.[0]?.message?.content;

  if (typeof rawContent !== "string") {
    throw new Error("The provider did not return a chat message.");
  }

  const { content, thinking } = responseContentAndThinking({
    content: rawContent,
    parseThinkBlocks: provider.id !== "openai",
    providerThinking: thinkingFromOpenAiCompatibleResponse(body, startedAt),
    startedAt,
  });

  if (!content.trim()) {
    throw new Error("The provider did not return a chat message.");
  }

  return {
    content,
    metrics: metricsFromOpenAiUsage((body as OpenAiChatCompletionResponse).usage, startedAt, Date.now()),
    thinking,
  };
}

async function generateOpenAiCompatibleChatCompletionWithTools({
  apiKey,
  disableReasoning,
  messages,
  modelId,
  parameters,
  provider,
  signal,
  tools,
}: {
  apiKey?: string;
  disableReasoning: boolean;
  messages: ProviderChatMessage[];
  modelId: string;
  parameters: LlmGenerationParameters;
  provider: LlmProviderSummary;
  signal?: AbortSignal;
  tools: LlmToolDefinition[];
}): Promise<ChatCompletionToolResult> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const payload = openAiCompatiblePayload({
    disableReasoning,
    messages,
    modelId,
    parameters,
    providerId: provider.id,
    stream: false,
  });

  if (tools.length > 0) {
    payload.tools = tools.map(toOpenAiCompatibleTool);
    payload.tool_choice = "auto";
    payload.parallel_tool_calls = true;
  }

  const startedAt = Date.now();
  const response = await fetchWithTimeout(
    `${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
    { signal },
  );
  const body = await readProviderJson(response, {
    modelId,
    providerId: provider.id,
    transport: "openai-compatible-tools",
  });

  if (!response.ok) {
    throw new Error(providerErrorMessage(body, response));
  }

  const message = (body as OpenAiChatCompletionResponse).choices?.[0]?.message;
  const rawContent = typeof message?.content === "string" ? message.content : "";
  const parsedToolCalls = parseOpenAiToolCalls(message?.tool_calls);
  const { content, thinking } = responseContentAndThinking({
    content: rawContent,
    parseThinkBlocks: provider.id !== "openai",
    providerThinking: thinkingFromOpenAiCompatibleResponse(body, startedAt),
    startedAt,
  });
  const recovered = parsedToolCalls.length
    ? { content, toolCalls: parsedToolCalls }
    : recoverTextToolCalls(content, tools);

  if (!recovered.content.trim() && recovered.toolCalls.length === 0) {
    throw new Error("The provider did not return a chat message or tool call.");
  }

  return {
    content: recovered.content,
    metrics: metricsFromOpenAiUsage((body as OpenAiChatCompletionResponse).usage, startedAt, Date.now()),
    thinking,
    toolCalls: recovered.toolCalls,
  };
}

async function generateOllamaChatCompletion({
  messages,
  modelId,
  parameters,
  provider,
  signal,
}: {
  messages: ProviderChatMessage[];
  modelId: string;
  parameters: LlmGenerationParameters;
  provider: LlmProviderSummary;
  signal?: AbortSignal;
}): Promise<ChatCompletionResult> {
  const options = ollamaOptions(parameters);
  const startedAt = Date.now();

  const response = await fetchWithTimeout(
    `${provider.baseUrl.replace(/\/+$/, "")}/api/chat`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: toOllamaMessages(messages),
        options,
        stream: false,
      }),
    },
    { signal },
  );
  const body = await readProviderJson(response, {
    modelId,
    providerId: provider.id,
    transport: "ollama",
  });

  if (!response.ok) {
    throw new Error(providerErrorMessage(body, response));
  }

  const rawContent = (body as OllamaChatCompletionResponse).message?.content;

  if (typeof rawContent !== "string") {
    throw new Error("The provider did not return a chat message.");
  }

  const { content, thinking } = responseContentAndThinking({
    content: rawContent,
    parseThinkBlocks: true,
    providerThinking: thinkingFromOllamaResponse(body, startedAt),
    startedAt,
  });

  if (!content.trim()) {
    throw new Error("The provider did not return a chat message.");
  }

  return {
    content,
    thinking,
  };
}

async function generateOllamaChatCompletionWithTools({
  disableReasoning,
  messages,
  modelId,
  parameters,
  provider,
  signal,
  tools,
}: {
  disableReasoning: boolean;
  messages: ProviderChatMessage[];
  modelId: string;
  parameters: LlmGenerationParameters;
  provider: LlmProviderSummary;
  signal?: AbortSignal;
  tools: LlmToolDefinition[];
}): Promise<ChatCompletionToolResult> {
  const options = ollamaOptions(parameters);
  const startedAt = Date.now();

  const response = await fetchWithTimeout(
    `${provider.baseUrl.replace(/\/+$/, "")}/api/chat`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: toOllamaMessages(messages),
        options,
        stream: false,
        ...(disableReasoning ? { think: false } : {}),
        ...(tools.length > 0 ? { tools: tools.map(toOpenAiCompatibleTool) } : {}),
      }),
    },
    { signal },
  );
  const body = await readProviderJson(response, {
    modelId,
    providerId: provider.id,
    transport: "ollama-tools",
  });

  if (!response.ok) {
    throw new Error(providerErrorMessage(body, response));
  }

  const message = (body as OllamaChatCompletionResponse).message;
  const rawContent = typeof message?.content === "string" ? message.content : "";
  const parsedToolCalls = parseOllamaToolCalls(message?.tool_calls);
  const { content, thinking } = responseContentAndThinking({
    content: rawContent,
    parseThinkBlocks: true,
    providerThinking: thinkingFromOllamaResponse(body, startedAt),
    startedAt,
  });
  const recovered = parsedToolCalls.length
    ? { content, toolCalls: parsedToolCalls }
    : recoverTextToolCalls(content, tools);

  if (!recovered.content.trim() && recovered.toolCalls.length === 0) {
    throw new Error("The provider did not return a chat message or tool call.");
  }

  return {
    content: recovered.content,
    thinking,
    toolCalls: recovered.toolCalls,
  };
}

interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
}

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
      reasoning?: unknown;
      reasoning_content?: unknown;
      thinking?: unknown;
      tool_calls?: unknown;
    };
  }>;
  usage?: OpenAiUsage;
}

interface OpenAiChatCompletionStreamChunk {
  choices?: Array<{
    delta?: {
      content?: unknown;
      reasoning?: unknown;
      reasoning_content?: unknown;
      thinking?: unknown;
      tool_calls?: unknown;
    };
  }>;
  usage?: OpenAiUsage;
}

interface OpenAiStreamToolCallPart {
  arguments: string;
  id?: string;
  name?: string;
}

interface OllamaChatCompletionResponse {
  message?: {
    content?: unknown;
    thinking?: unknown;
    tool_calls?: unknown;
  };
}

interface OllamaChatCompletionStreamChunk {
  message?: {
    content?: unknown;
    thinking?: unknown;
    tool_calls?: unknown;
  };
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function responseContentAndThinking({
  content,
  parseThinkBlocks,
  providerThinking,
  startedAt,
}: {
  content: string;
  parseThinkBlocks: boolean;
  providerThinking: ChatThinking | null;
  startedAt: number;
}): ChatCompletionResult {
  if (!parseThinkBlocks) {
    return { content, thinking: providerThinking };
  }

  const parsed = splitThinkBlocksFromText(content);
  const parsedThinking = thinkingFromText(parsed.thinking, startedAt);

  return {
    content: parsed.content,
    thinking: mergeConcurrentThinking(providerThinking, parsedThinking, startedAt),
  };
}

function mergeConcurrentThinking(
  first: ChatThinking | null,
  second: ChatThinking | null,
  startedAt: number,
): ChatThinking | null {
  if (!first || !second) {
    return first ?? second;
  }

  const content = [first.content.trim(), second.content.trim()].filter(Boolean).join("\n\n");
  const thinking = thinkingFromText(
    content,
    startedAt,
  ) ?? {
    content: "",
    durationMs: Math.max(0, Date.now() - startedAt),
    wordCount: 0,
  };
  const encryptedContent = second.encryptedContent ?? first.encryptedContent;

  return {
    ...thinking,
    ...(encryptedContent ? { encryptedContent } : {}),
  };
}

function metricsFromOpenAiUsage(
  usage: OpenAiUsage | null | undefined,
  startedAt: number,
  endedAt: number,
): ChatCompletionMetrics | null {
  if (!usage) {
    return null;
  }

  const promptTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
  const completionTokens =
    typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined;
  const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : undefined;
  const price = typeof usage.cost === "number" ? usage.cost : undefined;
  const elapsedSec = (endedAt - startedAt) / 1000;
  const completionSpeed =
    completionTokens !== undefined && elapsedSec > 0
      ? Math.round(completionTokens / elapsedSec)
      : undefined;

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined &&
    price === undefined
  ) {
    return null;
  }

  return {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(completionSpeed !== undefined ? { completionSpeed } : {}),
    ...(price !== undefined ? { price } : {}),
  };
}



async function readProviderJson(
  response: Response,
  context: ProviderParseContext,
): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (caught) {
    logToStdout("llm", "Failed to parse provider JSON response.", {
      ...context,
      error: errorForLog(caught),
      responseBody: truncateForLog(text),
      status: response.status,
      statusText: response.statusText,
    });
    throw new Error("The provider returned an invalid JSON response.");
  }
}

function parseProviderStreamChunk<T>(data: string, context: ProviderParseContext): T {
  try {
    return JSON.parse(data) as T;
  } catch (caught) {
    logToStdout("llm", "Failed to parse provider stream message.", {
      ...context,
      error: errorForLog(caught),
      message: truncateForLog(data),
    });
    throw new Error("The provider returned an invalid stream message.");
  }
}

function toOpenAiCompatibleTool(tool: LlmToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function appendOpenAiStreamToolCallDeltas(
  value: unknown,
  partsByIndex: Map<number, OpenAiStreamToolCallPart>,
): void {
  if (!Array.isArray(value)) {
    return;
  }

  value.forEach((item, fallbackIndex) => {
    if (!item || typeof item !== "object") {
      return;
    }

    const source = item as Record<string, unknown>;
    const index = typeof source.index === "number" ? source.index : fallbackIndex;
    const existing = partsByIndex.get(index) ?? { arguments: "" };
    const fn = source.function;

    if (typeof source.id === "string" && source.id.trim()) {
      existing.id = source.id.trim();
    }

    if (fn && typeof fn === "object") {
      const fnSource = fn as Record<string, unknown>;

      if (typeof fnSource.name === "string" && fnSource.name) {
        existing.name = `${existing.name ?? ""}${fnSource.name}`;
      }

      if (typeof fnSource.arguments === "string" && fnSource.arguments) {
        existing.arguments += fnSource.arguments;
      }
    }

    partsByIndex.set(index, existing);
  });
}

function openAiStreamToolCallPartsToProviderToolCalls(
  partsByIndex: Map<number, OpenAiStreamToolCallPart>,
): ProviderToolCall[] {
  return [...partsByIndex.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, part]) => {
      const name = part.name?.trim() ?? "";

      if (!name) {
        return null;
      }

      return {
        id: part.id?.trim() || `call_${index}`,
        name,
        arguments: parseToolArguments(part.arguments, {
          source: "openai-compatible",
          toolName: name,
        }),
      };
    })
    .filter((item): item is ProviderToolCall => Boolean(item));
}

function parseOpenAiToolCalls(value: unknown): ProviderToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const source = item as Record<string, unknown>;
      const fn = source.function;

      if (!fn || typeof fn !== "object") {
        return null;
      }

      const fnSource = fn as Record<string, unknown>;
      const name = typeof fnSource.name === "string" ? fnSource.name.trim() : "";
      const id = typeof source.id === "string" && source.id.trim() ? source.id.trim() : `call_${index}`;

      if (!name) {
        return null;
      }

      return {
        id,
        name,
        arguments: parseToolArguments(fnSource.arguments, {
          source: "openai-compatible",
          toolName: name,
        }),
      };
    })
    .filter((item): item is ProviderToolCall => Boolean(item));
}

function parseOllamaToolCalls(value: unknown): ProviderToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const source = item as Record<string, unknown>;
      const fn = source.function;

      if (!fn || typeof fn !== "object") {
        return null;
      }

      const fnSource = fn as Record<string, unknown>;
      const name = typeof fnSource.name === "string" ? fnSource.name.trim() : "";

      if (!name) {
        return null;
      }

      return {
        id: `call_${index}_${name}`,
        name,
        arguments: parseToolArguments(fnSource.arguments, {
          source: "ollama",
          toolName: name,
        }),
      };
    })
    .filter((item): item is ProviderToolCall => Boolean(item));
}

function parseToolArguments(
  value: unknown,
  context: {
    source: string;
    toolName: string;
  },
): Record<string, unknown> {
  if (!value) {
    return {};
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (caught) {
    logToStdout("llm", "Failed to parse provider tool-call arguments.", {
      ...context,
      arguments: truncateForLog(value),
      error: errorForLog(caught),
    });
    throw new Error(`The provider returned malformed arguments for ${context.toolName}.`);
  }

  logToStdout("llm", "Provider tool-call arguments were not a JSON object.", {
    ...context,
    arguments: truncateForLog(value),
  });
  throw new Error(`The provider returned invalid arguments for ${context.toolName}.`);
}
