import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import type {
  AgentSessionSummary,
} from "../../../../shared/protocol.ts";
import type {
  JsonRpcErrorResponse,
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
} from "../../json-rpc.ts";
import { parseJsonRpcLine } from "../../json-rpc.ts";
import {
  createTrussChatToolsMcpRuntime,
  type TrussChatToolsRuntime,
} from "./runtime.ts";
import { discoverSkills } from "../../../skills/discovery.ts";
import type { SkillDocument } from "../../../skills/types.ts";
import {
  askUserChoiceInputSchema,
  askUserChoiceToolName,
} from "../../../tools/user-choice.ts";
import {
  requestDirectoryAccessInputSchema,
  requestDirectoryAccessToolName,
} from "../../../tools/file-access-request.ts";
import {
  requestScheduledTaskGlobalAccessInputSchema,
  requestScheduledTaskGlobalAccessToolName,
} from "../../../tools/scheduled-task-access-request.ts";
import type { ToolExecutionModelReference } from "../../../tools/truss-web-tools.ts";
import type {
  ScheduledTaskCreate,
  ScheduledTaskUpdate,
} from "../../../storage/scheduled-tasks.ts";
import type { LlmGenerationParameters, ScheduledTaskSummary } from "../../../../shared/protocol.ts";
import { createId } from "../../../utils/id.ts";
import { getLlmProvider } from "../../../llm/registry.ts";
import { CronPattern } from "croner";

interface TrussChatToolsMcpServerOptions {
  trussHomeDir?: string;
  workspacePath?: string;
}

interface ToolCallParams {
  _meta?: unknown;
  arguments?: unknown;
  name?: unknown;
}

interface TrussChatToolCallMeta {
  fallbackModel?: ToolExecutionModelReference;
}

interface ResourceReadParams {
  uri?: unknown;
}

export type TrussChatToolName =
  | typeof askUserChoiceToolName
  | typeof requestDirectoryAccessToolName
  | typeof requestScheduledTaskGlobalAccessToolName
  | "create_scheduled_task"
  | "delete_conversation"
  | "delete_scheduled_task"
  | "edit_mcp_config"
  | "get_scheduled_task"
  | "list_conversations"
  | "list_scheduled_task_runs"
  | "list_scheduled_tasks"
  | "read_skill"
  | "review_mcp_config"
  | "search_conversations"
  | "update_scheduled_task"
  | "verify_mcp_docs";

const maxMcpConfigLength = 120_000;
const maxMcpConfigOutputLength = 60_000;
const maxSkillIdLength = 1_000;
const maxSearchQueryLength = 500;
const maxScheduledTaskNameLength = 200;
const maxScheduledTaskPromptLength = 40_000;
const maxScheduledTaskCronLength = 200;
const maxScheduledTaskTimezoneLength = 100;
const maxScheduledTaskWorkingDirectoryLength = 4_000;
const documentationResourceDefinitions = [
  {
    uri: "truss://docs/chat-structure",
    name: "Truss chat structure",
    mimeType: "text/markdown",
    description: "How Truss stores conversations, messages, thinking, tools, and exports.",
  },
  {
    uri: "truss://docs/mcp",
    name: "Truss MCP architecture",
    mimeType: "text/markdown",
    description: "How Truss loads MCP servers, registers first-party tools, and edits mcp.json.",
  },
  {
    uri: "truss://docs/scopes",
    name: "Truss global and workspace scopes",
    mimeType: "text/markdown",
    description: "How Truss handles global vs. workspace-scoped conversations and filesystem access.",
  },
] as const;

export const trussChatToolDefinitions: Record<
  TrussChatToolName,
  {
    description: string;
    inputSchema: Record<string, unknown>;
    name: TrussChatToolName;
  }
