import { describe, expect, it } from "bun:test";
import {
  parsePlaywrightMcpToolAllowlist,
  runTrussPlaywrightMcpMessageLoop,
} from "../../src/server/mcp/servers/truss-playwright-mcp/server.ts";
import type { TrussPlaywrightMcpRuntimeState } from "../../src/server/mcp/servers/truss-playwright-mcp/runtime.ts";
import type {
  CamoufoxBrowser,
  CamoufoxPlaywrightMcpRequest,
} from "../../src/server/utils/camoufox-browser.ts";
import type { PlaywrightMcpSettingsSummary } from "../../src/shared/protocol.ts";

describe("Truss Playwright MCP server", () => {
  it("returns no tools while disabled", async () => {
    const calls: CamoufoxPlaywrightMcpRequest[] = [];
    const messages: unknown[] = [];

    await runTrussPlaywrightMcpMessageLoop(
      asyncLines([
        JSON.stringify({
          id: "list",
          jsonrpc: "2.0",
          method: "tools/list",
        }),
      ]),
      createRuntime({ enabled: false }, calls),
      {
        close: async () => undefined,
        write: (message) => messages.push(message),
      },
    );

    expect(calls).toEqual([]);
    expect(messages).toContainEqual({
      id: "list",
      jsonrpc: "2.0",
      result: {
        tools: [],
      },
    });
  });

  it("filters listed tools and rejects calls outside the allowlist", async () => {
    const calls: CamoufoxPlaywrightMcpRequest[] = [];
    const messages: unknown[] = [];

    await runTrussPlaywrightMcpMessageLoop(
      asyncLines([
        JSON.stringify({
          id: "list",
          jsonrpc: "2.0",
          method: "tools/list",
        }),
        JSON.stringify({
          id: "blocked",
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            arguments: {
              url: "https://example.com/",
            },
            name: "browser_click",
          },
        }),
      ]),
      createRuntime({ tools: "browser_navigate" }, calls),
      {
        close: async () => undefined,
        write: (message) => messages.push(message),
      },
    );

    const listResponse = messages.find(
      (message): message is { result: { tools: Array<{ name: string }> } } =>
        isResponse(message) && message.id === "list" && "result" in message,
    );
    const blockedResponse = messages.find(
      (message): message is { error: { message: string } } =>
        isResponse(message) && message.id === "blocked" && "error" in message,
    );

    expect(listResponse?.result.tools.map((tool) => tool.name)).toEqual(["browser_navigate"]);
    expect(blockedResponse?.error.message).toContain("mcp.playwright_mcp_tools");
    expect(calls.map((call) => call.method)).toEqual(["tools/list"]);
  });

  it("forwards allowed tool calls to the Camoufox Playwright bridge", async () => {
    const calls: CamoufoxPlaywrightMcpRequest[] = [];
    const messages: unknown[] = [];

    await runTrussPlaywrightMcpMessageLoop(
      asyncLines([
        JSON.stringify({
          id: "navigate",
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            arguments: {
              url: "https://example.com/",
            },
            name: "browser_navigate",
          },
        }),
      ]),
      createRuntime({ tools: "browser_navigate" }, calls),
      {
        close: async () => undefined,
        write: (message) => messages.push(message),
      },
    );

    expect(calls).toContainEqual({
      id: "navigate",
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        arguments: {
          url: "https://example.com/",
        },
        name: "browser_navigate",
      },
    });
    expect(messages).toContainEqual({
      id: "navigate",
      jsonrpc: "2.0",
      result: {
        content: [
          {
            text: "called browser_navigate",
            type: "text",
          },
        ],
      },
    });
  });

  it("parses wildcard and comma-separated allowlists", () => {
    expect(parsePlaywrightMcpToolAllowlist("*")).toBeNull();
    expect(parsePlaywrightMcpToolAllowlist("browser_navigate, browser_click")).toEqual(
      new Set(["browser_navigate", "browser_click"]),
    );
  });
});

function createRuntime(
  settings: Partial<PlaywrightMcpSettingsSummary>,
  calls: CamoufoxPlaywrightMcpRequest[],
): TrussPlaywrightMcpRuntimeState {
  const mergedSettings: PlaywrightMcpSettingsSummary = {
    enabled: true,
    tools: "*",
    ...settings,
  };
  const browser: CamoufoxBrowser = {
    callPlaywrightMcp: async (request) => {
      calls.push(request);

      if (request.method === "tools/list") {
        return {
          id: request.id,
          jsonrpc: "2.0",
          result: {
            tools: [
              { name: "browser_navigate" },
              { name: "browser_click" },
            ],
          },
        };
      }

      const params = request.params && typeof request.params === "object"
        ? (request.params as Record<string, unknown>)
        : {};

      return {
        id: request.id,
        jsonrpc: "2.0",
        result: {
          content: [
            {
              type: "text",
              text: `called ${String(params.name)}`,
            },
          ],
        },
      };
    },
    close: async () => undefined,
    fetchPage: async () => {
      throw new Error("fetchPage should not be called");
    },
    screenshotPage: async () => {
      throw new Error("screenshotPage should not be called");
    },
  };

  return {
    getBrowser: () => browser,
    getSettings: () => mergedSettings,
    log: () => undefined,
  };
}

async function* asyncLines(lines: string[]): AsyncIterable<string> {
  for (const line of lines) {
    yield line;
  }
}

function isResponse(value: unknown): value is { id: string } {
  return value !== null && typeof value === "object" && "id" in value;
}
