import process from "node:process";
import type {
  JsonRpcErrorResponse,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from "../../json-rpc.ts";
import { createJsonRpcNotification, parseJsonRpcLine } from "../../json-rpc.ts";
import { formatToonToolResult } from "../../toon.ts";
import {
  createTrussOrchestrationToolsRuntime,
  type PlanItemStatus,
  type PlanSubtask,
  type PlanTodo,
  type TrussOrchestrationToolsRuntime,
} from "./runtime.ts";

interface ToolCallParams {
  _meta?: unknown;
  arguments?: unknown;
  name?: unknown;
}

interface TrussOrchestrationToolMeta {
  sessionId?: string;
}

export type TrussOrchestrationToolName =
  | "plan_get"
  | "plan_set_subtasks"
  | "plan_set_todos"
  | "plan_update_subtask"
  | "plan_update_todo"
  | "spawn_sub_agent"
  | "timer_cancel"
  | "timer_extend"
  | "timer_fire"
  | "timer_list"
  | "timer_set";

const maxIdLength = 80;
const maxLabelLength = 100;
const maxMessageLength = 500;
const maxNotesLength = 2_000;
const maxPlanItems = 100;
const maxSubAgentTaskLength = 20_000;
const maxSubAgentToolAllowlist = 100;
const maxSubAgentWorkspacePathLength = 4_000;
const maxTitleLength = 300;
const planStatuses = new Set<PlanItemStatus>(["done", "in_progress", "pending", "skipped"]);

const planningToolGroupDescription =
  "Planning tools are a session-scoped, in-memory status board for long-running work. They do not execute, schedule, or delegate work; they only track progress for the current Truss server process and are not persisted as a source of truth. Direct user requests such as `mark ... as done`, `set ... to in-progress`, `add ... to the list`, or `replace the plan` are planning-tool instructions, not requests to simulate a checklist in text. Marking `done` is bookkeeping: do it after real work happened or the user explicitly frames it as complete, and do not treat the status itself as proof of completion. Delegation is separate: `spawn_sub_agent` actually starts child-agent work.";

function planningToolDescription({
  dontConfuseWith,
  example,
  summary,
  useWhen,
}: {
  dontConfuseWith: string;
  example: string[];
  summary: string;
  useWhen: string;
}): string {
  return [
    summary,
    planningToolGroupDescription,
    `Use when: ${useWhen}`,
    `Don't confuse with: ${dontConfuseWith}`,
    "Example:",
    ...example,
  ].join("\n");
}

function orchestrationToolDescription({
  dontConfuseWith,
  example,
  summary,
  useWhen,
}: {
  dontConfuseWith: string;
  example: string[];
  summary: string;
  useWhen: string;
}): string {
  return [
    summary,
    `Use when: ${useWhen}`,
    `Don't confuse with: ${dontConfuseWith}`,
    "Example:",
    ...example,
  ].join("\n");
}

export const trussOrchestrationToolDefinitions: Record<
  TrussOrchestrationToolName,
  {
    description: string;
    inputSchema: Record<string, unknown>;
    name: TrussOrchestrationToolName;
  }
> = {
  plan_set_todos: {
    name: "plan_set_todos",
    description: planningToolDescription({
      summary:
        "Replace the current Truss session's top-level planning todos and clear their subtasks.",
      useWhen:
        "you are starting or reshaping a long-running task into a tracked top-level checklist.",
      dontConfuseWith:
        "`plan_set_subtasks` for nested checklist rows under one todo, or `spawn_sub_agent` for real delegated work.",
      example: [
        "plan_set_todos({",
        '  todos: [{ id: "repo-scan", title: "Inspect relevant files", status: "pending" }]',
        "})",
      ],
    }),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        todos: {
          type: "array",
          description: "Complete todo list to replace the current plan. Caps at 100 todos.",
          maxItems: maxPlanItems,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              description: {
                type: "string",
                description: "Optional todo notes. Caps at 2000 characters.",
                maxLength: maxNotesLength,
              },
              id: {
                type: "string",
                description: "Stable todo ID. Caps at 80 characters.",
                maxLength: maxIdLength,
              },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "done", "skipped"],
              },
              title: {
                type: "string",
                description: "Todo title. Caps at 300 characters.",
                maxLength: maxTitleLength,
              },
            },
            required: ["id", "title", "status"],
          },
        },
      },
      required: ["todos"],
    },
  },
  plan_set_subtasks: {
    name: "plan_set_subtasks",
    description: planningToolDescription({
      summary:
        "Replace or upsert subtasks nested under one todo in the current Truss session's plan.",
      useWhen:
        "one top-level todo needs smaller tracked steps, or you need to refresh that todo's subtask list.",
      dontConfuseWith:
        "`spawn_sub_agent`; subtasks are nested status rows under a parent todo and do not run child agents.",
      example: [
        "plan_set_subtasks({",
        '  todoId: "repo-scan", subtasks: [{ id: "tests", title: "Run focused tests", status: "pending" }]',
        "})",
      ],
    }),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        todoId: { type: "string" },
        replace: {
          type: "boolean",
          description: "When true or omitted, replace all subtasks under the todo. When false, upsert by id.",
        },
        subtasks: {
          type: "array",
          description: "Subtasks to replace or upsert under the todo. Caps at 100 subtasks.",
          maxItems: maxPlanItems,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: {
                type: "string",
                description: "Stable subtask ID. Caps at 80 characters.",
                maxLength: maxIdLength,
              },
              notes: {
                type: "string",
                description: "Optional subtask notes. Caps at 2000 characters.",
                maxLength: maxNotesLength,
              },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "done", "skipped"],
              },
              title: {
                type: "string",
                description: "Subtask title. Caps at 300 characters.",
                maxLength: maxTitleLength,
              },
            },
            required: ["id", "title", "status"],
          },
        },
      },
      required: ["todoId", "subtasks"],
    },
  },
  plan_get: {
    name: "plan_get",
    description: planningToolDescription({
      summary:
        "Return the current Truss session's in-memory plan as TOON, including todos and nested subtasks.",
      useWhen:
        "you need to refresh the current status board before updating it or reporting progress.",
      dontConfuseWith:
        "a durable task database, transcript history, or `spawn_sub_agent`; this is throwaway plan state only.",
      example: [
        "plan_get({})",
        "// -> todos[...]",
        "//      subtasks[...]",
      ],
    }),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  plan_update_todo: {
    name: "plan_update_todo",
    description: planningToolDescription({
      summary:
        "Patch one top-level todo by id in the current Truss session's plan without replacing the full plan.",
      useWhen:
        "a todo title or status changed after you performed, started, skipped, or intentionally reframed that work.",
      dontConfuseWith:
        "`plan_update_subtask` for nested subtasks; changing status does not execute the todo.",
      example: [
        "plan_update_todo({",
        '  id: "repo-scan", status: "done"',
        "})",
      ],
    }),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: {
          type: "string",
          description: "Todo ID to patch. Caps at 80 characters.",
          maxLength: maxIdLength,
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "done", "skipped"],
        },
        title: {
          type: "string",
          description: "Replacement todo title. Caps at 300 characters.",
          maxLength: maxTitleLength,
        },
      },
      required: ["id"],
    },
  },
  plan_update_subtask: {
    name: "plan_update_subtask",
    description: planningToolDescription({
      summary:
        "Patch one nested subtask by parent todo id and subtask id without replacing sibling subtasks.",
      useWhen:
        "a tracked subtask status or notes changed after that specific piece of work actually moved.",
      dontConfuseWith:
        "`plan_update_todo` for the parent todo, or `spawn_sub_agent` for running delegated work.",
      example: [
        "plan_update_subtask({",
        '  todoId: "repo-scan", id: "tests", status: "in_progress"',
        "})",
      ],
    }),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: {
          type: "string",
          description: "Subtask ID to patch. Caps at 80 characters.",
          maxLength: maxIdLength,
        },
        notes: {
          type: "string",
          description: "Replacement subtask notes. Caps at 2000 characters.",
          maxLength: maxNotesLength,
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "done", "skipped"],
        },
        todoId: {
          type: "string",
          description: "Parent todo ID. Caps at 80 characters.",
          maxLength: maxIdLength,
        },
      },
      required: ["todoId", "id"],
    },
  },
  spawn_sub_agent: {
    name: "spawn_sub_agent",
    description: orchestrationToolDescription({
      summary:
        "Spawn a host-mediated child agent session to perform an independent delegated task. This is available only in agentic sessions, runs the child asynchronously, does not require creating a timer, and uses only background-safe MCP servers and tools.",
      useWhen:
        "a substantial subtask can run independently and its final result can be folded back into the parent turn.",
      dontConfuseWith:
        "planning subtasks from `plan_set_subtasks` or `plan_update_subtask`, or timers from `timer_set`; planning subtasks are in-memory bookkeeping and never start child work, while timers are only for delayed or scheduled resumption.",
      example: [
        "spawn_sub_agent({",
        '  task: "Audit the auth tests and report failing cases", tools: ["read_text_file", "regex_search_files"]',
        "})",
      ],
    }),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        task: {
          type: "string",
          description: "Full task description for the sub-agent. Caps at 20000 characters.",
          maxLength: maxSubAgentTaskLength,
        },
        mcpServers: {
          anyOf: [
            {
              type: "array",
              maxItems: maxSubAgentToolAllowlist,
              items: {
                type: "string",
              },
            },
            { type: "null" },
          ],
          description:
            "Optional MCP server-id override for the sub-agent. Omit or null to inherit all parent-connected MCP servers. Caps at 100 entries.",
        },
        tools: {
          anyOf: [
            {
              type: "array",
              maxItems: maxSubAgentToolAllowlist,
              items: {
                type: "string",
              },
            },
            { type: "null" },
          ],
          description:
            "Optional model-visible tool-name override for the sub-agent. Omit or null to inherit all available background-safe tools. User-interaction, MCP config editing, directory-access, and sub-agent spawning tools are excluded from child sessions. Caps at 100 entries.",
        },
        workspacePath: {
          type: "string",
          description:
            "Optional absolute filesystem root for the sub-agent. It must be equal to or inside one of the parent session's active granted directories. Caps at 4000 characters.",
          maxLength: maxSubAgentWorkspacePathLength,
        },
      },
      required: ["task"],
    },
  },
  timer_set: {
    name: "timer_set",
    description:
      "Schedule a session-scoped timer for this Truss agentic session. When it fires, Truss injects a Truss system event message into the session and resumes the agent loop. Each session can have at most five pending timers.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        delaySeconds: {
          type: "number",
          description: "Seconds until the timer fires. Values are clamped to 1 through 3600.",
          maximum: 3_600,
          minimum: 1,
        },
        label: {
          type: "string",
          description: "Short reminder for what the model should remind itself about.",
          maxLength: maxLabelLength,
        },
        message: {
          type: "string",
          description:
            "Deprecated. Truss now emits its own timer system event text when the timer fires.",
        },
      },
      required: ["delaySeconds"],
    },
  },
  timer_cancel: {
    name: "timer_cancel",
    description: "Cancel a pending timer in this Truss agentic session.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        timerId: { type: "string" },
      },
      required: ["timerId"],
    },
  },
  timer_extend: {
    name: "timer_extend",
    description: "Extend a pending session-scoped timer by adding the given number of seconds to its current trigger time.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        delaySeconds: {
          type: "number",
          description: "Seconds to add to the timer's current trigger time. Values are clamped to 1 through 3600.",
          maximum: 3_600,
          minimum: 1,
        },
        timerId: { type: "string" },
      },
      required: ["timerId", "delaySeconds"],
    },
  },
  timer_fire: {
    name: "timer_fire",
    description: "Manually fire a pending session-scoped timer now.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        timerId: { type: "string" },
      },
      required: ["timerId"],
    },
  },
  timer_list: {
    name: "timer_list",
    description: "List pending timers for this Truss agentic session.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
};

