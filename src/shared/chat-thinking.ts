import type { ChatToolCall } from "./protocol.ts";

export function appendThinkingTextBlock(
  current: string | null | undefined,
  next: string | null | undefined,
): string | undefined {
  const currentText = normalizeThinkingText(current);
  const nextText = normalizeThinkingText(next);

  if (!currentText) {
    return nextText || undefined;
  }

  if (!nextText || currentText === nextText || currentText.startsWith(nextText)) {
    return currentText;
  }

  if (nextText.startsWith(currentText)) {
    return nextText;
  }

  return `${currentText}\n\n${nextText}`;
}

export function mergeChatToolCall(
  existing: ChatToolCall,
  incoming: ChatToolCall,
): ChatToolCall {
  const merged: ChatToolCall = {
    ...existing,
    ...incoming,
  };
  const thinkingBefore = appendThinkingTextBlock(
    existing.thinkingBefore,
    incoming.thinkingBefore,
  );
  const thinkingAfter = appendThinkingTextBlock(existing.thinkingAfter, incoming.thinkingAfter);

  if (thinkingBefore) {
    merged.thinkingBefore = thinkingBefore;
  } else {
    delete merged.thinkingBefore;
  }

  if (thinkingAfter) {
    merged.thinkingAfter = thinkingAfter;
  } else {
    delete merged.thinkingAfter;
  }

  return merged;
}

export function mergeChatToolCalls(
  first: ChatToolCall[] | null | undefined,
  second: ChatToolCall[] | null | undefined,
): ChatToolCall[] {
  const merged = [...(first ?? [])];

  for (const incoming of second ?? []) {
    const existingIndex = merged.findIndex((item) => item.id === incoming.id);

    if (existingIndex >= 0) {
      const existing = merged[existingIndex];

      if (existing) {
        merged[existingIndex] = mergeChatToolCall(existing, incoming);
      }
      continue;
    }

    merged.push(incoming);
  }

  return merged;
}

function normalizeThinkingText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}
