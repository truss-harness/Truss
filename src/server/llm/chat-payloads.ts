import type {
  ChatMessage,
  ChatAttachment,
  LlmGenerationParameters,
} from "../../shared/protocol.ts";

const maxDocumentDataUrlPromptLength = 120_000;

export interface ProviderToolCall {
  arguments: Record<string, unknown>;
  id: string;
  name: string;
}

export interface ProviderThinkingHistory {
  content?: string;
  encryptedContent?: string;
}

export type ProviderChatMessage =
  | (ChatMessage & {
      thinkingHistory?: ProviderThinkingHistory | null;
      toolCalls?: ProviderToolCall[];
    })
  | {
      content: string;
      role: "tool";
      toolCallId?: string;
      toolName?: string;
    };

export function openAiCompatiblePayload({
  disableReasoning,
  messages,
  modelId,
  parameters,
  providerId,
  stream,
}: {
  disableReasoning: boolean;
  messages: ProviderChatMessage[];
  modelId: string;
  parameters: LlmGenerationParameters;
  providerId: string;
  stream: boolean;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: modelId,
    messages: toOpenAiCompatibleMessages(messages, providerId, modelId),
    stream,
  };

  if (parameters.temperature !== null) {
    payload.temperature = parameters.temperature;
  }

  if (parameters.topP !== null) {
    payload.top_p = parameters.topP;
  }

  if (disableReasoning) {
    applyDisabledReasoningPayload(payload, providerId);
  }

  return payload;
}

export function ollamaOptions(parameters: LlmGenerationParameters): Record<string, number> {
  const options: Record<string, number> = {};

  if (parameters.temperature !== null) {
    options.temperature = parameters.temperature;
  }

  if (parameters.topP !== null) {
    options.top_p = parameters.topP;
  }

  if (parameters.topK !== null) {
    options.top_k = parameters.topK;
  }

  if (parameters.contextSize !== null) {
    options.num_ctx = parameters.contextSize;
  }

  return options;
}

export function toOllamaMessages(messages: ProviderChatMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        content: message.content,
      };
    }

    const images = message.attachments
      ?.filter((attachment) => attachment.kind === "image")
      .map((attachment) => dataUrlPayload(attachment.dataUrl));

    return {
      role: message.role,
      content: messageContentForProvider(messageWithAttachmentText(message), message, "ollama"),
      ...(images && images.length > 0 ? { images } : {}),
      tool_calls: message.toolCalls?.map((toolCall) => ({
        function: {
          arguments: toolCall.arguments,
          name: toolCall.name,
        },
      })),
    };
  });
}

function applyDisabledReasoningPayload(
  payload: Record<string, unknown>,
  providerId: string,
): void {
  if (providerId === "openrouter") {
    payload.reasoning = {
      effort: "none",
      exclude: true,
    };
    return;
  }

  if (providerId === "openai") {
    return;
  }

  payload.reasoning_effort = "none";
  payload.reasoning = {
    effort: "none",
  };
}

