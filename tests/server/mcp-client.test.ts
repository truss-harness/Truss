import { describe, expect, it } from "bun:test";
import { McpConnection } from "../../src/server/mcp/client.ts";
import type { JsonRpcMessage } from "../../src/server/mcp/json-rpc.ts";
import type { McpTransport } from "../../src/server/mcp/transports/types.ts";
import type { McpServerDefinition } from "../../src/server/mcp/types.ts";

describe("McpConnection", () => {
  it("preserves JSON-RPC error codes and data in request failures", async () => {
    const transport = new ErroringTransport();
    const connection = new McpConnection(transport);

    await expect(connection.request("tools/call", { name: "load_webpage" }, 1_000)).rejects.toThrow(
      'MCP error -32602: Bad params ({"field":"url"})',
    );

    await connection.close();
  });

  it("sends cancellation notifications for aborted requests", async () => {
    const transport = new HangingTransport();
    const connection = new McpConnection(transport);
    const controller = new AbortController();
    const request = connection.request(
      "tools/call",
      { name: "load_webpage" },
      1_000,
      controller.signal,
    );

    await waitUntil(() => transport.sent.some(isJsonRpcRequest));

    controller.abort();

    await expect(request).rejects.toThrow('MCP request "tools/call" was stopped');
    await waitUntil(() => transport.sent.some(isCancellationNotification));

    const notification = transport.sent.find(isCancellationNotification);

    expect(notification?.params).toEqual({
      reason: 'MCP request "tools/call" was stopped.',
      requestId: "test:1",
    });

    await connection.close();
  });
});

class ErroringTransport implements McpTransport {
  readonly definition: McpServerDefinition = {
    configPath: "mcp.json",
    id: "test",
    name: "Test MCP",
    source: "test",
    transport: "stdio",
    trussManaged: false,
  };

  readonly sent: JsonRpcMessage[] = [];
  #messages: Array<JsonRpcMessage | null> = [];
  #pendingResolve: ((message: JsonRpcMessage | null) => void) | null = null;

  async send(message: JsonRpcMessage): Promise<void> {
    this.sent.push(message);

    if ("method" in message && "id" in message) {
      this.push({
        error: {
          code: -32602,
          data: { field: "url" },
          message: "Bad params",
        },
        id: message.id,
        jsonrpc: "2.0",
      });
    }
  }

  async close(): Promise<void> {
    this.push(null);
  }

  async *messages(): AsyncIterable<JsonRpcMessage> {
    while (true) {
      const message = await this.nextMessage();

      if (message === null) {
        return;
      }

      yield message;
    }
  }

  private push(message: JsonRpcMessage | null): void {
    if (this.#pendingResolve) {
      const resolve = this.#pendingResolve;

      this.#pendingResolve = null;
      resolve(message);
      return;
    }

    this.#messages.push(message);
  }

  private nextMessage(): Promise<JsonRpcMessage | null> {
    const message = this.#messages.shift();

    if (message !== undefined) {
      return Promise.resolve(message);
    }

    return new Promise((resolve) => {
      this.#pendingResolve = resolve;
    });
  }
}

class HangingTransport implements McpTransport {
  readonly definition: McpServerDefinition = {
    configPath: "mcp.json",
    id: "test",
    name: "Test MCP",
    source: "test",
    transport: "stdio",
    trussManaged: false,
  };

  readonly sent: JsonRpcMessage[] = [];
  #messages: Array<JsonRpcMessage | null> = [];
  #pendingResolve: ((message: JsonRpcMessage | null) => void) | null = null;

  async send(message: JsonRpcMessage): Promise<void> {
    this.sent.push(message);
  }

  async close(): Promise<void> {
    this.push(null);
  }

  async *messages(): AsyncIterable<JsonRpcMessage> {
    while (true) {
      const message = await this.nextMessage();

      if (message === null) {
        return;
      }

      yield message;
    }
  }

  private push(message: JsonRpcMessage | null): void {
    if (this.#pendingResolve) {
      const resolve = this.#pendingResolve;

      this.#pendingResolve = null;
      resolve(message);
      return;
    }

    this.#messages.push(message);
  }

  private nextMessage(): Promise<JsonRpcMessage | null> {
    const message = this.#messages.shift();

    if (message !== undefined) {
      return Promise.resolve(message);
    }

    return new Promise((resolve) => {
      this.#pendingResolve = resolve;
    });
  }
}

function isJsonRpcRequest(value: JsonRpcMessage): boolean {
  return "method" in value && "id" in value;
}

function isCancellationNotification(value: JsonRpcMessage): value is {
  jsonrpc: "2.0";
  method: "notifications/cancelled";
  params: Record<string, unknown>;
} {
  return (
    "method" in value &&
    !("id" in value) &&
    value.method === "notifications/cancelled" &&
    value.params !== undefined &&
    !Array.isArray(value.params) &&
    typeof value.params === "object"
  );
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 1_000) {
    if (condition()) {
      return;
    }

    await sleep(10);
  }

  throw new Error("Timed out waiting for condition.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
