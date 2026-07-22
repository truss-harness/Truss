import { describe, expect, it } from "bun:test";
import { McpClientHost } from "../../src/server/mcp/client.ts";
import type { JsonRpcMessage, JsonRpcRequest } from "../../src/server/mcp/json-rpc.ts";
import { McpRuntime } from "../../src/server/mcp/runtime.ts";
import { mcpTransportFactories } from "../../src/server/mcp/transports/registry.ts";
import type {
  McpTransport,
  McpTransportFactory,
} from "../../src/server/mcp/transports/types.ts";
import type { McpServerDefinition } from "../../src/server/mcp/types.ts";

describe("McpRuntime", () => {
  it("publishes connecting state and starts server connections in parallel", async () => {
    const startedServers: string[] = [];
    const fakeFactory: McpTransportFactory = {
      supports: (definition) => definition.source === "test",
      create: (definition) => {
        startedServers.push(definition.id);
        return new Promise<McpTransport>(() => {});
      },
    };
    const definitions = [
      testServerDefinition("test:one", "One"),
      testServerDefinition("test:two", "Two"),
    ];
    const summaries: number[] = [];
    const runtime = new McpRuntime(
      new McpClientHost({ env: {} }),
      {
        configFiles: ["mcp.json"],
        servers: definitions,
        source: "test",
      },
      {
        dbPath: "truss.db",
        dir: ".truss",
        envKeysPath: ".env.keys",
        envPath: ".env",
        fileAccessConfigPath: "file-access.json",
        mcpConfigPath: "mcp.json",
      },
      (summary) => summaries.push(summary.connectingServers),
    );

    mcpTransportFactories.unshift(fakeFactory);

    try {
      expect(runtime.summary.connectingServers).toBe(2);
      expect(runtime.summary.servers.map((server) => server.status)).toEqual([
        "connecting",
        "connecting",
      ]);

      runtime.startConnecting();

      expect(startedServers).toEqual(["test:one", "test:two"]);
      expect(summaries).toEqual([2]);
    } finally {
      mcpTransportFactories.splice(mcpTransportFactories.indexOf(fakeFactory), 1);
      await runtime.close();
    }
  });

  it("shows disabled servers without connecting them", async () => {
    const startedServers: string[] = [];
    const fakeFactory: McpTransportFactory = {
      supports: (definition) => definition.source === "test",
      create: (definition) => {
        startedServers.push(definition.id);
        return new Promise<McpTransport>(() => {});
      },
    };
    const definitions = [
      testServerDefinition("test:enabled", "Enabled"),
      {
        ...testServerDefinition("test:disabled", "Disabled"),
        disabled: true,
        disabledReason: "Disabled by test.",
      },
    ];
    const runtime = new McpRuntime(
      new McpClientHost({ env: {} }),
      {
        configFiles: ["mcp.json"],
        servers: definitions,
        source: "test",
      },
      {
        dbPath: "truss.db",
        dir: ".truss",
        envKeysPath: ".env.keys",
        envPath: ".env",
        fileAccessConfigPath: "file-access.json",
        mcpConfigPath: "mcp.json",
      },
    );

    mcpTransportFactories.unshift(fakeFactory);

    try {
      expect(runtime.summary.connectingServers).toBe(1);
      expect(runtime.summary.servers.map((server) => server.status)).toEqual([
        "connecting",
        "disabled",
      ]);
      expect(runtime.summary.servers[1]?.disabledReason).toBe("Disabled by test.");

      runtime.startConnecting();

      expect(startedServers).toEqual(["test:enabled"]);
    } finally {
      mcpTransportFactories.splice(mcpTransportFactories.indexOf(fakeFactory), 1);
      await runtime.close();
    }
  });

  it("reads content from advertised MCP resources", async () => {
    const definition = testServerDefinition("resource-test:docs", "Docs");
    const fakeFactory: McpTransportFactory = {
      supports: (candidate) => candidate.id === definition.id,
      create: (candidate) => Promise.resolve(new ResourceMcpTransport(candidate)),
    };
    let resolveConnected!: () => void;
    const connected = new Promise<void>((resolve) => {
      resolveConnected = resolve;
    });
    const runtime = new McpRuntime(
      new McpClientHost({ env: {} }),
      {
        configFiles: ["mcp.json"],
        servers: [definition],
        source: "test",
      },
      {
        dbPath: "truss.db",
        dir: ".truss",
        envKeysPath: ".env.keys",
        envPath: ".env",
        fileAccessConfigPath: "file-access.json",
        mcpConfigPath: "mcp.json",
      },
      (summary) => {
        if (summary.connectedServers === 1) {
          resolveConnected();
        }
      },
    );

    mcpTransportFactories.unshift(fakeFactory);

    try {
      runtime.startConnecting();
      await withTimeout(connected);

      expect(runtime.summary.servers[0]?.resources).toEqual([
        {
          mimeType: "text/markdown",
          name: "Docs resource",
          uri: "docs://one",
        },
        {
          mimeType: "text/plain",
          name: "Huge resource",
          uri: "docs://huge",
        },
      ]);

      await expect(
        runtime.readResource({
          serverId: definition.id,
          uri: "docs://missing",
        }),
      ).rejects.toThrow('MCP resource "docs://missing" is not advertised by "Docs".');

      await expect(
        runtime.readResource({
          serverId: definition.id,
          uri: "docs://one",
        }),
      ).resolves.toEqual([
        {
          mimeType: "text/markdown",
          text: "# Docs\n\nReadable resource content.",
          uri: "docs://one",
        },
      ]);

      await expect(
        runtime.readResource({
          serverId: definition.id,
          uri: "docs://huge",
        }),
      ).rejects.toThrow("exceeded the 10485760 byte read limit");
    } finally {
      mcpTransportFactories.splice(mcpTransportFactories.indexOf(fakeFactory), 1);
      await runtime.close();
    }
  });

  it("gets content from advertised MCP prompts", async () => {
    const definition = testServerDefinition("prompt-test:docs", "Docs");
    const fakeFactory: McpTransportFactory = {
      supports: (candidate) => candidate.id === definition.id,
      create: (candidate) => Promise.resolve(new ResourceMcpTransport(candidate)),
    };
    let resolveConnected!: () => void;
    const connected = new Promise<void>((resolve) => {
      resolveConnected = resolve;
    });
    const runtime = new McpRuntime(
      new McpClientHost({ env: {} }),
      {
        configFiles: ["mcp.json"],
        servers: [definition],
        source: "test",
      },
      {
        dbPath: "truss.db",
        dir: ".truss",
        envKeysPath: ".env.keys",
        envPath: ".env",
        fileAccessConfigPath: "file-access.json",
        mcpConfigPath: "mcp.json",
      },
      (summary) => {
        if (summary.connectedServers === 1) {
          resolveConnected();
        }
      },
    );

    mcpTransportFactories.unshift(fakeFactory);

    try {
      runtime.startConnecting();
      await withTimeout(connected);

      expect(runtime.summary.servers[0]?.prompts).toEqual([
        {
          arguments: [
            {
              name: "topic",
              required: true,
            },
          ],
          description: "Create a compact summary.",
          name: "summarize",
        },
      ]);

      await expect(
        runtime.getPrompt({
          arguments: { topic: "{topic}" },
          name: "missing",
          serverId: definition.id,
        }),
      ).rejects.toThrow('MCP prompt "missing" is not advertised by "Docs".');

      await expect(
        runtime.getPrompt({
          arguments: { topic: "{topic}" },
          name: "summarize",
          serverId: definition.id,
        }),
      ).resolves.toEqual({
        description: "Create a compact summary.",
        messages: [
          {
            content: {
              text: "Summarize {topic} for a planning note.",
              type: "text",
            },
            role: "user",
            text: "Summarize {topic} for a planning note.",
          },
        ],
        text: "Summarize {topic} for a planning note.",
      });
    } finally {
      mcpTransportFactories.splice(mcpTransportFactories.indexOf(fakeFactory), 1);
      await runtime.close();
    }
  });

  it("returns structured content for a named tool without changing text output", async () => {
    const definition = testServerDefinition("tool-test:orchestration", "Tools");
    const fakeFactory: McpTransportFactory = {
      supports: (candidate) => candidate.id === definition.id,
      create: (candidate) => Promise.resolve(new ResourceMcpTransport(candidate)),
    };
    let resolveConnected!: () => void;
    const connected = new Promise<void>((resolve) => {
      resolveConnected = resolve;
    });
    const runtime = new McpRuntime(
      new McpClientHost({ env: {} }),
      {
        configFiles: ["mcp.json"],
        servers: [definition],
        source: "test",
      },
      {
        dbPath: "truss.db",
        dir: ".truss",
        envKeysPath: ".env.keys",
        envPath: ".env",
        fileAccessConfigPath: "file-access.json",
        mcpConfigPath: "mcp.json",
      },
      (summary) => {
        if (summary.connectedServers === 1) {
          resolveConnected();
        }
      },
    );

    mcpTransportFactories.unshift(fakeFactory);

    try {
      runtime.startConnecting();
      await withTimeout(connected);

      await expect(
        runtime.callToolByServerName({
          args: {},
          meta: { sessionId: "session_one" },
          serverName: "Tools",
          toolName: "timer_list",
        }),
      ).resolves.toBe("timer_list:\n  timers[0]: []");
      await expect(
        runtime.callToolStructuredByServerName({
          args: {},
          meta: { sessionId: "session_one" },
          serverName: "Tools",
          toolName: "timer_list",
        }),
      ).resolves.toEqual({ timers: [] });
    } finally {
      mcpTransportFactories.splice(mcpTransportFactories.indexOf(fakeFactory), 1);
      await runtime.close();
    }
  });

  it("forwards MCP progress notifications for tool calls", async () => {
    const definition = testServerDefinition("tool-test:progress", "Tools");
    const fakeFactory: McpTransportFactory = {
      supports: (candidate) => candidate.id === definition.id,
      create: (candidate) => Promise.resolve(new ResourceMcpTransport(candidate)),
    };
    let resolveConnected!: () => void;
    const connected = new Promise<void>((resolve) => {
      resolveConnected = resolve;
    });
    const runtime = new McpRuntime(
      new McpClientHost({ env: {} }),
      {
        configFiles: ["mcp.json"],
        servers: [definition],
        source: "test",
      },
      {
        dbPath: "truss.db",
        dir: ".truss",
        envKeysPath: ".env.keys",
        envPath: ".env",
        fileAccessConfigPath: "file-access.json",
        mcpConfigPath: "mcp.json",
      },
      (summary) => {
        if (summary.connectedServers === 1) {
          resolveConnected();
        }
      },
    );

    mcpTransportFactories.unshift(fakeFactory);

    try {
      runtime.startConnecting();
      await withTimeout(connected);

      const binding = runtime.resolveTool("timer_list");
      const progressUpdates: Array<{ message?: string; percent: number }> = [];

      expect(binding).not.toBeNull();
      await expect(
        runtime.callTool({
          args: {},
          binding: binding!,
          onProgress: (progress) => progressUpdates.push(progress),
        }),
      ).resolves.toBe("timer_list:\n  timers[0]: []");
      expect(progressUpdates).toEqual([{ message: "Half done", percent: 50 }]);
    } finally {
      mcpTransportFactories.splice(mcpTransportFactories.indexOf(fakeFactory), 1);
      await runtime.close();
    }
  });

  it("uses a longer timeout for Truss Web Tools calls", async () => {
    const host = new RecordingMcpClientHost();
    const runtime = new McpRuntime(
      host,
      {
        configFiles: ["mcp.json"],
        servers: [],
        source: "test",
      },
      {
        dbPath: "truss.db",
        dir: ".truss",
        envKeysPath: ".env.keys",
        envPath: ".env",
        fileAccessConfigPath: "file-access.json",
        mcpConfigPath: "mcp.json",
      },
    );

    try {
      await expect(
        runtime.callTool({
          args: { url: "https://example.com/" },
          binding: {
            definition: {
              description: "Load webpage.",
              name: "load_webpage",
              parameters: { type: "object", properties: {} },
            },
            serverId: "truss-global:truss-web-tools",
            serverName: "Truss Web Tools",
            toolName: "load_webpage",
          },
        }),
      ).resolves.toBe("ok");

      expect(host.requestTimeouts).toEqual([240_000]);
    } finally {
      await runtime.close();
    }
  });
});

