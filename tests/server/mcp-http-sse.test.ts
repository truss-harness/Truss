import { describe, expect, it } from "bun:test";
import type { JsonRpcMessage } from "../../src/server/mcp/json-rpc.ts";
import { httpSseTransportFactory } from "../../src/server/mcp/transports/http-sse.ts";
import type { McpServerDefinition } from "../../src/server/mcp/types.ts";

describe("HTTP/SSE MCP transport OAuth", () => {
  it("deduplicates concurrent OAuth refresh requests", async () => {
    const originalFetch = globalThis.fetch;
    let tokenRequests = 0;
    let releaseToken!: () => void;

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "https://auth.example/token") {
        tokenRequests += 1;
        return new Promise<Response>((resolve) => {
          releaseToken = () =>
            resolve(
              Response.json({
                access_token: "token",
                expires_in: 3600,
                token_type: "Bearer",
              }),
            );
        });
      }

      return Promise.resolve(new Response(null, { status: 202 }));
    }) as typeof fetch;

    try {
      const transport = await httpSseTransportFactory.create(oauthDefinition(), {
        env: {
          CLIENT_ID: "client",
          CLIENT_SECRET: "secret",
        },
      });
      const first = transport.send(jsonRpcNotification());
      const second = transport.send(jsonRpcNotification());

      await Promise.resolve();
      expect(tokenRequests).toBe(1);

      releaseToken();
      await Promise.all([first, second]);
      await transport.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("backs off after OAuth refresh failures", async () => {
    const originalFetch = globalThis.fetch;
    let tokenRequests = 0;

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "https://auth.example/token") {
        tokenRequests += 1;
        return Promise.resolve(new Response("nope", { status: 500 }));
      }

      return Promise.resolve(new Response(null, { status: 202 }));
    }) as typeof fetch;

    try {
      const transport = await httpSseTransportFactory.create(oauthDefinition(), {
        env: {
          CLIENT_ID: "client",
          CLIENT_SECRET: "secret",
        },
      });

      await expect(transport.send(jsonRpcNotification())).rejects.toThrow(
        "OAuth client credentials request failed",
      );
      await expect(transport.send(jsonRpcNotification())).rejects.toThrow(
        "OAuth token refresh is backing off",
      );
      expect(tokenRequests).toBe(1);
      await transport.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function oauthDefinition(): McpServerDefinition {
  return {
    auth: {
      clientIdEnv: "CLIENT_ID",
      clientSecretEnv: "CLIENT_SECRET",
      tokenUrl: "https://auth.example/token",
      type: "oauth2-client-credentials",
    },
    configPath: "mcp.json",
    id: "oauth",
    name: "OAuth MCP",
    source: "test",
    transport: "streamable-http",
    trussManaged: false,
    url: "https://mcp.example/messages",
  };
}

function jsonRpcNotification(): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  };
}
