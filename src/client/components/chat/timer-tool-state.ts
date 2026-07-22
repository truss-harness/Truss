import type { ChatToolCall, OrchestrationTimerSummary } from "../../../shared/protocol.ts";
import type { ActiveTimerStatus } from "./ActivityStatusPane.tsx";

export function activeTimerFromToolCall(
  toolCall: ChatToolCall,
  fallbackSessionId: string | null,
): ActiveTimerStatus | null {
  if (toolCall.status !== "completed" || !toolCall.result || !fallbackSessionId) {
    return null;
  }

  const toolName = timerToolName(toolCall);

  if (toolName !== "timer_set" && toolName !== "timer_extend") {
    return null;
  }

  const parsed = parseToolCallResultRecord(toolCall.result, toolName);
  const source = toolName === "timer_extend" ? parsed?.timer : parsed;
  const timer = normalizeTimerSummaryForClient(source, toolCall);

  return timer
    ? {
        ...timer,
        sessionId: fallbackSessionId,
      }
    : null;
}

export function removedTimerIdFromToolCall(toolCall: ChatToolCall): string | null {
  if (toolCall.status !== "completed" || !toolCall.result) {
    return null;
  }

  const toolName = timerToolName(toolCall);

  if (toolName !== "timer_cancel" && toolName !== "timer_fire" && toolName !== "timer_extend") {
    return null;
  }

  const timerId = typeof toolCall.args.timerId === "string" ? toolCall.args.timerId.trim() : "";

  if (!timerId) {
    return null;
  }

  const parsed = parseToolCallResultRecord(toolCall.result, toolName);

  if (toolName === "timer_cancel" && parsed?.cancelled === true) {
    return timerId;
  }

  if (toolName === "timer_fire" && parsed?.fired === true) {
    return timerId;
  }

  if (toolName === "timer_extend" && parsed?.timer === null) {
    return timerId;
  }

  return null;
}

export function upsertActiveTimer(
  current: ActiveTimerStatus[],
  nextTimer: ActiveTimerStatus,
): ActiveTimerStatus[] {
  const withoutExisting = current.filter((timer) => timer.timerId !== nextTimer.timerId);

  return [...withoutExisting, nextTimer].sort((left, right) =>
    left.firesAt.localeCompare(right.firesAt),
  );
}

function timerToolName(toolCall: ChatToolCall): string | null {
  const candidates = ["timer_set", "timer_cancel", "timer_extend", "timer_fire"] as const;

  return (
    candidates.find(
      (candidate) =>
        toolCall.toolId === candidate ||
        toolCall.toolId.endsWith(`__${candidate}`) ||
        toolCall.title === `Truss Orchestration Tools: ${candidate}`,
    ) ?? null
  );
}

function parseToolCallResultRecord(
  value: string,
  toolName: string,
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
  }

  return parseToonToolResult(value, toolName);
}

function parseToonToolResult(value: string, toolName: string): Record<string, unknown> | null {
  const lines = value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (lines[0]?.trim() !== `${toolName}:`) {
    return null;
  }

  const result: Record<string, unknown> = {};
  let nestedKey: string | null = null;

  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    const match = /^([A-Za-z][A-Za-z0-9_]*):(?:\s(.*))?$/.exec(trimmed);

    if (!match) {
      continue;
    }

    const indent = line.length - line.trimStart().length;
    const key = match[1] ?? "";
    const rawValue = match[2] ?? "";

    if (indent <= 2) {
      if (!rawValue) {
        const nested: Record<string, unknown> = {};

        result[key] = nested;
        nestedKey = key;
      } else {
        result[key] = parseToonScalar(rawValue);
        nestedKey = null;
      }
      continue;
    }

    const nested = nestedKey ? result[nestedKey] : null;

    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      (nested as Record<string, unknown>)[key] = parseToonScalar(rawValue);
    }
  }

  return result;
}

function parseToonScalar(value: string): unknown {
  const trimmed = value.trim();

  if (trimmed === "null") {
    return null;
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function normalizeTimerSummaryForClient(
  value: unknown,
  toolCall: ChatToolCall,
): OrchestrationTimerSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const source = value as Record<string, unknown>;
  const firesAt = typeof source.firesAt === "string" ? source.firesAt : "";
  const fallbackDelaySeconds =
    typeof toolCall.args.delaySeconds === "number" && Number.isFinite(toolCall.args.delaySeconds)
      ? Math.min(3600, Math.max(1, Math.floor(toolCall.args.delaySeconds)))
      : null;
  const lengthSeconds =
    typeof source.lengthSeconds === "number" && Number.isFinite(source.lengthSeconds)
      ? source.lengthSeconds
      : fallbackDelaySeconds;
  const message = typeof source.message === "string" ? source.message : "";
  const startedAt = typeof source.startedAt === "string" && source.startedAt.trim()
    ? source.startedAt.trim()
    : undefined;
  const timerId = typeof source.timerId === "string" ? source.timerId : "";

  if (!firesAt || !lengthSeconds || !message || !timerId) {
    return null;
  }

  const label =
    typeof source.label === "string" && source.label.trim()
      ? source.label.trim()
      : typeof toolCall.args.label === "string" && toolCall.args.label.trim()
        ? toolCall.args.label.trim()
        : undefined;

  return {
    firesAt,
    ...(label ? { label } : {}),
    lengthSeconds,
    message,
    ...(startedAt ? { startedAt } : {}),
    timerId,
  };
}