export async function runTrussOrchestrationToolsMcpServer(): Promise<void> {
  const runtime = createTrussOrchestrationToolsRuntime({
    onTimerFired: (event) =>
      writeJsonRpcMessage(
        createJsonRpcNotification("truss/orchestration_timer_fired", {
          ...event,
        }),
      ),
  });

  try {
    for await (const line of readStdinLines()) {
      const message = parseJsonRpcLine(line);

      if (!message) {
        continue;
      }

      const response = await handleMessage(message, runtime);

      if (response) {
        writeJsonRpcMessage(response);
      }
    }
  } finally {
    runtime.close();
  }
}

function handleMessage(
  message: JsonRpcMessage,
  runtime: TrussOrchestrationToolsRuntime,
): Promise<JsonRpcResponse | null> {
  if (!isJsonRpcRequest(message)) {
    return Promise.resolve(null);
  }

  return handleRequest(message, runtime).catch((caught) =>
    jsonRpcError(message.id, -32603, caught instanceof Error ? caught.message : String(caught)),
  );
}

async function handleRequest(
  request: JsonRpcRequest,
  runtime: TrussOrchestrationToolsRuntime,
): Promise<JsonRpcResponse> {
  switch (request.method) {
    case "initialize":
      return jsonRpcResult(request.id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "Truss Orchestration Tools",
          version: "0.1.0",
        },
      });
    case "tools/list":
      return jsonRpcResult(request.id, {
        tools: Object.values(trussOrchestrationToolDefinitions).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    case "tools/call":
      return handleToolCall(request, runtime);
    case "resources/list":
      return jsonRpcResult(request.id, { resources: [] });
    case "prompts/list":
      return jsonRpcResult(request.id, { prompts: [] });
    default:
      return jsonRpcError(request.id, -32601, `Unknown method: ${request.method}`);
  }
}