> = {
  [askUserChoiceToolName]: {
    name: askUserChoiceToolName,
    description:
      "Ask the active user a focused multiple-choice question in the Truss chat UI and wait for their answer. Use only when user input is required to proceed. The host opens a browser dialog that can include a Material Symbols icon and a free-text n+1 option for answers not covered by the listed choices.",
    inputSchema: askUserChoiceInputSchema(),
  },
  [requestDirectoryAccessToolName]: {
    name: requestDirectoryAccessToolName,
    description:
      "Request that the active user grant Truss Filesystem Tools access to an additional local directory. Use only when filesystem access is blocked because the needed directory is outside the current workspace or granted directories. Set readOnly: true when only listing, reading, or searching is needed; omit it for read/write access. If the directory is already inside an active file-access root with sufficient permission, Truss approves automatically and emits a visible note; otherwise the host opens a Security modal, updates grants for the current workspace or global context after approval, reloads MCP servers, and returns the user's decision.",
    inputSchema: requestDirectoryAccessInputSchema(),
  },
  list_conversations: {
    name: "list_conversations",
    description:
      "List Truss conversations in the active chat scope. Active scope is the current workspace when Truss was launched with one, or all conversations in global mode. Optional search matches metadata only: titles, provider IDs, model IDs, and session types. Use search_conversations for message text.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        includeSubAgents: {
          type: "boolean",
          description: "Include sub-agent sessions. Defaults to false.",
        },
        limit: {
          type: "integer",
          description: "Maximum conversations to return. Defaults to 20 and caps at 200.",
          maximum: 200,
          minimum: 1,
        },
        search: {
          type: "string",
          description: "Optional metadata search text. Caps at 500 characters.",
          maxLength: maxSearchQueryLength,
        },
      },
    },
  },
  search_conversations: {
    name: "search_conversations",
    description:
      "Search Truss conversation titles and message content in the active chat scope, returning matching messages with snippets and conversation metadata. Active scope is the current workspace when Truss was launched with one, or all conversations in global mode.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        includeSubAgents: {
          type: "boolean",
          description: "Include sub-agent sessions. Defaults to false.",
        },
        limit: {
          type: "integer",
          description: "Maximum matches to return. Defaults to 20 and caps at 50.",
          maximum: 50,
          minimum: 1,
        },
        query: {
          type: "string",
          description: "Text to search for in conversation messages and titles. Caps at 500 characters.",
          maxLength: maxSearchQueryLength,
        },
      },
      required: ["query"],
    },
  },
  delete_conversation: {
    name: "delete_conversation",
    description:
      "Delete a Truss conversation visible in the active scope by session ID. This permanently deletes its messages and child sub-agent rows through database cascades. Use only when the user explicitly asks to delete the conversation.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        confirmDeletion: {
          type: "boolean",
          description: "Must be true to delete the conversation. The tool fails without this explicit confirmation.",
        },
        sessionId: {
          type: "string",
          description: "The Truss agent session ID to delete. Caps at 200 characters.",
          maxLength: 200,
        },
      },
      required: ["sessionId", "confirmDeletion"],
    },
  },
  read_skill: {
    name: "read_skill",
    description:
      "Read the SKILL.md body for a discovered Truss skill by skillId. Use when a skill listed in the prompt is relevant and filesystem access to its global or workspace skill directory may be unavailable. Read-only; works only for skills discovered in the active Truss chat scope.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        skillId: {
          type: "string",
          description:
            "Exact skill id from the Skills section of the prompt. Caps at 1000 characters.",
          maxLength: maxSkillIdLength,
        },
      },
      required: ["skillId"],
    },
  },
  review_mcp_config: {
    name: "review_mcp_config",
    description:
      "Review the global Truss mcp.json file without modifying it. Returns parsed MCP server summaries and optionally the raw JSON text.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        includeRawText: {
          type: "boolean",
          description: "Include the raw mcp.json text. Defaults to true.",
        },
      },
    },
  },
  edit_mcp_config: {
    name: "edit_mcp_config",
    description:
      "Request browser-mediated approval to replace the global Truss mcp.json file with validated JSON. The Truss host validates the complete replacement, writes only after user approval, and reports that MCP reload is required for changed server entries.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        confirmOverwrite: {
          type: "boolean",
          description: "Must be true to overwrite mcp.json. The tool fails without this explicit confirmation.",
        },
        mcpConfigText: {
          type: "string",
          description: "The complete replacement JSON text for the global mcp.json file. Caps at 120000 characters.",
          maxLength: maxMcpConfigLength,
        },
      },
      required: ["mcpConfigText", "confirmOverwrite"],
    },
  },
  [requestScheduledTaskGlobalAccessToolName]: {
    name: requestScheduledTaskGlobalAccessToolName,
    description:
      "Request that the active user permanently grant this workspace-scoped assistant permission to list and read global (non-workspace) scheduled tasks and their run outputs. Only needed when this Truss instance is workspace-scoped; global instances already see every scheduled task. The host opens a choice dialog and, if approved, the grant never expires.",
    inputSchema: requestScheduledTaskGlobalAccessInputSchema(),
  },
  create_scheduled_task: {
    name: "create_scheduled_task",
    description:
      "Create a cron-scheduled task that will later run as an unattended sub-agent with a fresh prompt. Scheduled tasks created through this tool are always global (visible to every Truss workspace) regardless of the caller's current scope. By default the task runs with the same LLM provider/model/parameters as the assistant calling this tool; pass providerId/modelId only to override that. Non-overlapping by default: set allowOverlap true to permit concurrent runs of the same task.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          description: "Short human-readable name for the task. Caps at 200 characters.",
          maxLength: maxScheduledTaskNameLength,
        },
        prompt: {
          type: "string",
          description: "The prompt sent as the user message to the sub-agent on each run. Caps at 40000 characters.",
          maxLength: maxScheduledTaskPromptLength,
        },
        cronExpression: {
          type: "string",
          description: "Standard 5-field cron expression (minute hour day-of-month month day-of-week), evaluated by croner. Caps at 200 characters.",
          maxLength: maxScheduledTaskCronLength,
        },
        timezone: {
          type: "string",
          description: "IANA timezone for the cron schedule, e.g. 'America/New_York'. Defaults to the server's local timezone. Caps at 100 characters.",
          maxLength: maxScheduledTaskTimezoneLength,
        },
        workingDirectory: {
          type: "string",
          description: "Optional absolute working directory the sub-agent should use. Caps at 4000 characters.",
          maxLength: maxScheduledTaskWorkingDirectoryLength,
        },
        providerId: {
          type: "string",
          description: "Optional LLM provider ID override. Defaults to the calling assistant's own provider.",
        },
        modelId: {
          type: "string",
          description: "Optional LLM model ID override. Defaults to the calling assistant's own model.",
        },
        allowOverlap: {
          type: "boolean",
          description: "Allow a new run to start while a previous run of this task is still in progress. Defaults to false.",
        },
        enabled: {
          type: "boolean",
          description: "Whether the task is active. Defaults to true.",
        },
      },
      required: ["name", "prompt", "cronExpression"],
    },
  },
  list_scheduled_tasks: {
    name: "list_scheduled_tasks",
    description:
      "List scheduled tasks visible to this Truss instance: its own workspace tasks (or every task in global mode), plus global tasks if includeGlobal is true and this workspace already has a global-access grant (see request_scheduled_task_global_access).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        includeGlobal: {
          type: "boolean",
          description: "Also include global (non-workspace) tasks when this workspace has a global-access grant. Defaults to true.",
        },
        enabledOnly: {
          type: "boolean",
          description: "Only include enabled tasks. Defaults to false.",
        },
      },
    },
  },
  get_scheduled_task: {
    name: "get_scheduled_task",
    description:
      "Get a single scheduled task by ID, including its cron schedule, prompt, model selection, and last/next run times. Global tasks are visible from a workspace-scoped instance only if it holds a global-access grant.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        taskId: {
          type: "string",
          description: "The scheduled task ID.",
          maxLength: 200,
        },
      },
      required: ["taskId"],
    },
  },
  update_scheduled_task: {
    name: "update_scheduled_task",
    description:
      "Update fields of a scheduled task that is visible in this instance's own scope (this instance's workspace, or any task in global mode). Only provided fields are changed.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        taskId: {
          type: "string",
          description: "The scheduled task ID to update.",
          maxLength: 200,
        },
        name: {
          type: "string",
          description: "New name. Caps at 200 characters.",
          maxLength: maxScheduledTaskNameLength,
        },
        prompt: {
          type: "string",
          description: "New prompt. Caps at 40000 characters.",
          maxLength: maxScheduledTaskPromptLength,
        },
        cronExpression: {
          type: "string",
          description: "New cron expression. Caps at 200 characters.",
          maxLength: maxScheduledTaskCronLength,
        },
        timezone: {
          type: "string",
          description: "New IANA timezone, or omit to leave unchanged.",
          maxLength: maxScheduledTaskTimezoneLength,
        },
        workingDirectory: {
          type: "string",
          description: "New working directory, or omit to leave unchanged.",
          maxLength: maxScheduledTaskWorkingDirectoryLength,
        },
        providerId: {
          type: "string",
          description: "New LLM provider ID override.",
        },
        modelId: {
          type: "string",
          description: "New LLM model ID override.",
        },
        allowOverlap: {
          type: "boolean",
          description: "Whether concurrent runs are allowed.",
        },
        enabled: {
          type: "boolean",
          description: "Whether the task is active.",
        },
      },
      required: ["taskId"],
    },
  },
  delete_scheduled_task: {
    name: "delete_scheduled_task",
    description:
      "Permanently delete a scheduled task that is visible in this instance's own scope, along with its run history.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        taskId: {
          type: "string",
          description: "The scheduled task ID to delete.",
          maxLength: 200,
        },
        confirmDeletion: {
          type: "boolean",
          description: "Must be true to delete the task. The tool fails without this explicit confirmation.",
        },
      },
      required: ["taskId", "confirmDeletion"],
    },
  },
  list_scheduled_task_runs: {
    name: "list_scheduled_task_runs",
    description:
      "List run history (status, summary, error, timestamps) for a scheduled task visible to this instance, most recent first.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        taskId: {
          type: "string",
          description: "The scheduled task ID.",
          maxLength: 200,
        },
        limit: {
          type: "integer",
          description: "Maximum runs to return. Defaults to 20 and caps at 100.",
          maximum: 100,
          minimum: 1,
        },
      },
      required: ["taskId"],
    },
  },
  verify_mcp_docs: {
    name: "verify_mcp_docs",
    description:
      "Run read-only checks that Truss MCP documentation resources are readable and that the global mcp.json file contains the first-party managed MCP server entries.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
};

