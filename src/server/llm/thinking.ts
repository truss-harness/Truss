import type { ChatThinking } from "../../shared/protocol.ts";
import { mergeChatToolCalls } from "../../shared/chat-thinking.ts";

export interface ThinkingDeltaParts {
  content: string;
  thinking: string;
  thinkingStarted: boolean;
}

export interface SplitThinkBlocksResult {
  content: string;
  thinking: string;
}

interface OpenAiThinkingResponse {
  choices?: Array<{
    message?: {
      encrypted_content?: unknown;
      reasoning?: unknown;
      reasoning_content?: unknown;
      thinking?: unknown;
    };
  }>;
}

interface OllamaThinkingResponse {
  message?: {
    thinking?: unknown;
  };
}

export class ThinkBlockParser {
  readonly #openTags = ["<think>", "<thinking>"];
  readonly #closeTagPrefixes = ["</think", "</thinking"];
  #mode: "content" | "thinking" = "content";
  #pending = "";

  push(delta: string): ThinkingDeltaParts {
    return this.#process(delta, false);
  }

  flush(): ThinkingDeltaParts {
    return this.#process("", true);
  }

  #process(delta: string, flush: boolean): ThinkingDeltaParts {
    let text = `${this.#pending}${delta}`;
    let content = "";
    let thinking = "";
    let thinkingStarted = false;

    this.#pending = "";

    while (text) {
      if (this.#mode === "content") {
        const openTag = findOpenTag(text, this.#openTags);

        if (openTag) {
          content += text.slice(0, openTag.index);
          text = text.slice(openTag.index + openTag.length);
          this.#mode = "thinking";
          thinkingStarted = true;
          continue;
        }

        const keep = flush ? 0 : partialTagSuffixLength(text, this.#openTags);
        content += text.slice(0, text.length - keep);
        this.#pending = text.slice(text.length - keep);
        break;
      }

      const closeTag = findCloseTag(text, this.#closeTagPrefixes);

      if (closeTag) {
        thinking += text.slice(0, closeTag.index);
        text = text.slice(closeTag.index + closeTag.length);
        this.#mode = "content";
        continue;
      }

      const keep = flush ? 0 : partialTagSuffixLength(text, this.#closeTagPrefixes);
      thinking += text.slice(0, text.length - keep);
      this.#pending = text.slice(text.length - keep);
      break;
    }

    return { content, thinking, thinkingStarted };
  }
}

export function thinkingFromOpenAiCompatibleResponse(
  body: unknown,
  startedAt: number,
): ChatThinking | null {
  const message = (body as OpenAiThinkingResponse).choices?.[0]?.message;
  const content = firstString(
    message?.reasoning_content,
    thinkingText(message?.reasoning),
    thinkingText(message?.thinking),
  );
  const encryptedContent = firstString(
    message?.encrypted_content,
    encryptedThinkingContent(message?.reasoning),
    encryptedThinkingContent(message?.thinking),
  );
  const thinking = thinkingFromText(content, startedAt);

  if (!encryptedContent) {
    return thinking;
  }

  return {
    ...(thinking ?? { content: "", durationMs: 0, wordCount: 0 }),
    encryptedContent,
  };
}

export function thinkingFromOllamaResponse(
  body: unknown,
  startedAt: number,
): ChatThinking | null {
  const content = (body as OllamaThinkingResponse).message?.thinking;

  return thinkingFromText(typeof content === "string" ? content : null, startedAt);
}

export function thinkingFromText(content: string | null, startedAt: number): ChatThinking | null {
  const trimmed = content?.trim();

  if (!trimmed) {
    return null;
  }

  return {
    content: trimmed,
    durationMs: Math.max(0, Date.now() - startedAt),
    wordCount: wordCount(trimmed),
  };
}

export function thinkingFromLiveText(content: string, startedAt: number): ChatThinking {
  return {
    content,
    durationMs: Math.max(0, Date.now() - startedAt),
    wordCount: wordCount(content),
  };
}

export function splitThinkBlocksFromText(content: string): SplitThinkBlocksResult {
  const parser = new ThinkBlockParser();
  const parsed = parser.push(content);
  const flushed = parser.flush();

  return {
    content: `${parsed.content}${flushed.content}`,
    thinking: `${parsed.thinking}${flushed.thinking}`,
  };
}

export function mergeChatThinking(
  first: ChatThinking | null,
  second: ChatThinking | null,
): ChatThinking | null {
  if (!first) {
    return second;
  }

  if (!second) {
    return first;
  }

  const content = [first.content.trim(), second.content.trim()]
    .filter(Boolean)
    .join("\n\n");
  const toolCalls = mergeChatToolCalls(first.toolCalls, second.toolCalls);
  const encryptedContent = second.encryptedContent ?? first.encryptedContent;
  const cutOff = first.cutOff ?? second.cutOff;

  return {
    content,
    ...(cutOff ? { cutOff } : {}),
    durationMs: first.durationMs + second.durationMs,
    ...(encryptedContent ? { encryptedContent } : {}),
    ...(toolCalls.length ? { toolCalls } : {}),
    wordCount: wordCount(content),
  };
}

function thinkingText(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  return firstString(record.content, record.text, record.reasoning_content, record.reasoning);
}

function encryptedThinkingContent(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return (value as Record<string, unknown>).encrypted_content;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function indexOfIgnoreCase(value: string, search: string): number {
  return value.toLowerCase().indexOf(search.toLowerCase());
}

function findOpenTag(value: string, tags: string[]): { index: number; length: number } | null {
  let match: { index: number; length: number } | null = null;

  for (const tag of tags) {
    const index = indexOfIgnoreCase(value, tag);

    if (index >= 0 && (!match || index < match.index)) {
      match = { index, length: tag.length };
    }
  }

  return match;
}

function findCloseTag(
  value: string,
  prefixes: string[],
): { index: number; length: number } | null {
  let match: { index: number; length: number } | null = null;
  const lowerValue = value.toLowerCase();

  for (const prefix of prefixes) {
    const index = lowerValue.indexOf(prefix.toLowerCase());

    if (index < 0) {
      continue;
    }

    const closeIndex = value.indexOf(">", index + prefix.length);

    if (closeIndex < 0) {
      continue;
    }

    const length = closeIndex - index + 1;

    if (!match || index < match.index) {
      match = { index, length };
    }
  }

  return match;
}

function partialTagSuffixLength(value: string, tags: string[]): number {
  const lowerValue = value.toLowerCase();
  const maxLength = Math.min(lowerValue.length, Math.max(...tags.map((tag) => tag.length - 1)));

  for (let length = maxLength; length > 0; length -= 1) {
    const suffix = lowerValue.slice(-length);

    if (tags.some((tag) => tag.toLowerCase().startsWith(suffix))) {
      return length;
    }
  }

  return 0;
}
