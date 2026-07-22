import process from "node:process";
import type {
  JsonRpcErrorResponse,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from "../../json-rpc.ts";
import { parseJsonRpcLine } from "../../json-rpc.ts";
import type {
  CamoufoxBrowser,
  CamoufoxPlaywrightMcpRequest,
  CamoufoxPlaywrightMcpResponse,
} from "../../../utils/camoufox-browser.ts";
import {
  createTrussPlaywrightMcpRuntime,
  type TrussPlaywrightMcpRuntimeState,
} from "./runtime.ts";

interface TrussPlaywrightMcpServerOptions {
  trussHomeDir?: string;
}

interface ToolCallParams {
  _meta?: unknown;
  arguments?: unknown;
  name?: unknown;
}

type JsonRpcWriter = (message: JsonRpcResponse | JsonRpcNotification) => void;

export async function runTrussPlaywrightMcpServer(
  options: TrussPlaywrightMcpServerOptions = {},
): Promise<void> {
  const { close, runtime } = await createTrussPlaywrightMcpRuntime(options.trussHomeDir);

  await runTrussPlaywrightMcpMessageLoop(readStdinLines(), runtime, {
    close,
    write: writeJsonRpcMessage,
  });
}

export async function runTrussPlaywrightMcpMessageLoop(
  lines: AsyncIterable<string>,
  runtime: TrussPlaywrightMcpRuntimeState,
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
  runtime: TrussPlaywrightMcpRuntimeState,
  write: JsonRpcWriter,
  signal?: AbortSignal,
): Promise<void> {
  const response = await handleMessage(message, runtime, signal);

  if (response) {
    write(response);
  }
}

function handleMessage(
  message: JsonRpcMessage,
  runtime: TrussPlaywrightMcpRuntimeState,
  signal?: AbortSignal,
): Promise<JsonRpcResponse | null> {
  if (!isJsonRpcRequest(message)) {
    return Promise.resolve(null);
  }

  return handleRequest(message, runtime, signal).catch((caught) =>
    jsonRpcError(message.id, -32603, caught instanceof Error ? caught.message : String(caught)),
  );
}

async function handleRequest(
  request: JsonRpcRequest,
  runtime: TrussPlaywrightMcpRuntimeState,
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
          name: "Truss Playwright Browser",
          version: "0.1.0",
        },
      });
    case "tools/list":
      return handleToolsList(request, runtime, signal);
    case "tools/call":
      return handleToolCall(request, runtime, signal);
    case "resources/list":
      return jsonRpcResult(request.id, { resources: [] });
    case "prompts/list":
      return jsonRpcResult(request.id, { prompts: [] });
    default:
      return jsonRpcError(request.id, -32601, `Unknown method: ${request.method}`);
  }
}

async function handleToolsList(
  request: JsonRpcRequest,
  runtime: TrussPlaywrightMcpRuntimeState,
  signal?: AbortSignal,
): Promise<JsonRpcResponse> {
  const settings = runtime.getSettings();

  if (!settings.enabled) {
    return jsonRpcResult(request.id, { tools: [] });
  }

  const response = await callPlaywrightMcp(runtime.getBrowser(), {
    jsonrpc: "2.0",
    id: request.id,
    method: "tools/list",
    params: request.params,
  }, signal);

  if (isJsonRpcErrorResponse(response)) {
    return response;
  }

  const allowlist = parsePlaywrightMcpToolAllowlist(settings.tools);
  const result = response.result && typeof response.result === "object" && !Array.isArray(response.result)
    ? (response.result as Record<string, unknown>)
    : {};
  const tools = Array.isArray(result.tools)
    ? result.tools.filter((tool) => isAllowedTool(toolName(tool), allowlist))
    : [];

  return jsonRpcResult(request.id, { ...result, tools });
}

async function handleToolCall(
  request: JsonRpcRequest,
  runtime: TrussPlaywrightMcpRuntimeState,
  signal?: AbortSignal,
): Promise<JsonRpcResponse> {
  const settings = runtime.getSettings();

  if (!settings.enabled) {
    return jsonRpcError(
      request.id,
      -32000,
      "Truss Playwright Browser is disabled. Enable mcp.playwright_mcp_enabled in Truss MCP Settings and reload MCP servers.",
    );
  }

  const params = normalizeToolCallParams(request.params);
  const toolNameValue = typeof params.name === "string" ? params.name.trim() : "";
  const allowlist = parsePlaywrightMcpToolAllowlist(settings.tools);

  if (!isAllowedTool(toolNameValue, allowlist)) {
    return jsonRpcError(
      request.id,
      -32602,
      `Playwright MCP tool is not allowed by mcp.playwright_mcp_tools: ${toolNameValue}`,
    );
  }

  const response = await callPlaywrightMcp(runtime.getBrowser(), {
    jsonrpc: "2.0",
    id: request.id,
    method: "tools/call",
    params: {
      ...params,
      arguments: normalizeToolArguments(params.arguments),
      name: toolNameValue,
    },
  }, signal);

  return normalizeMcpResponse(response, request.id);
}

async function callPlaywrightMcp(
  browser: CamoufoxBrowser | null,
  request: CamoufoxPlaywrightMcpRequest,
  signal?: AbortSignal,
): Promise<CamoufoxPlaywrightMcpResponse> {
  if (!browser || typeof browser.callPlaywrightMcp !== "function") {
    throw new Error("Camoufox Playwright MCP bridge is not available.");
  }

  return browser.callPlaywrightMcp(request, { signal });
}

export function parsePlaywrightMcpToolAllowlist(value: string): Set<string> | null {
  const normalized = value.trim();

  if (!normalized || normalized === "*") {
    return null;
  }

  return new Set(
    normalized
      .split(/[,\s]+/u)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function isAllowedTool(toolName: string | null, allowlist: Set<string> | null): boolean {
  if (!toolName) {
    return false;
  }

  return allowlist === null || allowlist.has(toolName);
}

function toolName(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const name = (value as Record<string, unknown>).name;

  return typeof name === "string" && name.trim() ? name.trim() : null;
}

function normalizeToolCallParams(value: unknown): ToolCallParams {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeToolArguments(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeMcpResponse(
  response: CamoufoxPlaywrightMcpResponse,
  fallbackId: JsonRpcRequest["id"],
): JsonRpcResponse {
  if (isJsonRpcErrorResponse(response)) {
    return response;
  }

  if (isJsonRpcSuccessResponse(response)) {
    return response;
  }

  return jsonRpcError(fallbackId, -32603, "Playwright MCP bridge returned an invalid response.");
}

function isJsonRpcSuccessResponse(value: CamoufoxPlaywrightMcpResponse): value is JsonRpcResponse {
  return (
    value &&
    value.jsonrpc === "2.0" &&
    (typeof value.id === "string" || typeof value.id === "number" || value.id === null) &&
    Object.hasOwn(value, "result")
  );
}

function isJsonRpcErrorResponse(value: CamoufoxPlaywrightMcpResponse): value is JsonRpcErrorResponse {
  if (
    !value ||
    value.jsonrpc !== "2.0" ||
    !(typeof value.id === "string" || typeof value.id === "number" || value.id === null) ||
    !Object.hasOwn(value, "error")
  ) {
    return false;
  }

  const error = value.error;

  return (
    Boolean(error) &&
    typeof error === "object" &&
    !Array.isArray(error) &&
    typeof (error as Record<string, unknown>).message === "string"
  );
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
