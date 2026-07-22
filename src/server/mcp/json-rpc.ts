export type JsonRpcId = string | number;
export type JsonRpcParams = Record<string, unknown> | unknown[];

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: JsonRpcParams;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: JsonRpcParams;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export function createJsonRpcRequest(
  id: JsonRpcId,
  method: string,
  params?: JsonRpcParams,
): JsonRpcRequest {
  return params === undefined
    ? { jsonrpc: "2.0", id, method }
    : { jsonrpc: "2.0", id, method, params };
}

export function createJsonRpcNotification(
  method: string,
  params?: JsonRpcParams,
): JsonRpcNotification {
  return params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params };
}

export function isJsonRpcResponse(message: JsonRpcMessage): message is JsonRpcResponse {
  return "id" in message && ("result" in message || "error" in message);
}

export function serializeJsonRpcMessage(message: JsonRpcMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export function parseJsonRpcLine(line: string): JsonRpcMessage | null {
  try {
    const parsed = JSON.parse(line) as unknown;

    if (!parsed || typeof parsed !== "object" || (parsed as { jsonrpc?: unknown }).jsonrpc !== "2.0") {
      return null;
    }

    return parsed as JsonRpcMessage;
  } catch {
    return null;
  }
}