export async function runTrussChatToolsMcpServer(
  options: TrussChatToolsMcpServerOptions = {},
): Promise<void> {
  const runtime = await createTrussChatToolsMcpRuntime(
    options.trussHomeDir,
    options.workspacePath,
  );

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
  runtime: TrussChatToolsRuntime,
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
  runtime: TrussChatToolsRuntime,
): Promise<JsonRpcResponse> {
  switch (request.method) {
    case "initialize":
      return jsonRpcResult(request.id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          resources: {},
          tools: {},
        },
        serverInfo: {
          name: "Truss Chat Tools",
          version: "0.1.0",
        },
      });
    case "tools/list":
      return jsonRpcResult(request.id, {
        tools: Object.values(trussChatToolDefinitions).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    case "tools/call":
      return handleToolCall(request, runtime);
    case "resources/list":
      return jsonRpcResult(request.id, {
        resources: documentationResourceDefinitions.map((resource) => ({ ...resource })),
      });
    case "resources/read":
      return handleResourceRead(request, runtime);
    case "prompts/list":
      return jsonRpcResult(request.id, { prompts: [] });
    default:
      return jsonRpcError(request.id, -32601, `Unknown method: ${request.method}`);
  }
}

async function handleToolCall(
  request: JsonRpcRequest,
  runtime: TrussChatToolsRuntime,
): Promise<JsonRpcResponse> {
  const params = normalizeToolCallParams(request.params);
  const toolName = typeof params.name === "string" ? trussChatToolNameForName(params.name) : null;

  if (!toolName) {
    return jsonRpcError(request.id, -32602, `Unknown Truss Chat Tools tool: ${String(params.name ?? "")}`);
  }

  const result = await executeTrussChatTool({
    args: normalizeToolArguments(params.arguments),
    meta: normalizeTrussChatToolCallMeta(params._meta),
    runtime,
    toolName,
  });

  return jsonRpcResult(request.id, {
    content: [
      {
        type: "text",
        text: result,
      },
    ],
  });
}