function toOpenAiCompatibleMessages(
  messages: ProviderChatMessage[],
  providerId: string,
  modelId?: string,
): unknown[] {
  const result: unknown[] = [];

  const isAnthropicViaOpenRouter = providerId === "openrouter" && modelId?.startsWith("anthropic/");

  for (const message of messages) {
    if (message.role === "tool") {
      result.push({
        role: "tool",
        tool_call_id: message.toolCallId,
        name: message.toolName,
        content: message.content,
      });
      continue;
    }

    const baseContent = messageWithAttachmentText(message);
    const encryptedContent = encryptedThinkingContentForProvider(message, providerId);
    const encryptedContentShape = encryptedContent
      ? { encrypted_content: encryptedContent }
      : {};

    // Anthropic models via OpenRouter do not allow prefilling the thinking phase.
    // Instead, emit the reasoning as a plain assistant message and follow it with
    // a hidden user message so the model can continue with a direct answer.
    if (
      isAnthropicViaOpenRouter &&
      message.role === "assistant" &&
      normalizedThinkingHistory(message)?.content
    ) {
      const thinkingContent = normalizedThinkingHistory(message)!.content!;
      const assistantText = baseContent.trim();

      result.push({
        role: "assistant",
        content: `here is my reasoning\n\n${thinkingContent}${assistantText ? `\n\n${assistantText}` : ""}`,
      });
      result.push({
        role: "user",
        content: "That is enough reasoning. Answer directly.",
      });
      continue;
    }

    const content = messageContentForProvider(baseContent, message, providerId);

    if (message.toolCalls?.length) {
      result.push({
        role: "assistant",
        content: content || null,
        ...encryptedContentShape,
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
          },
        })),
      });
      continue;
    }

    if (!message.attachments?.length) {
      result.push({
        role: message.role,
        content,
        ...encryptedContentShape,
      });
      continue;
    }

    const attachmentContent: unknown[] = [
      {
        type: "text",
        text: messageContentForProvider(baseContent, message, providerId),
      },
    ];

    for (const attachment of message.attachments) {
      if (attachment.kind === "image") {
        attachmentContent.push({
          type: "image_url",
          image_url: {
            url: attachment.dataUrl,
          },
        });
      }
    }

    result.push({
      role: message.role,
      content: attachmentContent,
      ...encryptedContentShape,
    });
  }

  // Anthropic via OpenRouter requires the last message to be from the user.
  // If the last message is an assistant message, append a hidden user message.
  if (isAnthropicViaOpenRouter) {
    const last = result[result.length - 1] as Record<string, unknown> | undefined;

    if (last?.role === "assistant") {
      result.push({
        role: "user",
        content: "Please continue.",
      });
    }
  }

  return result;
}

function messageContentForProvider(
  content: string,
  message: Extract<ProviderChatMessage, ChatMessage>,
  providerId: string,
): string {
  const history = normalizedThinkingHistory(message);

  if (!history?.content || providerId === "openai") {
    return content;
  }

  return [`<thinking>\n${history.content}\n</thinking>`, content.trim()]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function encryptedThinkingContentForProvider(
  message: Extract<ProviderChatMessage, ChatMessage>,
  providerId: string,
): string | null {
  if (providerId !== "openai") {
    return null;
  }

  return normalizedThinkingHistory(message)?.encryptedContent ?? null;
}

function normalizedThinkingHistory(
  message: Extract<ProviderChatMessage, ChatMessage>,
): ProviderThinkingHistory | null {
  if (message.role !== "assistant") {
    return null;
  }

  const content = message.thinkingHistory?.content?.trim();
  const encryptedContent = message.thinkingHistory?.encryptedContent?.trim();

  if (!content && !encryptedContent) {
    return null;
  }

  return {
    ...(content ? { content } : {}),
    ...(encryptedContent ? { encryptedContent } : {}),
  };
}

function messageWithAttachmentText(message: ChatMessage): string {
  if (!message.attachments?.length) {
    return message.content;
  }

  const attachmentText = message.attachments.map(attachmentPromptText).join("\n\n");
  return [attachmentText, message.content.trim()].filter(Boolean).join("\n\n").trim();
}

function attachmentPromptText(attachment: ChatAttachment): string {
  const header = `Attached file: ${attachment.name} (${attachment.mimeType || "unknown type"}, ${formatBytes(attachment.size)})`;
  const sourcePageText = attachment.sourcePage
    ? ` (page ${attachment.sourcePage}${
        attachment.sourcePageCount ? ` of ${attachment.sourcePageCount}` : ""
      })`
    : "";
  const sourceLine =
    attachment.sourceFormat || attachment.sourceName
      ? `Converted from ${attachment.sourceFormat || "document"} file${
          attachment.sourceName ? `: ${attachment.sourceName}` : ""
        }${sourcePageText}${attachment.conversionKind ? ` as ${attachment.conversionKind}` : ""}.`
      : null;
  const metadata = sourceLine ? `${header}\n${sourceLine}` : header;

  if (attachment.kind === "text" && attachment.text?.trim()) {
    return `${metadata}\n\n${attachment.text.trim()}`;
  }

  if (attachment.kind === "image") {
    return `${metadata}\nThe image is attached as model-visible image input when the selected provider supports images.`;
  }

  if (attachment.dataUrl.length <= maxDocumentDataUrlPromptLength) {
    return `${metadata}\nDocument data URL:\n${attachment.dataUrl}`;
  }

  return `${metadata}\nThe document is attached to the chat and available for download, but it is too large to inline into the model prompt without document extraction.`;
}

function dataUrlPayload(dataUrl: string): string {
  return dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
