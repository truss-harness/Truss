import process from "node:process";
import type {
  ChatToolSettings,
  LlmGenerationParameters,
} from "../../../../shared/protocol.ts";
import type {
  JsonRpcErrorResponse,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from "../../json-rpc.ts";
import { parseJsonRpcLine } from "../../json-rpc.ts";
import {
  executeTrussWebTool,
  resolveToolExecutionModel,
  trussWebToolDefinitions,
  trussWebToolList,
  type ToolExecutionModelReference,
  type TrussWebToolRuntime,
} from "../../../tools/truss-web-tools.ts";
import { createTrussWebToolsMcpRuntime } from "./runtime.ts";

interface TrussWebToolsMcpServerOptions {
  trussHomeDir?: string;
}

interface ToolCallParams {
  _meta?: unknown;
  arguments?: unknown;
  name?: unknown;
}

interface TrussToolCallMeta {
  fallbackModel?: ToolExecutionModelReference;
  progressToken?: string | number;
  settings?: Pick<ChatToolSettings, "sanitizerModelId" | "sanitizerProviderId">;
}

type JsonRpcWriter = (message: JsonRpcResponse | JsonRpcNotification) => void;

export async function runTrussWebToolsMcpServer(
  options: TrussWebToolsMcpServerOptions = {},
): Promise<void> {
  const { close, runtime } = await createTrussWebToolsMcpRuntime(options.trussHomeDir);

  await runTrussWebToolsMcpMessageLoop(readStdinLines(), runtime, {
    close,
    write: writeJsonRpcMessage,
  });
}

export async function runTrussWebToolsMcpMessageLoop(
  lines: AsyncIterable<string>,
  runtime: TrussWebToolRuntime,
  {
    close,
    write,
  }: {
    close(): Promise<void>;
    write: JsonRpcWriter;
  },
): Promise<void> {
  const pendingRequests = new Set<Promise<void>>();
  const abortControllersByRequestId = new Map<string, AbortController>();

  try {
    for await (const line of lines) {
      const message = parseJsonRpcLine(line);

      if (!message) {
        continue;
      }

      if (isCancellationNotification(message)) {
        const requestId = cancellationRequestId(message.params);
        const controller = requestId
          ? abortControllersByRequestId.get(String(requestId))
          : undefined;

        controller?.abort();
        continue;
      }

      const abortController = isJsonRpcRequest(message) ? new AbortController() : null;

      if (abortController) {
        abortControllersByRequestId.set(String(message.id), abortController);
      }

      const task = dispatchMessage(message, runtime, write, abortController?.signal).catch((caught) => {
        if (isJsonRpcRequest(message)) {
          write(
            jsonRpcError(
              message.id,
              -32603,
              caught instanceof Error ? caught.message : String(caught),
            ),
          );
          return;
        }

        console.error(caught instanceof Error ? caught.stack ?? caught.message : String(caught));
      });

      pendingRequests.add(task);
      void task.finally(() => {
        pendingRequests.delete(task);

        if (isJsonRpcRequest(message)) {
          abortControllersByRequestId.delete(String(message.id));
        }
      });
    }

    await Promise.allSettled(pendingRequests);
  } finally {
    await close();
  }
}

async function dispatchMessage(
  message: JsonRpcMessage,
  runtime: TrussWebToolRuntime,
  write: JsonRpcWriter,
  signal?: AbortSignal,
): Promise<void> {
  const response = await handleMessage(message, runtime, write, signal);

  if (response) {
    write(response);
  }
}

function handleMessage(
  message: JsonRpcMessage,
  runtime: TrussWebToolRuntime,
  write: JsonRpcWriter,
  signal?: AbortSignal,
): Promise<JsonRpcResponse | null> {
  if (!isJsonRpcRequest(message)) {
    return Promise.resolve(null);
  }

  return handleRequest(message, runtime, write, signal).catch((caught) =>
    jsonRpcError(message.id, -32603, caught instanceof Error ? caught.message : String(caught)),
  );
}

async function handleRequest(
  request: JsonRpcRequest,
  runtime: TrussWebToolRuntime,
  write: JsonRpcWriter,
  signal?: AbortSignal,
): Promise<JsonRpcResponse> {
  switch (request.method) {
    case "initialize":
      return jsonRpcResult(request.id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "Truss Web Tools",
          version: "0.1.0",
        },
      });
    case "tools/list":
      return jsonRpcResult(request.id, {
        tools: trussWebToolList().map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.parameters,
        })),
      });
    case "tools/call":
      return handleToolCall(request, runtime, write, signal);
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
  runtime: TrussWebToolRuntime,
  write: JsonRpcWriter,
  signal?: AbortSignal,
): Promise<JsonRpcResponse> {
  const params = normalizeToolCallParams(request.params);
  const toolName = typeof params.name === "string" ? params.name : "";

  if (!Object.hasOwn(trussWebToolDefinitions, toolName)) {
    return jsonRpcError(request.id, -32602, `Unknown Truss Web Tools tool: ${toolName}`);
  }

  const args = normalizeToolArguments(params.arguments);
  const meta = normalizeTrussMeta(params._meta);
  const fallbackModel = resolveToolExecutionModel(runtime, meta.fallbackModel);
  const result = await executeTrussWebTool({
    fallbackModel,
    onProgress: progressReporter(meta.progressToken, write),
    runtime,
    signal,
    settings: meta.settings ?? {
      sanitizerModelId: null,
      sanitizerProviderId: null,
    },
    toolCall: {
      arguments: args,
      name: toolName,
    },
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

function normalizeToolCallParams(value: unknown): ToolCallParams {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isCancellationNotification(message: JsonRpcMessage): message is JsonRpcNotification {
  return (
    "method" in message &&
    !("id" in message) &&
    message.method === "notifications/cancelled"
  );
}

function cancellationRequestId(params: JsonRpcNotification["params"]): string | number | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }

  const requestId = (params as Record<string, unknown>).requestId;

  return typeof requestId === "string" || typeof requestId === "number" ? requestId : null;
}

function normalizeToolArguments(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeTrussMeta(value: unknown): TrussToolCallMeta {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const source = value as Record<string, unknown>;
  const fallbackModel = normalizeFallbackModel(source.fallbackModel);
  const progressToken = normalizeProgressToken(source.progressToken);
  const settings = normalizeSettings(source.settings);

  return {
    ...(fallbackModel ? { fallbackModel } : {}),
    ...(progressToken !== undefined ? { progressToken } : {}),
    ...(settings ? { settings } : {}),
  };
}

function normalizeProgressToken(value: unknown): string | number | undefined {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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

  return {
    modelId,
    parameters,
    providerId,
  };
}

function normalizeSettings(
  value: unknown,
): Pick<ChatToolSettings, "sanitizerModelId" | "sanitizerProviderId"> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;

  return {
    sanitizerModelId:
      typeof source.sanitizerModelId === "string" && source.sanitizerModelId.trim()
        ? source.sanitizerModelId.trim()
        : null,
    sanitizerProviderId:
      typeof source.sanitizerProviderId === "string" && source.sanitizerProviderId.trim()
        ? source.sanitizerProviderId.trim()
        : null,
  };
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

function progressReporter(
  progressToken: string | number | undefined,
  write: JsonRpcWriter,
): Parameters<typeof executeTrussWebTool>[0]["onProgress"] {
  if (progressToken === undefined) {
    return undefined;
  }

  return (progress) =>
    write({
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: {
        progressToken,
        progress: progress.percent,
        total: 100,
        ...(progress.message ? { message: progress.message } : {}),
      },
    });
}

function writeJsonRpcMessage(message: JsonRpcResponse | JsonRpcNotification): void {
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
