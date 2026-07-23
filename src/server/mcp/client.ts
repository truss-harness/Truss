import { mcpTransportFactories } from "./transports/registry.ts";
import type { McpTransport } from "./transports/types.ts";
import type { McpServerDefinition } from "./types.ts";
import type {
  JsonRpcErrorResponse,
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcParams,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./json-rpc.ts";
import { createJsonRpcNotification, createJsonRpcRequest, isJsonRpcResponse } from "./json-rpc.ts";

export interface McpClientHostOptions {
  env: NodeJS.ProcessEnv;
  managedBrowserEnv?: NodeJS.ProcessEnv;
  onNotification?(notification: McpClientNotification): void | Promise<void>;
}

export interface McpClientNotification {
  method: string;
  params?: JsonRpcParams;
  serverId: string;
}

export interface McpProgressNotification {
  message?: string;
  progress: number;
  total?: number;
}

export interface McpRequestOptions {
  onProgress?(progress: McpProgressNotification): void;
}

interface PendingMcpRequest {
  abortListener?: () => void;
  onProgress?: (progress: McpProgressNotification) => void;
  progressToken?: JsonRpcId;
  reject(error: Error): void;
  resolve(value: unknown): void;
  signal?: AbortSignal;
  timer: ReturnType<typeof setTimeout>;
}

export class McpClientHost {
  readonly #connections = new Map<string, McpConnection>();

  constructor(readonly options: McpClientHostOptions) {}

  async connect(definition: McpServerDefinition): Promise<McpConnection> {
    const factory = mcpTransportFactories.find((candidate) => candidate.supports(definition));

    if (!factory) {
      throw new Error(`No MCP transport supports "${definition.transport}".`);
    }

    const transport = await factory.create(definition, {
      env: this.options.env,
      managedBrowserEnv: this.options.managedBrowserEnv,
    });
    const connection = new McpConnection(transport, this.options.onNotification);

    this.#connections.set(definition.id, connection);
    return connection;
  }

  get(serverId: string): McpConnection | undefined {
    return this.#connections.get(serverId);
  }

  async close(serverId?: string): Promise<void> {
    if (serverId) {
      const connection = this.#connections.get(serverId);

      this.#connections.delete(serverId);
      await connection?.close();
      return;
    }

    await Promise.all([...this.#connections.values()].map((connection) => connection.close()));
    this.#connections.clear();
  }
}

export class McpConnection {
  readonly #pending = new Map<string, PendingMcpRequest>();
  #closed = false;
  #nextRequestId = 0;

  constructor(
    readonly transport: McpTransport,
    readonly onNotification?: McpClientHostOptions["onNotification"],
  ) {
    void this.#readMessages();
  }

  get definition(): McpServerDefinition {
    return this.transport.definition;
  }

  async notify(method: string, params?: JsonRpcParams): Promise<void> {
    await this.transport.send(createJsonRpcNotification(method, params));
  }

  async request(
    method: string,
    params?: JsonRpcParams,
    timeoutMs = 300_000,
    signal?: AbortSignal,
    options: McpRequestOptions = {},
  ): Promise<unknown> {
    if (this.#closed) {
      throw new Error(`MCP server "${this.definition.name}" is closed.`);
    }

    const id = `${this.definition.id}:${++this.#nextRequestId}`;
    const message = createJsonRpcRequest(id, method, params);
    const progressToken = progressTokenFromParams(params);

    if (signal?.aborted) {
      throw new Error(`MCP request "${method}" was stopped for ${this.definition.name}.`);
    }

    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.#pending.get(id);

        if (pending) {
          clearPendingMcpRequest(pending);
          this.#pending.delete(id);
          this.#sendCancellationNotification(id, `MCP request "${method}" timed out.`);
        }

        reject(new Error(`MCP request "${method}" timed out for ${this.definition.name}.`));
      }, timeoutMs);
      const abortListener = signal
        ? () => {
            const pending = this.#pending.get(id);

            if (!pending) {
              return;
            }

            clearPendingMcpRequest(pending);
            this.#pending.delete(id);
            this.#sendCancellationNotification(id, `MCP request "${method}" was stopped.`);
            reject(new Error(`MCP request "${method}" was stopped for ${this.definition.name}.`));
          }
        : undefined;

      if (signal && abortListener) {
        signal.addEventListener("abort", abortListener, { once: true });
      }

      this.#pending.set(id, {
        abortListener,
        onProgress: options.onProgress,
        progressToken,
        reject,
        resolve,
        signal,
        timer,
      });
    });

    try {
      await this.transport.send(message);
    } catch (caught) {
      const pending = this.#pending.get(id);

      if (pending) {
        clearPendingMcpRequest(pending);
        this.#pending.delete(id);
      }

      throw caught;
    }

    return result;
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#rejectPending(new Error(`MCP server "${this.definition.name}" closed.`));
    await this.transport.close();
  }

  async #readMessages(): Promise<void> {
    try {
      for await (const message of this.transport.messages()) {
        if (isJsonRpcResponse(message)) {
          if (message.id !== null) {
            this.#resolveResponse(message.id, message);
          }
          continue;
        }

        if (isJsonRpcRequest(message)) {
          await this.transport.send({
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32601,
              message: `Truss does not implement client method "${message.method}".`,
            },
          });
          continue;
        }

        if (isJsonRpcNotification(message)) {
          if (this.#handleProgressNotification(message)) {
            continue;
          }

          await this.onNotification?.({
            method: message.method,
            params: message.params,
            serverId: this.definition.id,
          });
        }
      }
    } catch (caught) {
      this.#rejectPending(caught instanceof Error ? caught : new Error(String(caught)));
    }
  }

  #resolveResponse(id: JsonRpcId, message: JsonRpcResponse): void {
    const key = String(id);
    const pending = this.#pending.get(key);

    if (!pending) {
      return;
    }

    clearPendingMcpRequest(pending);
    this.#pending.delete(key);

    if ("error" in message) {
      pending.reject(new Error(formatJsonRpcError(message.error)));
      return;
    }

    pending.resolve(message.result);
  }

  #rejectPending(error: Error): void {
    for (const [id, pending] of this.#pending) {
      clearPendingMcpRequest(pending);
      pending.reject(error);
      this.#pending.delete(id);
    }
  }

  #sendCancellationNotification(requestId: JsonRpcId, reason: string): void {
    void this.transport
      .send(
        createJsonRpcNotification("notifications/cancelled", {
          reason,
          requestId,
        }),
      )
      .catch(() => undefined);
  }

  #handleProgressNotification(message: JsonRpcNotification): boolean {
    if (message.method !== "notifications/progress") {
      return false;
    }

    const progress = parseMcpProgressNotification(message.params);

    if (!progress) {
      return true;
    }

    for (const pending of this.#pending.values()) {
      if (pending.progressToken !== progress.progressToken) {
        continue;
      }

      try {
        pending.onProgress?.(progress);
      } catch {
        // Progress callbacks update UI state and should not poison the MCP connection.
      }
      return true;
    }

    return true;
  }
}