function handleResourceRead(
  request: JsonRpcRequest,
  runtime: TrussChatToolsRuntime,
): JsonRpcResponse {
  const params = normalizeResourceReadParams(request.params);
  const uri = typeof params.uri === "string" ? params.uri : "";
  const resource = documentationResourceDefinitions.find((item) => item.uri === uri);

  if (!resource) {
    return jsonRpcError(request.id, -32602, `Unknown Truss Chat Tools resource: ${uri}`);
  }

  return jsonRpcResult(request.id, {
    contents: [
      {
        uri: resource.uri,
        mimeType: resource.mimeType,
        text: resourceText(resource.uri, runtime),
      },
    ],
  });
}

export async function executeTrussChatTool({
  args,
  meta,
  runtime,
  toolName,
}: {
  args: Record<string, unknown>;
  meta?: TrussChatToolCallMeta;
  runtime: TrussChatToolsRuntime;
  toolName: TrussChatToolName;
}): Promise<string> {
  if (toolName === "list_conversations") {
    return jsonToolResult(listConversations(args, runtime));
  }

  if (toolName === "search_conversations") {
    return jsonToolResult(searchConversations(args, runtime));
  }

  if (toolName === "delete_conversation") {
    return jsonToolResult(deleteConversation(args, runtime));
  }

  if (toolName === "read_skill") {
    return jsonToolResult(await readSkill(args, runtime));
  }

  if (toolName === "review_mcp_config") {
    return jsonToolResult(await reviewMcpConfig(args, runtime));
  }

  if (toolName === "edit_mcp_config") {
    return jsonToolResult(await editMcpConfig(args, runtime));
  }

  if (toolName === "create_scheduled_task") {
    return jsonToolResult(createScheduledTask(args, runtime, meta));
  }

  if (toolName === "list_scheduled_tasks") {
    return jsonToolResult(listScheduledTasks(args, runtime));
  }

  if (toolName === "get_scheduled_task") {
    return jsonToolResult(getScheduledTask(args, runtime));
  }

  if (toolName === "update_scheduled_task") {
    return jsonToolResult(updateScheduledTask(args, runtime));
  }

  if (toolName === "delete_scheduled_task") {
    return jsonToolResult(deleteScheduledTask(args, runtime));
  }

  if (toolName === "list_scheduled_task_runs") {
    return jsonToolResult(listScheduledTaskRuns(args, runtime));
  }

  if (toolName === askUserChoiceToolName) {
    throw new Error(
      "ask_user_choice is handled by the Truss chat host because it opens a browser dialog and waits for the active user's response.",
    );
  }

  if (toolName === requestDirectoryAccessToolName) {
    throw new Error(
      "request_directory_access is handled by the Truss chat host because it opens a Security dialog, updates file-access grants for the active context after approval, and reloads MCP servers.",
    );
  }

  if (toolName === requestScheduledTaskGlobalAccessToolName) {
    throw new Error(
      "request_scheduled_task_global_access is handled by the Truss chat host because it opens a choice dialog and updates scheduled task global-access grants for the active workspace after approval.",
    );
  }

  return jsonToolResult(await verifyMcpDocs(runtime));
}

function listConversations(args: Record<string, unknown>, runtime: TrussChatToolsRuntime): unknown {
  const sessions = withMessageStats(
    runtime,
    runtime.agentSessions.listAgentSessions({
      includeSubAgents: booleanArg(args, "includeSubAgents", false),
      limit: numberArg(args, "limit", 20, 1, 200),
      search: optionalStringArg(args, "search", maxSearchQueryLength),
    }),
  );

  return {
    conversations: sessions.map(sessionSummaryForTool),
    count: sessions.length,
  };
}

function searchConversations(args: Record<string, unknown>, runtime: TrussChatToolsRuntime): unknown {
  const query = requiredStringArg(args, "query", maxSearchQueryLength);
  const matches = runtime.chatMessages.searchSessionMessages({
    includeSubAgents: booleanArg(args, "includeSubAgents", false),
    limit: numberArg(args, "limit", 20, 1, 50),
    query,
  });

  return {
    matches: matches.map((match) => ({
      conversation: sessionSummaryForTool(match.session),
      message: {
        id: match.message.id,
        role: match.message.role,
        createdAt: match.message.createdAt,
      },
      snippet: match.snippet,
    })),
    count: matches.length,
    query,
  };
}