function testServerDefinition(id: string, name: string): McpServerDefinition {
  return {
    command: "fake-mcp",
    configPath: "mcp.json",
    id,
    name,
    source: "test",
    transport: "stdio",
    trussManaged: false,
  };
}

class ResourceMcpTransport implements McpTransport {
  readonly #queue: JsonRpcMessage[] = [];
  readonly #waiters: Array<() => void> = [];
  #closed = false;

  constructor(readonly definition: McpServerDefinition) {}

  async send(message: JsonRpcMessage): Promise<void> {
    if (!isJsonRpcRequest(message)) {
      return;
    }

    const progressToken = progressTokenFromRequest(message);

    if (message.method === "tools/call" && progressToken !== undefined) {
      this.#push({
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: {
          message: "Half done",
          progress: 1,
          progressToken,
          total: 2,
        },
      });
    }

    this.#push(this.#responseFor(message));
  }

  async *messages(): AsyncIterable<JsonRpcMessage> {
    while (true) {
      const next = this.#queue.shift();

      if (next) {
        yield next;
        continue;
      }

      if (this.#closed) {
        return;
      }

      await new Promise<void>((resolve) => this.#waiters.push(resolve));
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#wake();
  }

  #responseFor(request: JsonRpcRequest): JsonRpcMessage {
    switch (request.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            capabilities: {
              prompts: {},
              resources: {},
              tools: {},
            },
            protocolVersion: "2024-11-05",
            serverInfo: {
              name: "Docs",
              version: "0.1.0",
            },
          },
        };
      case "tools/list":
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            tools: [
              {
                description: "List pending timers.",
                inputSchema: {
                  additionalProperties: false,
                  properties: {},
                  type: "object",
                },
                name: "timer_list",
              },
            ],
          },
        };
      case "tools/call":
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            content: [
              {
                text: "timer_list:\n  timers[0]: []\n",
                type: "text",
              },
            ],
            structuredContent: {
              timers: [],
            },
          },
        };
      case "resources/list":
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            resources: [
              {
                mimeType: "text/markdown",
                name: "Docs resource",
                uri: "docs://one",
              },
              {
                mimeType: "text/plain",
                name: "Huge resource",
                uri: "docs://huge",
              },
            ],
          },
        };
      case "resources/read": {
        const params =
          request.params && typeof request.params === "object" && !Array.isArray(request.params)
            ? request.params
            : {};

        if (params.uri !== "docs://one" && params.uri !== "docs://huge") {
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32602,
              message: "Unknown resource.",
            },
          };
        }

        if (params.uri === "docs://huge") {
          return {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              contents: [
                {
                  mimeType: "text/plain",
                  text: "x".repeat(10 * 1024 * 1024 + 1),
                  uri: "docs://huge",
                },
              ],
            },
          };
        }

        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            contents: [
              {
                mimeType: "text/markdown",
                text: "# Docs\n\nReadable resource content.",
                uri: "docs://one",
              },
            ],
          },
        };
      }
      case "prompts/list":
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            prompts: [
              {
                arguments: [
                  {
                    name: "topic",
                    required: true,
                  },
                ],
                description: "Create a compact summary.",
                name: "summarize",
              },
            ],
          },
        };
      case "prompts/get": {
        const params =
          request.params && typeof request.params === "object" && !Array.isArray(request.params)
            ? request.params
            : {};
        const args: Record<string, unknown> =
          params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
            ? (params.arguments as Record<string, unknown>)
            : {};
        const topic = typeof args.topic === "string" ? args.topic : "{topic}";

        if (params.name !== "summarize") {
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32602,
              message: "Unknown prompt.",
            },
          };
        }

        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            description: "Create a compact summary.",
            messages: [
              {
                content: {
                  text: `Summarize ${topic} for a planning note.`,
                  type: "text",
                },
                role: "user",
              },
            ],
          },
        };
      }
      default:
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32601,
            message: `Unknown method: ${request.method}`,
          },
        };
    }
  }

  #push(message: JsonRpcMessage): void {
    this.#queue.push(message);
    this.#wake();
  }

  #wake(): void {
    const waiter = this.#waiters.shift();

    waiter?.();
  }
}

class RecordingMcpClientHost extends McpClientHost {
  readonly requestTimeouts: number[] = [];

  constructor() {
    super({ env: {} });
  }

  override get(): ReturnType<McpClientHost["get"]> {
    return {
      definition: testServerDefinition("truss-global:truss-web-tools", "Truss Web Tools"),
      request: async (
        _method: string,
        _params: unknown,
        timeoutMs?: number,
      ): Promise<unknown> => {
        this.requestTimeouts.push(timeoutMs ?? 0);

        return {
          content: [
            {
              text: "ok",
              type: "text",
            },
          ],
        };
      },
    } as ReturnType<McpClientHost["get"]>;
  }
}

function isJsonRpcRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return "method" in message && "id" in message;
}

function progressTokenFromRequest(request: JsonRpcRequest): string | number | undefined {
  const params = request.params;

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

function withTimeout<T>(promise: Promise<T>, ms = 1_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out waiting for MCP connection.")), ms);
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}
