import type { ChatToolCall } from "../../../shared/protocol.ts";
import type { ChatUiMessage } from "./types.ts";

export type ActivityPlanItemStatus = "done" | "in_progress" | "pending" | "skipped";

export interface ActivityPlanSubtask {
  id: string;
  notes?: string;
  status: ActivityPlanItemStatus;
  title: string;
}

export interface ActivityPlanTodo {
  description?: string;
  id: string;
  status: ActivityPlanItemStatus;
  subtasks: ActivityPlanSubtask[];
  title: string;
}

export interface ActivityPlanStatus {
  todos: ActivityPlanTodo[];
}

const planToolNames = [
  "plan_set_todos",
  "plan_set_subtasks",
  "plan_get",
  "plan_update_todo",
  "plan_update_subtask",
] as const;

const planStatuses = new Set<ActivityPlanItemStatus>([
  "done",
  "in_progress",
  "pending",
  "skipped",
]);

type PlanToolName = (typeof planToolNames)[number];

export function planFromMessages(messages: ChatUiMessage[]): ActivityPlanStatus | null {
  let plan: ActivityPlanStatus | null = null;

  for (const message of messages) {
    for (const toolCall of message.thinking?.toolCalls ?? []) {
      plan = planFromToolCall(toolCall) ?? plan;
    }
  }

  return plan;
}

export function planFromToolCall(toolCall: ChatToolCall): ActivityPlanStatus | null {
  if (toolCall.status !== "completed" || !toolCall.result) {
    return null;
  }

  const toolName = planToolName(toolCall);

  if (!toolName) {
    return null;
  }

  return normalizePlan(parseToolCallResultRecord(toolCall.result, toolName));
}

function planToolName(toolCall: ChatToolCall): PlanToolName | null {
  return (
    planToolNames.find(
      (candidate) =>
        toolCall.toolId === candidate ||
        toolCall.toolId.endsWith(`__${candidate}`) ||
        toolCall.title === `Truss Orchestration Tools: ${candidate}`,
    ) ?? null
  );
}

function parseToolCallResultRecord(
  value: string,
  toolName: PlanToolName,
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
  }

  return parseToonPlanResult(value, toolName);
}

function parseToonPlanResult(value: string, toolName: PlanToolName): Record<string, unknown> | null {
  const lines = value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (lines[0]?.trim() !== `${toolName}:`) {
    return null;
  }

  const todos: Array<Record<string, unknown>> = [];
  let currentTodo: Record<string, unknown> | null = null;
  let currentSubtask: Record<string, unknown> | null = null;

  for (const line of lines.slice(1)) {
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (trimmed.startsWith("todos[")) {
      currentTodo = null;
      currentSubtask = null;
      continue;
    }

    if (indent === 4 && trimmed.startsWith("- ")) {
      currentTodo = { subtasks: [] };
      currentSubtask = null;
      assignToonField(currentTodo, trimmed.slice(2));
      todos.push(currentTodo);
      continue;
    }

    if (!currentTodo) {
      continue;
    }

    if (indent === 6 && trimmed.startsWith("subtasks[")) {
      currentTodo.subtasks = [];
      currentSubtask = null;
      continue;
    }

    if (indent === 8 && trimmed.startsWith("- ")) {
      currentSubtask = {};
      const subtasks = Array.isArray(currentTodo.subtasks) ? currentTodo.subtasks : [];

      subtasks.push(currentSubtask);
      currentTodo.subtasks = subtasks;
      assignToonField(currentSubtask, trimmed.slice(2));
      continue;
    }

    if (indent >= 10 && currentSubtask) {
      assignToonField(currentSubtask, trimmed);
      continue;
    }

    if (indent >= 6) {
      assignToonField(currentTodo, trimmed);
    }
  }

  return { todos };
}

function assignToonField(target: Record<string, unknown>, text: string): void {
  const match = /^([A-Za-z][A-Za-z0-9_]*):(?:\s(.*))?$/.exec(text);

  if (!match) {
    return;
  }

  target[match[1] ?? ""] = parseToonScalar(match[2] ?? "");
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

function normalizePlan(value: unknown): ActivityPlanStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const todos = (value as Record<string, unknown>).todos;

  if (!Array.isArray(todos)) {
    return null;
  }

  return {
    todos: todos.flatMap((todo) => {
      const normalized = normalizeTodo(todo);

      return normalized ? [normalized] : [];
    }),
  };
}

function normalizeTodo(value: unknown): ActivityPlanTodo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const source = value as Record<string, unknown>;
  const id = stringValue(source.id);
  const status = statusValue(source.status);
  const title = stringValue(source.title);

  if (!id || !status || !title) {
    return null;
  }

  const description = stringValue(source.description);
  const subtasks = Array.isArray(source.subtasks)
    ? source.subtasks.flatMap((subtask) => {
        const normalized = normalizeSubtask(subtask);

        return normalized ? [normalized] : [];
      })
    : [];

  return {
    ...(description ? { description } : {}),
    id,
    status,
    subtasks,
    title,
  };
}

function normalizeSubtask(value: unknown): ActivityPlanSubtask | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const source = value as Record<string, unknown>;
  const id = stringValue(source.id);
  const status = statusValue(source.status);
  const title = stringValue(source.title);

  if (!id || !status || !title) {
    return null;
  }

  const notes = stringValue(source.notes);

  return {
    id,
    ...(notes ? { notes } : {}),
    status,
    title,
  };
}

function statusValue(value: unknown): ActivityPlanItemStatus | null {
  return typeof value === "string" && planStatuses.has(value as ActivityPlanItemStatus)
    ? value as ActivityPlanItemStatus
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