function deleteConversation(args: Record<string, unknown>, runtime: TrussChatToolsRuntime): unknown {
  const sessionId = requiredStringArg(args, "sessionId", 200);

  if (booleanArg(args, "confirmDeletion", false) !== true) {
    throw new Error("delete_conversation requires confirmDeletion: true.");
  }

  const session = runtime.agentSessions.getAgentSession(sessionId);

  if (!session) {
    throw new Error(`Conversation does not exist: ${sessionId}`);
  }

  const deleted = runtime.agentSessions.deleteAgentSession(sessionId);

  if (!deleted) {
    throw new Error(`Conversation could not be deleted: ${sessionId}`);
  }

  return {
    deleted: true,
    conversation: sessionSummaryForTool(session),
  };
}

function createScheduledTask(
  args: Record<string, unknown>,
  runtime: TrussChatToolsRuntime,
  meta: TrussChatToolCallMeta | undefined,
): unknown {
  const name = requiredStringArg(args, "name", maxScheduledTaskNameLength);
  const prompt = requiredStringArg(args, "prompt", maxScheduledTaskPromptLength);
  const cronExpression = requiredStringArg(args, "cronExpression", maxScheduledTaskCronLength);

  validateCronExpressionArg(cronExpression);

  const timezone = optionalStringArg(args, "timezone", maxScheduledTaskTimezoneLength);
  const workingDirectory = optionalStringArg(args, "workingDirectory", maxScheduledTaskWorkingDirectoryLength);
  const fallbackModel = meta?.fallbackModel;
  const providerId = optionalStringArg(args, "providerId", 200) ?? fallbackModel?.providerId;
  const modelId = optionalStringArg(args, "modelId", 200) ?? fallbackModel?.modelId;

  if (!providerId || !modelId) {
    throw new Error(
      "providerId and modelId could not be determined. Pass them explicitly or call this tool from an assistant turn so its current model can be used as the default.",
    );
  }

  if (!getLlmProvider(providerId)) {
    throw new Error(`Unknown LLM provider: ${providerId}`);
  }

  const parameters: LlmGenerationParameters = fallbackModel?.parameters ?? {
    temperature: null,
    topP: null,
    topK: null,
    contextSize: null,
  };

  const input: ScheduledTaskCreate = {
    id: createId("task"),
    name,
    prompt,
    cronExpression,
    timezone,
    workingDirectory,
    // LLM-created scheduled tasks are always global, regardless of the
    // calling instance's own workspace scope (see requirement: "Scheduled
    // tasks should be able to be created by LLMs to be global").
    workspacePath: null,
    providerId,
    modelId,
    parameters,
    allowOverlap: booleanArg(args, "allowOverlap", false),
    enabled: booleanArg(args, "enabled", true),
    createdBy: "llm",
  };

  const task = runtime.scheduledTasks.createScheduledTask(input);

  return { task };
}

function listScheduledTasks(args: Record<string, unknown>, runtime: TrussChatToolsRuntime): unknown {
  const enabledOnly = booleanArg(args, "enabledOnly", false);
  const includeGlobal = booleanArg(args, "includeGlobal", true);
  const ownTasks = runtime.scheduledTasks.listScheduledTasks({ enabledOnly });

  if (!includeGlobal || !runtime.workspacePath) {
    // Unscoped (global) runtime instances already see every task via
    // listScheduledTasks(); no separate global merge is needed.
    return { tasks: ownTasks, count: ownTasks.length };
  }

  if (!runtime.scheduledTaskGrants.hasGlobalAccess(runtime.workspacePath)) {
    return {
      tasks: ownTasks,
      count: ownTasks.length,
      globalTasksHidden: true,
      hint:
        "Global scheduled tasks are hidden. Call request_scheduled_task_global_access to request permanent access from the user.",
    };
  }

  const globalTasks = runtime.scheduledTasks.listGlobalScheduledTasks({ enabledOnly });
  const tasks = [...ownTasks, ...globalTasks];

  return { tasks, count: tasks.length };
}

function findVisibleScheduledTask(
  taskId: string,
  runtime: TrussChatToolsRuntime,
): ScheduledTaskSummary {
  const ownTask = runtime.scheduledTasks.getScheduledTask(taskId);

  if (ownTask) {
    return ownTask;
  }

  if (runtime.workspacePath && runtime.scheduledTaskGrants.hasGlobalAccess(runtime.workspacePath)) {
    const globalTask = runtime.scheduledTasks.getGlobalScheduledTask(taskId);

    if (globalTask) {
      return globalTask;
    }
  }

  throw new Error(
    `Scheduled task not found or not visible from this scope: ${taskId}. If it is a global task, call request_scheduled_task_global_access first.`,
  );
}

function getScheduledTask(args: Record<string, unknown>, runtime: TrussChatToolsRuntime): unknown {
  const taskId = requiredStringArg(args, "taskId", 200);

  return { task: findVisibleScheduledTask(taskId, runtime) };
}