async function handleToolCall(
  request: JsonRpcRequest,
  runtime: TrussOrchestrationToolsRuntime,
): Promise<JsonRpcResponse> {
  const params = normalizeToolCallParams(request.params);
  const toolName =
    typeof params.name === "string" ? trussOrchestrationToolNameForName(params.name) : null;

  if (!toolName) {
    return jsonRpcError(
      request.id,
      -32602,
      `Unknown Truss Orchestration Tools tool: ${String(params.name ?? "")}`,
    );
  }

  const result = executeTrussOrchestrationToolValue({
    args: normalizeToolArguments(params.arguments),
    meta: normalizeTrussMeta(params._meta),
    runtime,
    toolName,
  });

  return jsonRpcResult(request.id, {
    content: [
      {
        type: "text",
        text: formatToonToolResult(toolName, result),
      },
    ],
    structuredContent: result,
  });
}

export function executeTrussOrchestrationToolValue({
  args,
  meta,
  runtime,
  toolName,
}: {
  args: Record<string, unknown>;
  meta?: TrussOrchestrationToolMeta;
  runtime: TrussOrchestrationToolsRuntime;
  toolName: TrussOrchestrationToolName;
}): unknown {
  if (toolName === "plan_set_todos") {
    return runtime.setTodos({
      sessionId: requiredSessionId(meta),
      todos: planTodosArg(args, "todos"),
    });
  }

  if (toolName === "plan_set_subtasks") {
    return runtime.setSubtasks({
      replace: optionalBooleanArg(args, "replace") ?? true,
      sessionId: requiredSessionId(meta),
      subtasks: planSubtasksArg(args, "subtasks"),
      todoId: requiredStringArg(args, "todoId", maxIdLength),
    });
  }

  if (toolName === "plan_get") {
    return runtime.getPlan(requiredSessionId(meta));
  }

  if (toolName === "plan_update_todo") {
    return runtime.updateTodo({
      id: requiredStringArg(args, "id", maxIdLength),
      sessionId: requiredSessionId(meta),
      status: optionalStatusArg(args, "status"),
      title: optionalStringArg(args, "title", maxTitleLength),
    });
  }

  if (toolName === "plan_update_subtask") {
    return runtime.updateSubtask({
      id: requiredStringArg(args, "id", maxIdLength),
      notes: optionalStringArg(args, "notes", maxNotesLength),
      sessionId: requiredSessionId(meta),
      status: optionalStatusArg(args, "status"),
      todoId: requiredStringArg(args, "todoId", maxIdLength),
    });
  }

  if (toolName === "spawn_sub_agent") {
    throw new Error(
      "spawn_sub_agent is handled by the Truss chat host because it creates and runs a child agent session.",
    );
  }

  if (toolName === "timer_set") {
    return runtime.setTimer({
      delaySeconds: numberArg(args, "delaySeconds", 1, 3600),
      label: optionalStringArg(args, "label", maxLabelLength),
      sessionId: requiredSessionId(meta),
    });
  }

  if (toolName === "timer_cancel") {
    return runtime.cancelTimer(requiredStringArg(args, "timerId", maxIdLength), requiredSessionId(meta));
  }

  if (toolName === "timer_extend") {
    return {
      timer: runtime.extendTimer(
        requiredStringArg(args, "timerId", maxIdLength),
        requiredSessionId(meta),
        numberArg(args, "delaySeconds", 1, 3600),
      ),
    };
  }

  if (toolName === "timer_fire") {
    return runtime.fireTimer(requiredStringArg(args, "timerId", maxIdLength), requiredSessionId(meta));
  }

  return {
    timers: runtime.listTimers(requiredSessionId(meta)),
  };
}

