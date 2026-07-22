import { describe, expect, it } from "bun:test";
import { runTrussWebToolsMcpMessageLoop } from "../../src/server/mcp/servers/truss-web-tools/server.ts";
import type { TrussWebToolRuntime } from "../../src/server/tools/truss-web-tools.ts";
import type {
  CamoufoxBrowser,
  CamoufoxPageFetchResult,
} from "../../src/server/utils/camoufox-browser.ts";

describe("Truss Web Tools MCP server", () => {
  it("handles independent tool calls concurrently", async () => {
    let activeFetches = 0;
    let maxActiveFetches = 0;
    let releaseFetches: (() => void) | null = null;
    const releasePromise = new Promise<void>((resolve) => {
      releaseFetches = resolve;
    });
    const runtime = createRuntime({
      fetchPage: async (url) => {
        activeFetches += 1;
        maxActiveFetches = Math.max(maxActiveFetches, activeFetches);

        if (activeFetches === 2) {
          releaseFetches?.();
        }

        await Promise.race([releasePromise, sleep(50)]);
        activeFetches -= 1;

        return pageResponse(
          `<html><head><title>${url.hostname}</title></head><body>${url.href}</body></html>`,
          "text/html; charset=utf-8",
        );
      },
    });
    const messages: unknown[] = [];

    await runTrussWebToolsMcpMessageLoop(
      asyncLines([
        toolCallLine("first", "progress-first", "https://example.com/one"),
        toolCallLine("second", "progress-second", "https://example.org/two"),
      ]),
      runtime,
      {
        close: async () => undefined,
        write: (message) => messages.push(message),
      },
    );

    const responses = messages.filter(isJsonRpcResponse);
    const progressTokens = messages.flatMap((message) => {
      if (!isProgressNotification(message)) {
        return [];
      }

      return [message.params.progressToken];
    });

    expect(maxActiveFetches).toBe(2);
    expect(responses.map((response) => response.id).sort()).toEqual(["first", "second"]);
    expect(progressTokens).toContain("progress-first");
    expect(progressTokens).toContain("progress-second");
  });

  it("aborts a running tool call when the matching MCP request is cancelled", async () => {
    let resolveFetchStarted: (() => void) | null = null;
    let resolveFetchAborted: (() => void) | null = null;
    const fetchStarted = new Promise<void>((resolve) => {
      resolveFetchStarted = resolve;
    });
    const fetchAborted = new Promise<void>((resolve) => {
      resolveFetchAborted = resolve;
    });
    const runtime = createRuntime({
      fetchPage: async (_url, options) => {
        resolveFetchStarted?.();

        return await new Promise<CamoufoxPageFetchResult>((_resolve, reject) => {
          const abort = () => {
            resolveFetchAborted?.();
            reject(new Error("fetch aborted by test"));
          };

          if (options?.signal?.aborted) {
            abort();
            return;
          }

          options?.signal?.addEventListener("abort", abort, { once: true });
        });
      },
    });
    const messages: unknown[] = [];

    await runTrussWebToolsMcpMessageLoop(cancellableLines(fetchStarted), runtime, {
      close: async () => undefined,
      write: (message) => messages.push(message),
    });
    await fetchAborted;

    const response = messages.find(
      (message): message is { error: { message: string }; id: string } =>
        isJsonRpcResponse(message) && message.id === "cancel-me" && "error" in message,
    );

    expect(response?.error.message).toContain("fetch aborted by test");
  });
});

function toolCallLine(id: string, progressToken: string, url: string): string {
  return JSON.stringify({
    id,
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      _meta: { progressToken },
      arguments: {
        url,
      },
      name: "load_webpage",
    },
  });
}

function cancellationLine(id: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: {
      reason: "test cancellation",
      requestId: id,
    },
  });
}

async function* asyncLines(lines: string[]): AsyncIterable<string> {
  for (const line of lines) {
    yield line;
  }
}

async function* cancellableLines(fetchStarted: Promise<void>): AsyncIterable<string> {
  yield toolCallLine("cancel-me", "progress-cancel", "https://example.com/cancel");
  await fetchStarted;
  yield cancellationLine("cancel-me");
}

function createRuntime(overrides: Partial<CamoufoxBrowser>): TrussWebToolRuntime {
  return {
    getBrowser: () => createBrowser(overrides),
    getLlmProviders: () => [],
    getModelProfile: () => null,
    getSecretEnv: () => process.env,
    log: () => undefined,
  };
}

function createBrowser(overrides: Partial<CamoufoxBrowser>): CamoufoxBrowser {
  return {
    close: async () => undefined,
    fetchPage: async () => pageResponse("<html><body>default</body></html>", "text/html"),
    screenshotPage: async () => ({
      contentType: "image/png",
      data: Uint8Array.from([]),
      height: 1,
      status: 200,
      statusText: "OK",
      title: null,
      width: 1,
    }),
    ...overrides,
  };
}

function pageResponse(content: string, contentType: string): CamoufoxPageFetchResult {
  return {
    content,
    contentType,
    headers: {
      "content-length": String(new TextEncoder().encode(content).byteLength),
      "content-type": contentType,
    },
    status: 200,
    statusText: "OK",
  };
}

function isJsonRpcResponse(value: unknown): value is { id: string } {
  return value !== null && typeof value === "object" && "id" in value;
}

function isProgressNotification(
  value: unknown,
): value is { method: "notifications/progress"; params: { progressToken: string } } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as {
    method?: unknown;
    params?: {
      progressToken?: unknown;
    };
  };

  return (
    message.method === "notifications/progress" &&
    typeof message.params?.progressToken === "string"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