function clearPendingMcpRequest(pending: PendingMcpRequest): void {
  clearTimeout(pending.timer);

  if (pending.signal && pending.abortListener) {
    pending.signal.removeEventListener("abort", pending.abortListener);
  }
}

function isJsonRpcRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return "method" in message && "id" in message;
}

function isJsonRpcNotification(message: JsonRpcMessage): message is JsonRpcNotification {
  return "method" in message && !("id" in message);
}

function formatJsonRpcError(error: JsonRpcErrorResponse["error"]): string {
  const code = Number.isFinite(error.code) ? `MCP error ${error.code}` : "MCP error";
  const data = jsonRpcErrorDataText(error.data);

  return data ? `${code}: ${error.message} (${data})` : `${code}: ${error.message}`;
}

function progressTokenFromParams(params: JsonRpcParams | undefined): JsonRpcId | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return undefined;
  }

  const meta = (params as Record<string, unknown>)._meta;

  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return undefined;
  }

  const token = (meta as Record<string, unknown>).progressToken;

  return typeof token === "string" || typeof token === "number" ? token : undefined;
}

function parseMcpProgressNotification(
  params: JsonRpcParams | undefined,
): (McpProgressNotification & { progressToken: JsonRpcId }) | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }

  const source = params as Record<string, unknown>;
  const progressToken = source.progressToken;
  const progress = source.progress;

  if (
    (typeof progressToken !== "string" && typeof progressToken !== "number") ||
    typeof progress !== "number" ||
    !Number.isFinite(progress)
  ) {
    return null;
  }

  const total = source.total;
  const message = typeof source.message === "string" ? source.message.trim() : "";

  return {
    ...(message ? { message } : {}),
    progress,
    progressToken,
    ...(typeof total === "number" && Number.isFinite(total) ? { total } : {}),
  };
}

function jsonRpcErrorDataText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const text =
    typeof value === "string"
      ? value
      : (() => {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })();
  const singleLine = text.replace(/\s+/g, " ").trim();

  if (!singleLine) {
    return null;
  }

  return singleLine.length <= 500 ? singleLine : `${singleLine.slice(0, 497)}...`;
}