function planTodosArg(args: Record<string, unknown>, name: string): PlanTodo[] {
  const value = args[name];

  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array.`);
  }

  if (value.length > maxPlanItems) {
    throw new Error(`${name} may include at most ${maxPlanItems} items.`);
  }

  return value.map((item, index) => {
    const record = recordArg(item, `${name}[${index}]`);

    return {
      description: optionalStringArg(record, "description", maxNotesLength),
      id: requiredStringArg(record, "id", maxIdLength),
      status: requiredStatusArg(record, "status"),
      subtasks: [],
      title: requiredStringArg(record, "title", maxTitleLength),
    };
  });
}

function planSubtasksArg(args: Record<string, unknown>, name: string): PlanSubtask[] {
  const value = args[name];

  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array.`);
  }

  if (value.length > maxPlanItems) {
    throw new Error(`${name} may include at most ${maxPlanItems} items.`);
  }

  return value.map((item, index) => {
    const record = recordArg(item, `${name}[${index}]`);

    return {
      id: requiredStringArg(record, "id", maxIdLength),
      notes: optionalStringArg(record, "notes", maxNotesLength),
      status: requiredStatusArg(record, "status"),
      title: requiredStringArg(record, "title", maxTitleLength),
    };
  });
}

function requiredSessionId(meta: TrussOrchestrationToolMeta | undefined): string {
  const sessionId = meta?.sessionId?.trim();

  if (!sessionId) {
    throw new Error("This tool requires Truss session metadata.");
  }

  return sessionId;
}