function updateScheduledTask(args: Record<string, unknown>, runtime: TrussChatToolsRuntime): unknown {
  const taskId = requiredStringArg(args, "taskId", 200);
  // Only tasks in this instance's own writable scope can be updated (its own
  // workspace, or every task from an unscoped/global instance). The read-only
  // global-access grant does not extend to writes.
  const existing = runtime.scheduledTasks.getScheduledTask(taskId);

  if (!existing) {
    throw new Error(`Scheduled task not found in this instance's scope: ${taskId}`);
  }

  const update: ScheduledTaskUpdate = {};

  if (Object.hasOwn(args, "name")) {
    update.name = requiredStringArg(args, "name", maxScheduledTaskNameLength);
  }

  if (Object.hasOwn(args, "prompt")) {
    update.prompt = requiredStringArg(args, "prompt", maxScheduledTaskPromptLength);
  }

  if (Object.hasOwn(args, "cronExpression")) {
    const cronExpression = requiredStringArg(args, "cronExpression", maxScheduledTaskCronLength);
    validateCronExpressionArg(cronExpression);
    update.cronExpression = cronExpression;
  }

  if (Object.hasOwn(args, "timezone")) {
    update.timezone = optionalStringArg(args, "timezone", maxScheduledTaskTimezoneLength);
  }

  if (Object.hasOwn(args, "workingDirectory")) {
    update.workingDirectory = optionalStringArg(args, "workingDirectory", maxScheduledTaskWorkingDirectoryLength);
  }

  if (Object.hasOwn(args, "providerId")) {
    const providerId = requiredStringArg(args, "providerId", 200);

    if (!getLlmProvider(providerId)) {
      throw new Error(`Unknown LLM provider: ${providerId}`);
    }

    update.providerId = providerId;
  }

  if (Object.hasOwn(args, "modelId")) {
    update.modelId = requiredStringArg(args, "modelId", 200);
  }

  if (Object.hasOwn(args, "allowOverlap")) {
    update.allowOverlap = booleanArg(args, "allowOverlap", existing.allowOverlap);
  }

  if (Object.hasOwn(args, "enabled")) {
    update.enabled = booleanArg(args, "enabled", existing.enabled);
  }

  const task = runtime.scheduledTasks.updateScheduledTask(taskId, update);

  if (!task) {
    throw new Error(`Scheduled task not found in this instance's scope: ${taskId}`);
  }

  return { task };
}

function deleteScheduledTask(args: Record<string, unknown>, runtime: TrussChatToolsRuntime): unknown {
  const taskId = requiredStringArg(args, "taskId", 200);

  if (booleanArg(args, "confirmDeletion", false) !== true) {
    throw new Error("delete_scheduled_task requires confirmDeletion: true.");
  }

  const existing = runtime.scheduledTasks.getScheduledTask(taskId);

  if (!existing) {
    throw new Error(`Scheduled task not found in this instance's scope: ${taskId}`);
  }

  const deleted = runtime.scheduledTasks.deleteScheduledTask(taskId);

  if (!deleted) {
    throw new Error(`Scheduled task could not be deleted: ${taskId}`);
  }

  return { deleted: true, task: existing };
}

function listScheduledTaskRuns(args: Record<string, unknown>, runtime: TrussChatToolsRuntime): unknown {
  const taskId = requiredStringArg(args, "taskId", 200);

  findVisibleScheduledTask(taskId, runtime);

  const runs = runtime.scheduledTaskRuns.listRuns(taskId, numberArg(args, "limit", 20, 1, 100));

  return { runs, count: runs.length, taskId };
}

