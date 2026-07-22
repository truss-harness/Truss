import type {
  AgentSessionDetailResponse,
  AgentSessionSummary,
  ChatAttachment,
  ChatMessage,
  ChatToolCall,
  StoredChatMessage,
} from "../../../shared/protocol.ts";
import type { ChatUiMessage } from "./types.ts";

export function assistantMessageLabel(message: ChatUiMessage): string {
  const modelId = message.modelId?.trim();

  return modelId ? formatHumanReadableModelName(modelId) : "Assistant";
}

export function formatHumanReadableModelName(modelId: string): string {
  const lastSegment = modelId.split("/").filter(Boolean).at(-1) ?? modelId;
  const qualifierIndex = lastSegment.lastIndexOf(":");
  const rawName = qualifierIndex >= 0 ? lastSegment.slice(0, qualifierIndex) : lastSegment;
  const rawQualifier = qualifierIndex >= 0 ? lastSegment.slice(qualifierIndex + 1) : "";
  const modelName = rawName
    .replace(/\.(?:gguf|bin|safetensors)$/i, "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(formatModelNameToken)
    .join(" ");
  const qualifier = rawQualifier.trim() ? ` (${formatModelQualifier(rawQualifier)})` : "";

  return `${modelName || modelId}${qualifier}`;
}

export function storedMessageToUiMessage(
  message: StoredChatMessage,
  modelId: string,
): ChatUiMessage {
  return {
    attachments: message.attachments,
    content: message.content,
    createdAt: message.createdAt,
    id: message.id,
    modelId: message.role === "assistant" ? modelId : undefined,
    persisted: true,
    role: message.role,
    status: message.status || undefined,
    thinking: message.thinking,
    metrics: message.metrics,
  };
}

export function filterConversations(
  conversations: AgentSessionSummary[],
  query: string,
): AgentSessionSummary[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return conversations;
  }

  return conversations.filter((conversation) =>
    [
      conversation.title ?? "Untitled conversation",
      conversation.type,
      conversation.modelId,
      conversation.providerId,
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery),
  );
}

export function formatConversationDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatMessageTimestamp(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatCompactCount(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    notation: value >= 10_000 ? "compact" : "standard",
  }).format(value);
}

export function formatLabeledCount(value: number, singular: string): string {
  return `${formatCompactCount(value)} ${value === 1 ? singular : `${singular}s`}`;
}

export function upsertConversation(
  conversations: AgentSessionSummary[],
  nextConversation: AgentSessionSummary,
): AgentSessionSummary[] {
  const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]));

  byId.set(nextConversation.id, nextConversation);

  return [...byId.values()].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