function recordArg(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requiredStringArg(args: Record<string, unknown>, name: string, maxLength: number): string {
  const value = optionalStringArg(args, name, maxLength);

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function optionalStringArg(
  args: Record<string, unknown>,
  name: string,
  maxLength: number,
): string | undefined {
  const value = args[name];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${name} must be a string.`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new Error(`${name} is too long.`);
  }

  return trimmed || undefined;
}

function optionalBooleanArg(args: Record<string, unknown>, name: string): boolean | undefined {
  const value = args[name];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean.`);
  }

  return value;
}

function numberArg(
  args: Record<string, unknown>,
  name: string,
  min: number,
  max: number,
): number {
  const value = args[name];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a number.`);
  }

  return Math.min(max, Math.max(min, value));
}

function requiredStatusArg(args: Record<string, unknown>, name: string): PlanItemStatus {
  const value = optionalStatusArg(args, name);

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function optionalStatusArg(
  args: Record<string, unknown>,
  name: string,
): PlanItemStatus | undefined {
  const value = args[name];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string" || !planStatuses.has(value as PlanItemStatus)) {
    throw new Error(`${name} must be pending, in_progress, done, or skipped.`);
  }

  return value as PlanItemStatus;
}

function normalizeToolCallParams(value: unknown): ToolCallParams {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeToolArguments(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeTrussMeta(value: unknown): TrussOrchestrationToolMeta {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const sessionId = (value as Record<string, unknown>).sessionId;

  return typeof sessionId === "string" ? { sessionId } : {};
}

function trussOrchestrationToolNameForName(name: string): TrussOrchestrationToolName | null {
  return Object.hasOwn(trussOrchestrationToolDefinitions, name)
    ? (name as TrussOrchestrationToolName)
    : null;
}

async function* readStdinLines(): AsyncIterable<string> {
  const decoder = new TextDecoderStream();
  const stream = Bun.stdin.stream().pipeThrough(decoder);
  let buffered = "";

  for await (const chunk of stream) {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";

    for (const line of lines) {
      yield line;
    }
  }

  if (buffered) {
    yield buffered;
  }
}

function writeJsonRpcMessage(message: JsonRpcResponse | JsonRpcNotification): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function jsonRpcResult(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function jsonRpcError(
  id: JsonRpcRequest["id"] | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      data,
      message,
    },
  };
}

function isJsonRpcRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return "method" in message && "id" in message;
}
