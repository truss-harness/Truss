import type { JsonRpcMessage } from "../json-rpc.ts";
import { parseJsonRpcLine } from "../json-rpc.ts";
import type { McpServerDefinition } from "../types.ts";
import { createApiKeyHeaders } from "../auth/api-key.ts";
import {
  requestClientCredentialsToken,
  type OAuthAccessToken,
} from "../auth/oauth-client-credentials.ts";
import { requestAuthorizationCodeToken } from "../auth/oauth-authorization-code.ts";
import type { McpTransport, McpTransportFactory, McpTransportOptions } from "./types.ts";
import { logToStdout, truncateForLog } from "../../utils/logging.ts";

export const httpSseTransportFactory: McpTransportFactory = {
  supports: (definition) =>
    definition.transport === "http-sse" || definition.transport === "streamable-http",
  async create(definition, options: McpTransportOptions) {
    if (!definition.url) {
      throw new Error(`MCP HTTP server "${definition.name}" is missing a URL.`);
    }

    return new HttpSseMcpTransport(definition, options.env);
  },
};

class HttpSseMcpTransport implements McpTransport {
  readonly #abortController = new AbortController();
  #oauthToken: OAuthAccessToken | null = null;
  #oauthRefreshBlockedUntil = 0;
  #oauthRefreshFailures = 0;
  #oauthRefreshPromise: Promise<OAuthAccessToken | null> | null = null;

  constructor(
    readonly definition: McpServerDefinition,
    readonly env: NodeJS.ProcessEnv,
  ) {}

  async send(message: JsonRpcMessage): Promise<void> {
    await fetch(this.definition.url!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await this.requestHeaders()),
      },
      signal: this.#abortController.signal,
      body: JSON.stringify(message),
    });
  }

  async *messages(): AsyncIterable<JsonRpcMessage> {
    const response = await fetch(this.definition.url!, {
      headers: {
        Accept: "text/event-stream",
        ...(await this.requestHeaders()),
      },
      signal: this.#abortController.signal,
    });

    if (!response.body) {
      return;
    }

    const decoder = new TextDecoderStream();
    const lineStream = response.body.pipeThrough(decoder);
    let buffered = "";

    for await (const chunk of lineStream) {
      buffered += chunk;
      const events = buffered.split(/\n\n/);
      buffered = events.pop() ?? "";

      for (const event of events) {
        const dataLine = event
          .split(/\r?\n/)
          .find((line) => line.startsWith("data:"))
          ?.slice("data:".length)
          .trim();

        if (!dataLine) {
          continue;
        }

        const message = parseJsonRpcLine(dataLine);

        if (message) {
          yield message;
        } else {
          logToStdout("mcp", "Ignored non-JSON-RPC SSE message from MCP server.", {
            message: truncateForLog(dataLine),
            server: this.definition.name,
            url: this.definition.url,
          });
        }
      }
    }
  }

  async close(): Promise<void> {
    this.#abortController.abort();
  }

  private async requestHeaders(): Promise<Record<string, string>> {
    return {
      ...this.definition.headers,
      ...this.envHeaders(),
      ...(await this.authHeaders()),
    };
  }

  private envHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    for (const [headerName, envVar] of Object.entries(this.definition.envHeaders ?? {})) {
      const value = this.env[envVar];

      if (typeof value === "string" && value.length > 0) {
        headers[headerName] = value;
      }
    }

    return headers;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const auth = this.definition.auth;

    if (!auth) {
      return {};
    }

    if (auth.type === "api-key") {
      return createApiKeyHeaders(auth, this.env);
    }

    if (auth.type === "oauth2-client-credentials") {
      const token = await this.oauthToken(() => requestClientCredentialsToken(auth, this.env));
      return token ? bearerHeaders(token) : {};
    }

    const token = await this.oauthToken(() => requestAuthorizationCodeToken(auth, this.env));
    return token ? bearerHeaders(token) : {};
  }

  private async oauthToken(
    loadToken: () => Promise<OAuthAccessToken | null>,
  ): Promise<OAuthAccessToken | null> {
    if (this.#oauthToken && !tokenExpired(this.#oauthToken)) {
      return this.#oauthToken;
    }

    const now = Date.now();

    if (this.#oauthRefreshBlockedUntil > now) {
      throw new Error(
        `OAuth token refresh is backing off for ${this.definition.name}. Retry after ${new Date(
          this.#oauthRefreshBlockedUntil,
        ).toISOString()}.`,
      );
    }

    if (this.#oauthRefreshPromise) {
      return this.#oauthRefreshPromise;
    }

    this.#oauthRefreshPromise = this.refreshOAuthToken(loadToken);

    try {
      return await this.#oauthRefreshPromise;
    } finally {
      this.#oauthRefreshPromise = null;
    }
  }

  private async refreshOAuthToken(
    loadToken: () => Promise<OAuthAccessToken | null>,
  ): Promise<OAuthAccessToken | null> {
    try {
      const token = await loadToken();

      this.#oauthToken = token;
      this.#oauthRefreshFailures = 0;
      this.#oauthRefreshBlockedUntil = 0;
      return token;
    } catch (caught) {
      this.#oauthToken = null;
      this.#oauthRefreshFailures += 1;
      this.#oauthRefreshBlockedUntil = Date.now() + oauthRefreshBackoffMs(this.#oauthRefreshFailures);
      throw caught;
    }
  }
}

function bearerHeaders(token: OAuthAccessToken): Record<string, string> {
  return {
    Authorization: `${token.tokenType} ${token.accessToken}`,
  };
}

function tokenExpired(token: OAuthAccessToken): boolean {
  return typeof token.expiresAt === "number" && token.expiresAt <= Date.now() + 30_000;
}

function oauthRefreshBackoffMs(failures: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, failures - 1));
}
