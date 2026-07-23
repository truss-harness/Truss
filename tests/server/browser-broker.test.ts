import { describe, expect, it } from "bun:test";
import {
  connectCamoufoxBrowserBroker,
  waitForBrowserBroker,
} from "../../src/server/browser/broker-client.ts";
import {
  browserBrokerTokenEnv,
  browserBrokerUrlEnv,
  browserBrokerWaitTimeoutMs,
} from "../../src/server/browser/broker-protocol.ts";
import {
  BrowserBrokerServer,
  CamoufoxBrokerHost,
} from "../../src/server/browser/broker-server.ts";
import { workspaceLaunchEnvironment } from "../../src/server/http/routes-workspace-launch.ts";
import { shouldStartBrowserBroker } from "../../src/server/http/server.ts";
import { mcpStdioEnvironment } from "../../src/server/mcp/transports/stdio.ts";
import type { McpServerDefinition } from "../../src/server/mcp/types.ts";
import type {
  CamoufoxBrowser,
  CamoufoxPageFetchResult,
} from "../../src/server/utils/camoufox-browser.ts";

describe("Camoufox browser broker", () => {
  it("authenticates loopback requests and transfers screenshot bytes", async () => {
    let launches = 0;
    let closes = 0;
    const host = new CamoufoxBrokerHost({
      launchBrowser: async () => {
        launches += 1;
        return fakeBrowser({
          close: async () => {
            closes += 1;
          },
        });
      },
      trussHomeDir: process.cwd(),
    });
    const broker = BrowserBrokerServer.start({ host, token: "test-capability" });

    try {
      const unauthorized = await fetch(`${broker.credentials.url}/v1/health`);
      expect(unauthorized.status).toBe(401);
      expect(launches).toBe(0);

      const browser = await connectCamoufoxBrowserBroker({
        env: {
          [browserBrokerTokenEnv]: broker.credentials.token,
          [browserBrokerUrlEnv]: broker.credentials.url,
        },
        platform: "win32",
      });
      const first = await browser.fetchPage(new URL("https://example.com/first"));
      const second = await browser.fetchPage(new URL("https://example.com/second"));
      const screenshot = await browser.screenshotPage(new URL("https://example.com/image"), {
        format: "png",
        height: 480,
        quality: 90,
        width: 640,
      });
      const playwright = await browser.callPlaywrightMcp?.({
        id: "tools",
        jsonrpc: "2.0",
        method: "tools/list",
      });

      expect(first.content).toContain("/first");
      expect(second.content).toContain("/second");
      expect(launches).toBe(1);
      expect([...screenshot.data]).toEqual([1, 2, 3, 4]);
      expect(screenshot.contentType).toBe("image/png");
      expect(playwright).toEqual({
        id: "tools",
        jsonrpc: "2.0",
        result: {},
      });
    } finally {
      await broker.close();
    }

    expect(closes).toBe(1);
  });

  it("serializes requests and cancels queued work", async () => {
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const host = new CamoufoxBrokerHost({
      launchBrowser: async () =>
        fakeBrowser({
          fetchPage: async (url) => {
            calls += 1;
            active += 1;
            maxActive = Math.max(maxActive, active);

            if (calls === 1) {
              await firstBlocked;
            }

            active -= 1;
            return pageResult(url);
          },
        }),
      trussHomeDir: process.cwd(),
    });
    const first = host.fetchPage(new URL("https://example.com/first"));
    const cancellation = new AbortController();
    const cancelled = host.fetchPage(
      new URL("https://example.com/cancelled"),
      cancellation.signal,
    );
    const third = host.fetchPage(new URL("https://example.com/third"));

    await Promise.resolve();
    cancellation.abort();
    releaseFirst();

    await expect(cancelled).rejects.toThrow("cancelled");
    await expect(first).resolves.toMatchObject({ status: 200 });
    await expect(third).resolves.toMatchObject({ status: 200 });
    expect(calls).toBe(2);
    expect(maxActive).toBe(1);
    await host.close();
  });

  it("clears a failed browser so a later request launches a replacement", async () => {
    let launches = 0;
    let failedBrowserCloses = 0;
    const host = new CamoufoxBrokerHost({
      launchBrowser: async () => {
        launches += 1;

        if (launches === 1) {
          return fakeBrowser({
            close: async () => {
              failedBrowserCloses += 1;
            },
            fetchPage: async () => {
              throw new Error("Camoufox launcher exited unexpectedly.");
            },
          });
        }

        return fakeBrowser();
      },
      trussHomeDir: process.cwd(),
    });

    await expect(host.fetchPage(new URL("https://example.com/fail"))).rejects.toThrow(
      "launcher exited",
    );
    await expect(host.fetchPage(new URL("https://example.com/recovered"))).resolves.toMatchObject({
      status: 200,
    });
    expect(launches).toBe(2);
    expect(failedBrowserCloses).toBe(1);
    await host.close();
  });

  it("bounds uncredentialed discovery to fifteen seconds without fallback", async () => {
    let now = 0;
    let slept = 0;

    await expect(
      waitForBrowserBroker({
        env: {},
        now: () => now,
        sleep: async (delayMs) => {
          now += delayMs;
          slept += delayMs;
        },
      }),
    ).rejects.toThrow("not ready after 15 seconds");
    expect(slept).toBe(browserBrokerWaitTimeoutMs);
  });

  it("rejects browser clients outside Windows without trying a fallback", async () => {
    await expect(
      connectCamoufoxBrowserBroker({
        env: {},
        platform: "linux",
        timeoutMs: 0,
      }),
    ).rejects.toThrow("supported only on Windows");
  });

  it("retries broker readiness and limits credentials to intended children", async () => {
    let now = 0;
    let healthChecks = 0;
    const credentials = {
      token: "capability",
      url: "http://127.0.0.1:43210",
    };
    const found = await waitForBrowserBroker({
      env: {
        [browserBrokerTokenEnv]: credentials.token,
        [browserBrokerUrlEnv]: credentials.url,
      },
      fetch: async () => {
        healthChecks += 1;

        if (healthChecks < 3) {
          throw new Error("service starting");
        }

        return new Response(null, { status: 204 });
      },
      now: () => now,
      sleep: async (delayMs) => {
        now += delayMs;
      },
    });

    expect(found).toEqual(credentials);
    expect(healthChecks).toBe(3);

    const childEnv = workspaceLaunchEnvironment(credentials, { SAFE: "yes" });
    expect(childEnv[browserBrokerTokenEnv]).toBe(credentials.token);

    const baseOptions = {
      env: { SAFE: "yes" },
      managedBrowserEnv: {
        [browserBrokerTokenEnv]: credentials.token,
        [browserBrokerUrlEnv]: credentials.url,
      },
    };
    expect(
      mcpStdioEnvironment(mcpDefinition("truss-global:truss-web-tools", true), baseOptions)[
        browserBrokerTokenEnv
      ],
    ).toBe(credentials.token);
    expect(
      mcpStdioEnvironment(mcpDefinition("workspace:untrusted", false), baseOptions)[
        browserBrokerTokenEnv
      ],
    ).toBeUndefined();
    expect(
      mcpStdioEnvironment(mcpDefinition("truss-global:custom", true), baseOptions)[
        browserBrokerTokenEnv
      ],
    ).toBeUndefined();
  });

  it("makes an unscoped foreground server the broker owner", () => {
    expect(
      shouldStartBrowserBroker({
        browserBroker: undefined,
        conversationWorkspacePath: null,
        serviceMode: false,
      }),
    ).toBe(true);
    expect(
      shouldStartBrowserBroker({
        browserBroker: {
          token: "parent-capability",
          url: "http://127.0.0.1:7806",
        },
        conversationWorkspacePath: "C:\\workspace",
        serviceMode: false,
      }),
    ).toBe(false);
  });
});

function fakeBrowser(overrides: Partial<CamoufoxBrowser> = {}): CamoufoxBrowser {
  return {
    callPlaywrightMcp: async (request) => ({
      id: request.id,
      jsonrpc: "2.0",
      result: {},
    }),
    close: async () => undefined,
    fetchPage: async (url) => pageResult(url),
    screenshotPage: async (_url, options) => ({
      contentType: options.format === "png" ? "image/png" : "image/jpeg",
      data: Uint8Array.from([1, 2, 3, 4]),
      height: options.height,
      status: 200,
      statusText: "OK",
      title: "Screenshot",
      width: options.width,
    }),
    ...overrides,
  };
}

function pageResult(url: URL): CamoufoxPageFetchResult {
  return {
    content: url.href,
    contentType: "text/html",
    headers: {},
    status: 200,
    statusText: "OK",
  };
}

function mcpDefinition(id: string, trussManaged: boolean): McpServerDefinition {
  return {
    command: "truss",
    configPath: "mcp.json",
    id,
    name: id,
    source: id.split(":")[0] ?? "workspace",
    transport: "stdio",
    trussManaged,
  };
}