export function formatMessageMarkdown(message: ChatUiMessage): string {
  const lines = [message.content.trim() || "_No message content._"];

  if (message.attachments?.length) {
    lines.push("", "Attachments:");

    for (const attachment of message.attachments) {
      lines.push(
        `- ${attachment.name} (${attachment.mimeType || "file"}, ${formatFileSize(
          attachment.size,
        )})`,
      );
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

export function messageInformationRows(
  message: ChatUiMessage,
): Array<{ label: string; value: string }> {
  const messageWords = countWords(message.content);
  const metrics = message.metrics;

  const formatTokens = (): string => {
    if (!metrics) return "Unavailable";
    if (metrics.totalTokens !== undefined) {
      const parts = [`${metrics.totalTokens} total`];
      if (metrics.promptTokens !== undefined) parts.push(`${metrics.promptTokens} prompt`);
      if (metrics.completionTokens !== undefined) parts.push(`${metrics.completionTokens} completion`);
      return parts.join(" · ");
    }
    if (metrics.promptTokens !== undefined || metrics.completionTokens !== undefined) {
      return [
        metrics.promptTokens !== undefined ? `${metrics.promptTokens} prompt` : null,
        metrics.completionTokens !== undefined ? `${metrics.completionTokens} completion` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    return "Unavailable";
  };

  const formatSpeed = (): string => {
    if (!metrics) return "Unavailable";
    if (metrics.completionSpeed !== undefined) return `${metrics.completionSpeed} tok/s`;
    return "Unavailable";
  };

  const formatPrice = (): string => {
    if (!metrics) return "Unavailable";
    if (metrics.price === undefined || metrics.price === null) return "Unavailable";
    if (metrics.price === "n/a") return "n/a";
    const num = typeof metrics.price === "number" ? metrics.price : parseFloat(String(metrics.price));
    if (isNaN(num)) return "Unavailable";
    if (num === 0) return "$0.00";
    if (num < 0.001) return `$${num.toFixed(6)}`;
    if (num < 0.01) return `$${num.toFixed(5)}`;
    return `$${num.toFixed(4)}`;
  };

  const rows = [
    {
      label: message.role === "user" ? "Sender" : "Model",
      value: message.role === "user" ? "You" : assistantMessageLabel(message),
    },
    { label: "Created", value: formatMessageTimestamp(message.createdAt) || "Unavailable" },
    { label: "Words", value: formatCompactCount(messageWords) },
    { label: "Tokens", value: formatTokens() },
    { label: "Speed", value: formatSpeed() },
    { label: "Price", value: formatPrice() },
  ];

  if (message.thinking) {
    rows.push(
      { label: "Thinking", value: formatThoughtDuration(messageThinkingDurationMs(message)) },
      { label: "Thought words", value: formatCompactCount(message.thinking.wordCount) },
    );
  }

  return rows;
}

export function messageThinkingDurationMs(message: ChatUiMessage): number {
  const durationMs = message.thinking?.durationMs ?? 0;

  if (
    message.role !== "assistant" ||
    message.status !== "error" ||
    !message.thinking?.toolCalls?.length
  ) {
    return durationMs;
  }

  return durationMs + toolCallWallClockDurationMs(message.thinking.toolCalls);
}

function toolCallWallClockDurationMs(toolCalls: ChatToolCall[]): number {
  const intervals = toolCalls
    .map((toolCall) => {
      if (!toolCall.completedAt) {
        return null;
      }

      const startedAt = new Date(toolCall.startedAt).getTime();
      const completedAt = new Date(toolCall.completedAt).getTime();

      if (
        !Number.isFinite(startedAt) ||
        !Number.isFinite(completedAt) ||
        completedAt < startedAt
      ) {
        return null;
      }

      return { completedAt, startedAt };
    })
    .filter((interval): interval is { completedAt: number; startedAt: number } =>
      Boolean(interval),
    )
    .sort((left, right) => left.startedAt - right.startedAt);

  let totalMs = 0;
  let activeStart: number | null = null;
  let activeEnd: number | null = null;

  for (const interval of intervals) {
    if (activeStart === null || activeEnd === null) {
      activeStart = interval.startedAt;
      activeEnd = interval.completedAt;
      continue;
    }

    if (interval.startedAt <= activeEnd) {
      activeEnd = Math.max(activeEnd, interval.completedAt);
      continue;
    }

    totalMs += activeEnd - activeStart;
    activeStart = interval.startedAt;
    activeEnd = interval.completedAt;
  }

  if (activeStart !== null && activeEnd !== null) {
    totalMs += activeEnd - activeStart;
  }

  return totalMs;
}

export async function copyTextToClipboard(value: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");

  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Clipboard copy was not available in this browser.");
    }
  } finally {
    textarea.remove();
  }
}

export function downloadTextFile(filename: string, mimeType: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadBinaryFile(filename: string, mimeType: string, data: ArrayBuffer): void {
  const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function formatConversationMarkdown(detail: AgentSessionDetailResponse): string {
  const title = detail.session.title ?? "Untitled conversation";
  const lines = [
    `# ${title}`,
    "",
    `Exported from Truss on ${new Date().toLocaleString()}.`,
    "",
    `Model: ${detail.session.modelId}`,
    "",
  ];

  for (const message of detail.messages) {
    lines.push(`## ${message.role === "user" ? "You" : "Assistant"}`, "");

    if (message.thinking?.content) {
      lines.push("### Thinking", "", message.thinking.content, "");
    }

    lines.push(message.content || "_No message content._", "");

    if (message.attachments?.length) {
      lines.push("Attachments:", "");

      for (const attachment of message.attachments) {
        lines.push(
          `- ${attachment.name} (${attachment.mimeType || "file"}, ${formatFileSize(
            attachment.size,
          )})`,
        );
      }

      lines.push("");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

export function formatConversationJson(detail: AgentSessionDetailResponse): string {
  return `${JSON.stringify(
    {
      model: detail.session.modelId,
      messages: [
        formatOpenAiMessage(detail.systemMessage),
        ...detail.messages.flatMap(formatOpenAiConversationMessages),
      ],
      tools: detail.tools,
      ...formatOpenAiParameters(detail.session.parameters),
    },
    null,
    2,
  )}\n`;
}

export function formatConversationHtml(detail: AgentSessionDetailResponse): string {
  const title = detail.session.title ?? "Untitled conversation";
  const messages = detail.messages
    .map((message) => {
      const speaker = message.role === "user" ? "You" : "Assistant";
      const thinking = message.thinking?.content
        ? `<details><summary>Thinking</summary><pre>${escapeHtml(
            message.thinking.content,
          )}</pre></details>`
        : "";
      const attachments = message.attachments?.length
        ? `<ul class="attachments">${message.attachments
            .map(
              (attachment) =>
                `<li>${escapeHtml(attachment.name)} (${escapeHtml(
                  attachment.mimeType || "file",
                )}, ${escapeHtml(formatFileSize(attachment.size))})</li>`,
            )
            .join("")}</ul>`
        : "";

      return `<article class="message ${message.role}">
  <h2>${escapeHtml(speaker)}</h2>
  ${thinking}
  <pre>${escapeHtml(message.content || "No message content.")}</pre>
  ${attachments}
</article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; background: #f8f7f2; color: #1f201d; font: 15px/1.6 ui-sans-serif, system-ui, sans-serif; }
    main { max-width: 840px; margin: 0 auto; padding: 40px 24px; }
    h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.2; }
    .meta { margin: 0 0 28px; color: #66685f; }
    .message { border: 1px solid #d9d6cc; background: #fffef9; margin: 16px 0; padding: 18px; }
    .message.user { background: #eff3dc; }
    h2 { margin: 0 0 10px; font-size: 12px; text-transform: uppercase; letter-spacing: 0; color: #66685f; }
    pre { margin: 0; white-space: pre-wrap; font: inherit; }
    details { margin: 0 0 14px; border: 1px solid #d9d6cc; padding: 10px 12px; background: #f8f7f2; }
    summary { cursor: pointer; font-weight: 700; }
    .attachments { margin: 14px 0 0; padding-left: 22px; color: #66685f; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p class="meta">Exported from Truss on ${escapeHtml(
      new Date().toLocaleString(),
    )}. Model: ${escapeHtml(detail.session.modelId)}</p>
    ${messages}
  </main>
</body>
</html>
`;
}

export function formatConversationAtif(detail: AgentSessionDetailResponse): string {
  const exportedAt = new Date().toISOString();

  return `${JSON.stringify(
    {
      schema_version: "ATIF-v1.7",
      session_id: detail.session.id,
      trajectory_id: `truss-session-${detail.session.id}`,
      agent: {
        name: "truss",
        version: "0.1.0",
        model_name: detail.session.modelId,
        extra: {
          provider_id: detail.session.providerId,
          session_type: detail.session.type,
          parameters: detail.session.parameters,
        },
      },
      steps: [
        formatAtifSystemStep(detail.systemMessage),
        ...detail.messages.map((message, index) =>
          formatAtifStep(message, index + 2, detail.session.modelId),
        ),
      ],
      final_metrics: {
        total_steps: detail.messages.length + 1,
      },
      extra: {
        export_type: "conversation",
        exported_at: exportedAt,
        source: "truss",
        session: serializeSessionForExport(detail),
      },
    },
    null,
    2,
  )}\n`;
}

export function safeFileBaseName(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim();

  return cleaned || "truss-conversation";
}

export function toChatRequestMessages(messages: ChatUiMessage[]): ChatMessage[] {
  return messages
    .filter((message) => message.status !== "thinking" && message.status !== "error")
    .map((message) => ({
      role: message.role,
      content: message.content,
      attachments: message.attachments,
    }));
}

export function createClientMessageId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function formatThoughtDuration(durationMs: number): string {
  const seconds = Math.max(1, Math.round(durationMs / 1000));

  if (seconds < 60) {
    return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  }

  const minutes = Math.round(seconds / 60);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

export function formatWordCount(words: number): string {
  return `${words} ${words === 1 ? "word" : "words"}`;
}

export function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function errorMessage(caught: unknown): string {
  if (!(caught instanceof Error)) {
    return String(caught);
  }

  try {
    const parsed = JSON.parse(caught.message) as unknown;

    if (parsed && typeof parsed === "object") {
      const error = (parsed as Record<string, unknown>).error;

      if (typeof error === "string") {
        return error;
      }
    }
  } catch {
    // The API helper returns plain text for non-JSON errors too.
  }

  return caught.message;
}

export function assistantFailureContent(message: ChatUiMessage, caught: unknown): string {
  if (message.content.trim()) {
    return message.content;
  }

  const toolCalls = message.thinking?.toolCalls ?? [];
  const failedToolCalls = toolCalls.filter((toolCall) => toolCall.status === "error");

  if (failedToolCalls.length > 0) {
    return [
      "I couldn't complete the requested tool use because one or more tool calls failed.",
      "",
      ...failedToolCalls.map(
        (toolCall) =>
          `- ${toolCall.title}: ${truncateToolError(toolCall.error ?? "Unknown tool error.")}`,
      ),
      "",
      "Open the thinking details to inspect the tool arguments and full error output.",
    ].join("\n");
  }

  const completedToolCalls = toolCalls.filter((toolCall) => toolCall.status === "completed");

  if (completedToolCalls.length > 0) {
    return [
      "The tool calls completed, but I couldn't finish the final model response.",
      "",
      `Error: ${truncateToolError(errorMessage(caught))}`,
      "",
      "Open the thinking details to inspect the completed tool results.",
    ].join("\n");
  }

  return errorMessage(caught);
}

function truncateToolError(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  const maxLength = 280;

  return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 3)}...`;
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function serializeSessionForExport(detail: AgentSessionDetailResponse): Record<string, unknown> {
  return {
    id: detail.session.id,
    type: detail.session.type,
    parentSessionId: detail.session.parentSessionId,
    title: detail.session.title,
    providerId: detail.session.providerId,
    modelId: detail.session.modelId,
    messageCount: detail.session.messageCount,
    wordCount: detail.session.wordCount,
    parameters: detail.session.parameters,
    createdAt: detail.session.createdAt,
    updatedAt: detail.session.updatedAt,
    workspacePath: detail.session.workspacePath,
  };
}

function formatOpenAiMessage(message: ChatMessage | StoredChatMessage): Record<string, unknown> {
  return {
    role: message.role,
    content: message.content,
  };
}

function formatOpenAiConversationMessages(message: StoredChatMessage): Record<string, unknown>[] {
  const toolCalls = message.role === "assistant" ? (message.thinking?.toolCalls ?? []) : [];

  if (toolCalls.length === 0) {
    return [formatOpenAiMessage(message)];
  }

  return [
    {
      role: "assistant",
      content: null,
      tool_calls: toolCalls.map(formatOpenAiToolCall),
    },
    ...toolCalls.map(formatOpenAiToolObservationMessage),
    ...(message.content.trim() ? [formatOpenAiMessage(message)] : []),
  ];
}

function formatOpenAiToolCall(toolCall: ChatToolCall): Record<string, unknown> {
  return {
    id: toolCall.id,
    type: "function",
    function: {
      name: toolCall.toolId,
      arguments: stringifyJsonForExport(toolCall.args),
    },
  };
}

function formatOpenAiToolObservationMessage(toolCall: ChatToolCall): Record<string, unknown> {
  return {
    role: "tool",
    tool_call_id: toolCall.id,
    name: toolCall.toolId,
    content: formatOpenAiToolObservationContent(toolCall),
  };
}

function formatOpenAiToolObservationContent(toolCall: ChatToolCall): string {
  if (typeof toolCall.result === "string") {
    return toolCall.result;
  }

  if (toolCall.status === "error" || typeof toolCall.error === "string") {
    return [
      "tool_error:",
      `  status: ${toolCall.status}`,
      `  title: ${toolCall.title}`,
      `  message: ${toolCall.error?.trim() || "Unknown tool error."}`,
    ].join("\n");
  }

  return "";
}

function stringifyJsonForExport(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(null);
  }
}

function formatOpenAiParameters(
  parameters: AgentSessionDetailResponse["session"]["parameters"],
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  if (typeof parameters.temperature === "number") {
    output.temperature = parameters.temperature;
  }

  if (typeof parameters.topP === "number") {
    output.top_p = parameters.topP;
  }

  return output;
}

function serializeMessageForExport(
  message: ChatMessage | StoredChatMessage | ChatUiMessage,
  modelId?: string,
): Record<string, unknown> {
  const record: Record<string, unknown> = {
    role: message.role,
    content: message.content,
  };

  if ("id" in message) {
    record.id = message.id;
  }

  if ("createdAt" in message) {
    record.createdAt = message.createdAt;
  }

  if ("completedAt" in message && message.completedAt) {
    record.completedAt = message.completedAt;
  }

  if (message.role === "assistant") {
    const assistantModelId = "modelId" in message ? message.modelId : modelId;

    if (assistantModelId) {
      record.modelId = assistantModelId;
    }
  }

  if ("status" in message && message.status) {
    record.status = message.status;
  }

  if ("persisted" in message && typeof message.persisted === "boolean") {
    record.persisted = message.persisted;
  }

  if (message.attachments?.length) {
    record.attachments = message.attachments.map(serializeAttachmentForExport);
  }

  if ("thinking" in message && message.thinking) {
    record.thinking = {
      content: message.thinking.content,
      durationMs: message.thinking.durationMs,
      wordCount: message.thinking.wordCount,
      ...(message.thinking.toolCalls?.length
        ? { toolCalls: message.thinking.toolCalls.map(serializeToolCallForExport) }
        : {}),
    };
  }

  return record;
}

function formatAtifStep(
  message: StoredChatMessage,
  stepId: number,
  modelId: string,
): Record<string, unknown> {
  const toolCalls = message.thinking?.toolCalls ?? [];
  const extra: Record<string, unknown> = {
    truss_message_id: message.id,
    truss_role: message.role,
  };

  if (message.attachments?.length) {
    extra.attachments = message.attachments.map(serializeAttachmentForExport);
  }

  const step: Record<string, unknown> = {
    step_id: stepId,
    timestamp: message.createdAt,
    source: message.role === "assistant" ? "agent" : "user",
    message: message.content,
    extra,
  };

  if (message.role === "assistant") {
    step.model_name = modelId;

    if (message.thinking?.content.trim()) {
      step.reasoning_content = message.thinking.content;
    }

    if (toolCalls.length > 0) {
      step.tool_calls = toolCalls.map(formatAtifToolCall);

      const observationResults = toolCalls
        .map(formatAtifObservationResult)
        .filter((result): result is Record<string, unknown> => Boolean(result));

      if (observationResults.length > 0) {
        step.observation = { results: observationResults };
      }
    }
  }

  return step;
}

function formatAtifSystemStep(message: ChatMessage): Record<string, unknown> {
  return {
    step_id: 1,
    source: "system",
    message: message.content,
    extra: {
      truss_role: "system",
    },
  };
}

function serializeAttachmentForExport(attachment: ChatAttachment): Record<string, unknown> {
  return { ...attachment };
}

function serializeToolCallForExport(toolCall: ChatToolCall): Record<string, unknown> {
  return { ...toolCall };
}

function formatAtifToolCall(toolCall: ChatToolCall): Record<string, unknown> {
  return {
    tool_call_id: toolCall.id,
    function_name: toolCall.toolId,
    arguments: toolCall.args,
    extra: {
      title: toolCall.title,
      status: toolCall.status,
      started_at: toolCall.startedAt,
      ...(typeof toolCall.turn === "number" ? { truss_tool_turn: toolCall.turn } : {}),
      ...(toolCall.completedAt ? { completed_at: toolCall.completedAt } : {}),
    },
  };
}

function formatAtifObservationResult(
  toolCall: ChatToolCall,
): Record<string, unknown> | null {
  const hasResult = typeof toolCall.result === "string";
  const hasError = typeof toolCall.error === "string";

  if (!hasResult && !hasError && toolCall.status !== "error") {
    return null;
  }

  const error = hasError ? toolCall.error : "Unknown tool error.";

  return {
    source_call_id: toolCall.id,
    content: hasResult ? toolCall.result : error,
    extra: {
      status: toolCall.status,
      ...(typeof toolCall.turn === "number" ? { truss_tool_turn: toolCall.turn } : {}),
      ...(toolCall.status === "error" || hasError ? { error } : {}),
    },
  };
}

function formatModelNameToken(token: string): string {
  if (/^v\d/i.test(token)) {
    return token.toLowerCase();
  }

  if (/^(?:gguf|gpt|llm|mlx|qwen|mistral|llama|api)$/i.test(token)) {
    return token.toUpperCase();
  }

  if (/^[a-z]+\d/i.test(token)) {
    return token.charAt(0).toUpperCase() + token.slice(1).toUpperCase();
  }

  if (/^\d+[a-z]+$/i.test(token)) {
    return token.toUpperCase();
  }

  if (/[A-Z]/.test(token.slice(1))) {
    return token;
  }

  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function formatModelQualifier(qualifier: string): string {
  if (/^[a-z]+$/i.test(qualifier)) {
    return qualifier.charAt(0).toUpperCase() + qualifier.slice(1).toLowerCase();
  }

  return qualifier;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