function validateCronExpressionArg(value: string): void {
  try {
    new CronPattern(value);
  } catch (caught) {
    throw new Error(
      `Invalid cron expression: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }
}

async function reviewMcpConfig(
  args: Record<string, unknown>,
  runtime: TrussChatToolsRuntime,
): Promise<unknown> {
  const includeRawText = booleanArg(args, "includeRawText", true);
  const text = await readMcpConfigText(runtime);
  const parsed = parseMcpConfigText(text);

  return {
    mcpConfigPath: runtime.trussHome.mcpConfigPath,
    rawText: includeRawText ? truncateMcpConfigText(text) : undefined,
    serverCount: parsed.ok ? summarizeMcpServers(parsed.value).length : 0,
    servers: parsed.ok ? summarizeMcpServers(parsed.value) : [],
    validJson: parsed.ok,
    error: parsed.ok ? undefined : parsed.error,
  };
}

async function editMcpConfig(
  args: Record<string, unknown>,
  runtime: TrussChatToolsRuntime,
): Promise<unknown> {
  if (booleanArg(args, "confirmOverwrite", false) !== true) {
    throw new Error("edit_mcp_config requires confirmOverwrite: true.");
  }

  const mcpConfigText = requiredStringArg(args, "mcpConfigText", maxMcpConfigLength);
  const parsed = parseMcpConfigText(mcpConfigText);

  if (!parsed.ok) {
    throw new Error(parsed.error);
  }

  throw new Error(
    "edit_mcp_config is handled by the Truss host because it requires browser-mediated user approval before writing mcp.json.",
  );
}

async function verifyMcpDocs(runtime: TrussChatToolsRuntime): Promise<unknown> {
  const text = await readMcpConfigText(runtime);
  const parsed = parseMcpConfigText(text);
  const chatDoc = resourceText("truss://docs/chat-structure", runtime);
  const mcpDoc = resourceText("truss://docs/mcp", runtime);
  const scopesDoc = resourceText("truss://docs/scopes", runtime);
  const serverKeys = parsed.ok
    ? new Set(summarizeMcpServers(parsed.value).map((server) => server.key))
    : new Set<string>();
  const checks = [
    {
      id: "chat-structure-resource",
      ok:
        chatDoc.includes("agent_sessions") &&
        chatDoc.includes("chat_messages") &&
        chatDoc.includes("tool_calls_json"),
      detail: "Chat structure resource documents session and message storage.",
    },
    {
      id: "mcp-resource",
      ok:
        mcpDoc.includes("mcp.json") &&
        mcpDoc.includes("resources/read") &&
        mcpDoc.includes("Truss Chat Tools") &&
        mcpDoc.includes("Truss Command Runner") &&
        mcpDoc.includes("Truss Filesystem Tools") &&
        mcpDoc.includes("Truss Playwright Browser"),
      detail: "MCP resource documents global config, resources, and first-party servers.",
    },
    {
      id: "scopes-resource",
      ok:
        scopesDoc.includes("Global Scope") &&
        scopesDoc.includes("Workspace Scope") &&
        scopesDoc.includes("list_conversations"),
      detail: "Scopes resource documents global vs. workspace-scoped behavior.",
    },
    {
      id: "mcp-json-valid",
      ok: parsed.ok,
      detail: parsed.ok ? "mcp.json parses as JSON." : parsed.error,
    },
    {
      id: "first-party-web-tools",
      ok: serverKeys.has("truss-web-tools"),
      detail: "mcp.json contains the managed Truss Web Tools entry.",
    },
    {
      id: "first-party-playwright-mcp",
      ok: serverKeys.has("truss-playwright-mcp"),
      detail: "mcp.json contains the managed Truss Playwright Browser entry.",
    },
    {
      id: "first-party-chat-tools",
      ok: serverKeys.has("truss-chat-tools"),
      detail: "mcp.json contains the managed Truss Chat Tools entry.",
    },
    {
      id: "first-party-command-runner",
      ok: serverKeys.has("truss-command-runner"),
      detail: "mcp.json contains the managed Truss Command Runner entry.",
    },
    {
      id: "first-party-filesystem-tools",
      ok: serverKeys.has("truss-filesystem-tools"),
      detail: "mcp.json contains the managed Truss Filesystem Tools entry.",
    },
    {
      id: "first-party-orchestration-tools",
      ok: serverKeys.has("truss-orchestration-tools"),
      detail: "mcp.json contains the managed Truss Orchestration Tools entry.",
    },
  ];

  return {
    checks,
    mcpConfigPath: runtime.trussHome.mcpConfigPath,
    ok: checks.every((check) => check.ok),
    resources: documentationResourceDefinitions.map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      mimeType: resource.mimeType,
    })),
  };
}

async function readSkill(
  args: Record<string, unknown>,
  runtime: TrussChatToolsRuntime,
): Promise<unknown> {
  const skillId = requiredStringArg(args, "skillId", maxSkillIdLength);
  const discovery = await discoverSkills({ workspacePath: runtime.workspacePath });
  const skill = discovery.skills.find((item) => item.id === skillId);

  if (!skill) {
    throw new Error(
      [
        `No discovered skill found for skillId: ${skillId}.`,
        `Available skills: ${availableSkillList(discovery.skills)}.`,
      ].join(" "),
    );
  }

  return {
    skill: skillSummaryForTool(skill),
    body: skill.body,
  };
}

function withMessageStats(
  runtime: TrussChatToolsRuntime,
  sessions: AgentSessionSummary[],
): AgentSessionSummary[] {
  const stats = runtime.chatMessages.listSessionStats(sessions.map((session) => session.id));

  return sessions.map((session) => {
    const sessionStats = stats.get(session.id);

    return {
      ...session,
      messageCount: sessionStats?.messageCount ?? 0,
      wordCount: sessionStats?.wordCount ?? 0,
    };
  });
}

function sessionSummaryForTool(session: AgentSessionSummary): Record<string, unknown> {
  return {
    id: session.id,
    type: session.type,
    parentSessionId: session.parentSessionId,
    title: session.title ?? "Untitled conversation",
    providerId: session.providerId,
    modelId: session.modelId,
    messageCount: session.messageCount,
    wordCount: session.wordCount,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    workspacePath: session.workspacePath,
  };
}

function skillSummaryForTool(skill: SkillDocument): Record<string, unknown> {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    path: skill.path,
    scope: skill.scope,
    source: skill.source,
    tokenEstimate: skill.tokenEstimate,
  };
}

function availableSkillList(skills: SkillDocument[]): string {
  if (skills.length === 0) {
    return "none";
  }

  const formatted = skills
    .slice(0, 20)
    .map((skill) => `${skill.id} (${skill.name}, ${skill.scope}/${skill.source})`);

  if (skills.length > formatted.length) {
    formatted.push(`${skills.length - formatted.length} more`);
  }

  return formatted.join("; ");
}

async function readMcpConfigText(runtime: TrussChatToolsRuntime): Promise<string> {
  const file = Bun.file(runtime.trussHome.mcpConfigPath);

  return (await file.exists()) ? await file.text() : "{\n  \"mcpServers\": {}\n}\n";
}

function parseMcpConfigText(
  text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(text) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "mcp.json must contain a JSON object." };
    }

    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (caught) {
    return {
      ok: false,
      error: `mcp.json is not valid JSON: ${caught instanceof Error ? caught.message : String(caught)}`,
    };
  }
}

function summarizeMcpServers(config: Record<string, unknown>): Array<Record<string, unknown>> {
  const rawServers = config.mcpServers ?? config.servers;

  if (Array.isArray(rawServers)) {
    return rawServers.flatMap((server, index) => summarizeMcpServer(String(index), server));
  }

  if (!rawServers || typeof rawServers !== "object") {
    return [];
  }

  return Object.entries(rawServers).flatMap(([key, server]) => summarizeMcpServer(key, server));
}

function summarizeMcpServer(key: string, value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const server = value as Record<string, unknown>;
  const env = server.env && typeof server.env === "object" && !Array.isArray(server.env)
    ? Object.keys(server.env as Record<string, unknown>)
    : [];

  return [
    {
      key,
      name: stringValue(server.name) ?? key,
      disabled: server.disabled === true,
      disabledReason: stringValue(server.disabledReason) ?? stringValue(server._trussDisabledReason),
      transport: stringValue(server.type) ?? stringValue(server.transport) ?? inferTransport(server),
      command: stringValue(server.command),
      args: stringArrayValue(server.args),
      cwd: stringValue(server.cwd),
      url: stringValue(server.url),
      envKeys: env,
      trussManaged: server._trussManaged === true,
      trussManagedOptOut: server._trussManaged === false,
    },
  ];
}

function inferTransport(server: Record<string, unknown>): string {
  if (typeof server.command === "string") {
    return "stdio";
  }

  if (typeof server.url === "string") {
    return "http-sse";
  }

  return "unknown";
}

function resourceText(uri: string, runtime: TrussChatToolsRuntime): string {
  if (uri === "truss://docs/chat-structure") {
    return chatStructureDocumentation(runtime);
  }

  if (uri === "truss://docs/mcp") {
    return mcpDocumentation(runtime);
  }

  if (uri === "truss://docs/scopes") {
    return scopesDocumentation(runtime);
  }

  throw new Error(`Unknown Truss Chat Tools resource: ${uri}`);
}

function chatStructureDocumentation(runtime: TrussChatToolsRuntime): string {
  return readResourceFile("chat-structure.md")
    .replace("{{dbPath}}", runtime.trussHome.dbPath)
    .replace(
      "{{runtimeInfo}}",
      runtime.workspacePath
        ? `This Truss Chat Tools process is running with conversation access scoped to \`${runtime.workspacePath}\`.`
        : "This Truss Chat Tools process is running with conversation access across all workspaces.",
    );
}

function mcpDocumentation(runtime: TrussChatToolsRuntime): string {
  return readResourceFile("mcp-architecture.md").replace(
    "{{mcpConfigPath}}",
    runtime.trussHome.mcpConfigPath,
  );
}

function scopesDocumentation(_runtime: TrussChatToolsRuntime): string {
  return readResourceFile("scopes.md");
}

function readResourceFile(filename: string): string {
  const path = join(import.meta.dir, "resources", filename);
  return readFileSync(path, "utf-8");
}

function normalizeToolCallParams(value: unknown): ToolCallParams {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeToolArguments(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeResourceReadParams(value: unknown): ResourceReadParams {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeTrussChatToolCallMeta(value: unknown): TrussChatToolCallMeta {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const source = value as Record<string, unknown>;
  const fallbackModel = normalizeFallbackModel(source.fallbackModel);

  return fallbackModel ? { fallbackModel } : {};
}

function normalizeFallbackModel(value: unknown): ToolExecutionModelReference | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const modelId = typeof source.modelId === "string" ? source.modelId.trim() : "";
  const providerId = typeof source.providerId === "string" ? source.providerId.trim() : "";
  const parameters = normalizeGenerationParameters(source.parameters);

  if (!modelId || !providerId || !parameters) {
    return undefined;
  }

  return { modelId, parameters, providerId };
}

function normalizeGenerationParameters(value: unknown): LlmGenerationParameters | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const source = value as Record<string, unknown>;

  return {
    temperature: nullableNumber(source.temperature),
    topP: nullableNumber(source.topP),
    topK: nullableNumber(source.topK),
    contextSize: nullableNumber(source.contextSize),
  };
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function trussChatToolNameForName(name: string): TrussChatToolName | null {
  return Object.hasOwn(trussChatToolDefinitions, name) ? (name as TrussChatToolName) : null;
}

function requiredStringArg(
  args: Record<string, unknown>,
  key: string,
  maxLength: number,
): string {
  const value = optionalStringArg(args, key, maxLength);

  if (!value) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

function optionalStringArg(
  args: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null {
  const value = args[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${key} must be a string.`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new Error(`${key} is too long.`);
  }

  return trimmed || null;
}

function booleanArg(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = args[key];

  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean.`);
  }

  return value;
}

function numberArg(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = args[key];

  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a number.`);
  }

  return Math.min(Math.max(min, Math.floor(value)), max);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length > 0 ? strings : undefined;
}

function truncateMcpConfigText(value: string): string {
  return value.length <= maxMcpConfigOutputLength
    ? value
    : `${value.slice(0, maxMcpConfigOutputLength).trimEnd()}\n\n[truncated]`;
}

function jsonToolResult(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function jsonRpcResult(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function jsonRpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
): JsonRpcErrorResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

function writeJsonRpcMessage(message: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function* readStdinLines(): AsyncIterable<string> {
  const decoder = new TextDecoderStream();
  const lineStream = Bun.stdin.stream().pipeThrough(decoder);
  let buffered = "";

  for await (const chunk of lineStream) {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";

    for (const line of lines) {
      yield line;
    }
  }

  if (buffered.trim()) {
    yield buffered;
  }
}

function isJsonRpcRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return "method" in message && "id" in message;
}
