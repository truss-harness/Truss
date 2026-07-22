import process from "node:process";
import type {
  JsonRpcErrorResponse,
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
} from "../../json-rpc.ts";
import { parseJsonRpcLine } from "../../json-rpc.ts";
import {
  commandRunnerToolDefinitions,
  commandRunnerToolList,
  commandRunnerToolNameForName,
} from "../../../tools/command-runner.ts";

interface ToolCallParams {
  arguments?: unknown;
  name?: unknown;
}

export async function runTrussCommandRunnerMcpServer(): Promise<void> {
  for await (const line of readStdinLines()) {
    const message = parseJsonRpcLine(line);

    if (!message) {
      continue;
    }

    const response = await handleMessage(message);

    if (response) {
      writeJsonRpcMessage(response);
    }
  }
}

function handleMessage(message: JsonRpcMessage): Promise<JsonRpcResponse | null> {
  if (!isJsonRpcRequest(message)) {
    return Promise.resolve(null);
  }

  return handleRequest(message).catch((caught) =>
    jsonRpcError(message.id, -32603, caught instanceof Error ? caught.message : String(caught)),
  );
}

async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  switch (request.method) {
    case "initialize":
      return jsonRpcResult(request.id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "Truss Command Runner",
          version: "0.1.0",
        },
      });
    case "tools/list":
      return jsonRpcResult(request.id, {
        tools: commandRunnerToolList().map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.parameters,
        })),
      });
    case "tools/call":
      return handleToolCall(request);
    case "resources/list":
      return jsonRpcResult(request.id, { resources: [] });
    case "prompts/list":
      return jsonRpcResult(request.id, { prompts: [] });
    default:
      return jsonRpcError(request.id, -32601, `Unknown method: ${request.method}`);
  }
}

function handleToolCall(request: JsonRpcRequest): JsonRpcResponse {
  const params = normalizeToolCallParams(request.params);
  const toolName = typeof params.name === "string" ? commandRunnerToolNameForName(params.name) : null;

  if (!toolName) {
    return jsonRpcError(request.id, -32602, `Unknown Truss Command Runner tool: ${String(params.name ?? "")}`);
  }

  if (!Object.hasOwn(commandRunnerToolDefinitions, toolName)) {
    return jsonRpcError(request.id, -32602, `Unknown Truss Command Runner tool: ${toolName}`);
  }

  return jsonRpcResult(request.id, {
    content: [
      {
        type: "text",
        text:
          "This Truss Command Runner tool is handled by the Truss chat host so it can enforce active session guards, browser approvals, and terminal lifecycle state.",
      },
    ],
    isError: true,
  });
}

function normalizeToolCallParams(value: unknown): ToolCallParams {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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
