import { describe, expect, it } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import AdmZip from "adm-zip";
import {
  camoufoxLauncherChildScript,
  defaultUblockOriginFilterLists,
  ensureCamoufoxUblockOriginPolicy,
  mergeCamoufoxUblockOriginPolicy,
  mergeCamoufoxAddonConfigEnv,
  resolveCamoufoxAddonPaths,
} from "../../src/server/utils/camoufox-browser.ts";

const nodeCommand = process.env.TRUSS_CAMOUFOX_NODE?.trim() || "node";
const hasNode = (() => {
  try {
    return spawnSync(nodeCommand, ["--version"], { windowsHide: true }).status === 0;
  } catch {
    return false;
  }
})();

describe("Camoufox launcher", () => {
  it("merges add-on paths into Camoufox config env", () => {
    const env = {
      CAMOU_CONFIG_1: "{\"foo\":\"",
      CAMOU_CONFIG_2: "bar\",\"addons\":[\"C:/existing-addon\"]}",
    };

    mergeCamoufoxAddonConfigEnv(env, ["C:/managed-addon"]);

    expect(env.CAMOU_CONFIG_2).toBeUndefined();
    expect(JSON.parse(env.CAMOU_CONFIG_1 ?? "{}")).toEqual({
      addons: ["C:/existing-addon", "C:/managed-addon"],
      foo: "bar",
    });
  });

  it("keeps an empty Camoufox config when there are no add-ons", () => {
    const env: Record<string, string> = {};

    mergeCamoufoxAddonConfigEnv(env, []);

    expect(env.CAMOU_CONFIG_1).toBe("{}");
  });

  it("merges managed uBlock Origin filter lists into existing Firefox policies", () => {
    const existingAdminSettings = {
      userSettings: {
        colorBlindFriendly: true,
      },
    };
    const merged = mergeCamoufoxUblockOriginPolicy({
      policies: {
        DisableTelemetry: true,
        "3rdparty": {
          Extensions: {
            "other@example.test": {
              enabled: true,
            },
            "uBlock0@raymondhill.net": {
              adminSettings: JSON.stringify(existingAdminSettings),
              toOverwrite: {
                trustedSiteDirectives: ["about-scheme"],
              },
            },
          },
        },
      },
    });
    const policies = merged.policies as Record<string, unknown>;
    const thirdParty = policies["3rdparty"] as Record<string, unknown>;
    const extensions = thirdParty.Extensions as Record<string, unknown>;
    const ublockPolicy = extensions["uBlock0@raymondhill.net"] as Record<string, unknown>;

    expect(policies.DisableTelemetry).toBe(true);
    expect(extensions["other@example.test"]).toEqual({
      enabled: true,
    });
    expect(JSON.parse(String(ublockPolicy.adminSettings))).toEqual({
      ...existingAdminSettings,
      selectedFilterLists: [...defaultUblockOriginFilterLists],
    });
    expect(ublockPolicy.toOverwrite).toEqual({
      filterLists: [...defaultUblockOriginFilterLists],
      trustedSiteDirectives: ["about-scheme"],
    });
  });

  it("writes bundled uBlock Origin managed policies only when changed", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "truss-camoufox-policy-test-"));
    const policiesPath = join(tempDir, "distribution", "policies.json");

    try {
      await mkdir(join(tempDir, "distribution"), { recursive: true });
      await writeFile(
        policiesPath,
        `${JSON.stringify({ policies: { DisableTelemetry: true } }, null, 2)}\n`,
        "utf8",
      );

      expect(ensureCamoufoxUblockOriginPolicy(tempDir)).toBe(true);
      expect(ensureCamoufoxUblockOriginPolicy(tempDir)).toBe(false);

      const parsed = JSON.parse(await readFile(policiesPath, "utf8")) as {
        policies: {
          "3rdparty": {
            Extensions: Record<string, { toOverwrite?: { filterLists?: string[] } }>;
          };
          DisableTelemetry: boolean;
        };
      };

      expect(parsed.policies.DisableTelemetry).toBe(true);
      expect(
        parsed.policies["3rdparty"].Extensions["uBlock0@raymondhill.net"]?.toOverwrite
          ?.filterLists,
      ).toEqual([...defaultUblockOriginFilterLists]);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("downloads and extracts configured Camoufox addon URLs", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "truss-camoufox-addon-test-"));
    const xpiPath = join(tempDir, "test-addon.xpi");
    const zip = new AdmZip();
    let requests = 0;

    zip.addFile(
      "manifest.json",
      Buffer.from(JSON.stringify({ manifest_version: 2, name: "Test Addon", version: "1.0.0" })),
    );
    zip.writeZip(xpiPath);

    const server = createServer(async (_request, response) => {
      requests += 1;
      response.statusCode = 200;
      response.setHeader("content-type", "application/x-xpinstall");
      response.end(await readFile(xpiPath));
    });

    try {
      const port = await listen(server);
      const url = `http://127.0.0.1:${port}/test-addon.xpi`;
      const paths = await resolveCamoufoxAddonPaths({
        env: {
          TRUSS_CAMOUFOX_ADDON_URLS: url,
          TRUSS_CAMOUFOX_DEFAULT_ADDONS: "false",
        },
        log: () => undefined,
        trussHomeDir: tempDir,
      });

      expect(paths).toHaveLength(1);
      await expect(readFile(join(paths[0] ?? "", "manifest.json"), "utf8")).resolves.toContain(
        "Test Addon",
      );

      const cachedPaths = await resolveCamoufoxAddonPaths({
        env: {
          TRUSS_CAMOUFOX_ADDON_URLS: url,
          TRUSS_CAMOUFOX_DEFAULT_ADDONS: "false",
        },
        log: () => undefined,
        trussHomeDir: tempDir,
      });

      expect(cachedPaths).toEqual(paths);
      expect(requests).toBe(1);
    } finally {
      await closeServer(server);
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  (hasNode ? it : it.skip)("returns fetch results before slow tab cleanup finishes", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "truss-camoufox-test-"));
    const fakeModulePath = join(tempDir, "fake-playwright.mjs");
    const logPath = join(tempDir, "events.jsonl");

    try {
      await writeFile(fakeModulePath, fakePlaywrightModule(), "utf8");

      const child = spawn(nodeCommand, ["--input-type=module", "-e", camoufoxLauncherChildScript], {
        env: {
          ...process.env,
          TRUSS_CAMOUFOX_CHILD_EXECUTABLE: "fake-camoufox",
          TRUSS_CAMOUFOX_CHILD_HEADLESS: "true",
          TRUSS_CAMOUFOX_TAB_BATCH_WINDOW_MS: "0",
          TRUSS_FAKE_CAMOUFOX_CLOSE_DELAY_MS: "500",
          TRUSS_FAKE_CAMOUFOX_LOG: logPath,
          TRUSS_FAKE_CAMOUFOX_PAGE_DELAY_MS: "1",
          TRUSS_PLAYWRIGHT_CORE_MODULE: pathToFileURL(fakeModulePath).href,
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const output = collectJsonLines(child.stdout);
      let stderr = "";

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      try {
        await waitUntil(
          () => output.messages.some((message) => message.event === "ready"),
          () => `Camoufox launcher did not become ready. stderr: ${stderr}`,
        );

        child.stdin.write(`${JSON.stringify(fetchRequest(1, "https://example.com/slow-close"))}\n`);

        await waitUntil(
          () => output.messages.some((message) => isResponse(message) && message.id === 1),
          () => `Camoufox launcher did not return response before cleanup. stderr: ${stderr}`,
        );

        const eventsBeforeCleanupFinished = await readEvents(logPath);

        expect(
          eventsBeforeCleanupFinished.some((event) => event.event === "page_close"),
        ).toBe(false);

        await waitUntilAsync(
          async () => (await readEvents(logPath)).some((event) => event.event === "page_close"),
          () => `Camoufox launcher did not finish delayed cleanup. stderr: ${stderr}`,
        );

        child.stdin.write(`${JSON.stringify({ id: 99, method: "close" })}\n`);
        await waitForExit(child);
      } finally {
        child.kill();
      }

      expect(stderr).toContain("Cleaning up Camoufox tab.");
      expect(stderr).toContain("Camoufox tab cleanup finished.");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  (hasNode ? it : it.skip)("fails fetches that exceed the page load timeout", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "truss-camoufox-test-"));
    const fakeModulePath = join(tempDir, "fake-playwright.mjs");
    const logPath = join(tempDir, "events.jsonl");

    try {
      await writeFile(fakeModulePath, fakePlaywrightModule(), "utf8");

      const child = spawn(nodeCommand, ["--input-type=module", "-e", camoufoxLauncherChildScript], {
        env: {
          ...process.env,
          TRUSS_CAMOUFOX_CHILD_EXECUTABLE: "fake-camoufox",
          TRUSS_CAMOUFOX_CHILD_HEADLESS: "true",
          TRUSS_CAMOUFOX_PAGE_TIMEOUT_MS: "50",
          TRUSS_CAMOUFOX_TAB_BATCH_WINDOW_MS: "0",
          TRUSS_FAKE_CAMOUFOX_LOG: logPath,
          TRUSS_FAKE_CAMOUFOX_PAGE_DELAY_MS: "200",
          TRUSS_PLAYWRIGHT_CORE_MODULE: pathToFileURL(fakeModulePath).href,
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const output = collectJsonLines(child.stdout);
      let stderr = "";

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      try {
        await waitUntil(
          () => output.messages.some((message) => message.event === "ready"),
          () => `Camoufox launcher did not become ready. stderr: ${stderr}`,
        );

        child.stdin.write(`${JSON.stringify(fetchRequest(1, "https://example.com/timeout"))}\n`);

        await waitUntil(
          () => output.messages.some((message) => isResponse(message) && message.id === 1),
          () => `Camoufox launcher did not return timeout response. stderr: ${stderr}`,
        );

        child.stdin.write(`${JSON.stringify({ id: 99, method: "close" })}\n`);
        await waitForExit(child);
      } finally {
        child.kill();
      }

      const response = output.messages.find(
        (message) => isResponse(message) && message.id === 1,
      );
      const events = await readEvents(logPath);

      expect(response?.ok).toBe(false);
      expect(String(response?.error ?? "")).toContain("Fake navigation timeout after 50");
      expect(events).toContainEqual(
        expect.objectContaining({
          event: "goto_timeout",
          timeout: 50,
          url: "https://example.com/timeout",
        }),
      );
      expect(stderr).toContain('"reason":"request_failed"');
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  (hasNode ? it : it.skip)("cancels an in-flight fetch by launcher request id", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "truss-camoufox-test-"));
    const fakeModulePath = join(tempDir, "fake-playwright.mjs");
    const logPath = join(tempDir, "events.jsonl");

    try {
      await writeFile(fakeModulePath, fakePlaywrightModule(), "utf8");

      const child = spawn(nodeCommand, ["--input-type=module", "-e", camoufoxLauncherChildScript], {
        env: {
          ...process.env,
          TRUSS_CAMOUFOX_CHILD_EXECUTABLE: "fake-camoufox",
          TRUSS_CAMOUFOX_CHILD_HEADLESS: "true",
          TRUSS_CAMOUFOX_REQUEST_TIMEOUT_MS: "5000",
          TRUSS_CAMOUFOX_TAB_BATCH_WINDOW_MS: "0",
          TRUSS_FAKE_CAMOUFOX_LOG: logPath,
          TRUSS_FAKE_CAMOUFOX_PAGE_DELAY_MS: "1000",
          TRUSS_PLAYWRIGHT_CORE_MODULE: pathToFileURL(fakeModulePath).href,
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const output = collectJsonLines(child.stdout);
      let stderr = "";

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      try {
        await waitUntil(
          () => output.messages.some((message) => message.event === "ready"),
          () => `Camoufox launcher did not become ready. stderr: ${stderr}`,
        );

        child.stdin.write(`${JSON.stringify(fetchRequest(1, "https://example.com/cancel"))}\n`);
        await waitUntilAsync(
          async () =>
            (await readEvents(logPath)).some(
              (event) => event.event === "goto_start" && event.url === "https://example.com/cancel",
            ),
          () => `Camoufox launcher did not start navigation. stderr: ${stderr}`,
        );

        child.stdin.write(
          `${JSON.stringify({ id: 2, method: "cancel", reason: "test_cancel", requestId: 1 })}\n`,
        );

        await waitUntil(
          () => output.messages.some((message) => isResponse(message) && message.id === 1),
          () => `Camoufox launcher did not return cancellation response. stderr: ${stderr}`,
        );

        child.stdin.write(`${JSON.stringify({ id: 99, method: "close" })}\n`);
        await waitForExit(child);
      } finally {
        child.kill();
      }

      const response = output.messages.find(
        (message) => isResponse(message) && message.id === 1,
      );
      const cancelAck = output.messages.find(
        (message) => isResponse(message) && message.id === 2,
      );
      const events = await readEvents(logPath);

      expect(cancelAck?.ok).toBe(true);
      expect(response?.ok).toBe(false);
      expect(String(response?.error ?? "")).toContain("test_cancel");
      expect(events).toContainEqual(expect.objectContaining({ event: "page_close" }));
      expect(stderr).toContain('"reason":"request_cancelled"');
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  (hasNode ? it : it.skip)("rejects oversized fetched content inside the launcher child", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "truss-camoufox-test-"));
    const fakeModulePath = join(tempDir, "fake-playwright.mjs");
    const logPath = join(tempDir, "events.jsonl");

    try {
      await writeFile(fakeModulePath, fakePlaywrightModule(), "utf8");

      const child = spawn(nodeCommand, ["--input-type=module", "-e", camoufoxLauncherChildScript], {
        env: {
          ...process.env,
          TRUSS_CAMOUFOX_CHILD_EXECUTABLE: "fake-camoufox",
          TRUSS_CAMOUFOX_CHILD_HEADLESS: "true",
          TRUSS_CAMOUFOX_MAX_RESPONSE_BYTES: "20",
          TRUSS_CAMOUFOX_TAB_BATCH_WINDOW_MS: "0",
          TRUSS_FAKE_CAMOUFOX_LOG: logPath,
          TRUSS_FAKE_CAMOUFOX_PAGE_DELAY_MS: "1",
          TRUSS_PLAYWRIGHT_CORE_MODULE: pathToFileURL(fakeModulePath).href,
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const output = collectJsonLines(child.stdout);
      let stderr = "";

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      try {
        await waitUntil(
          () => output.messages.some((message) => message.event === "ready"),
          () => `Camoufox launcher did not become ready. stderr: ${stderr}`,
        );

        child.stdin.write(`${JSON.stringify(fetchRequest(1, "https://example.com/too-large"))}\n`);

        await waitUntil(
          () => output.messages.some((message) => isResponse(message) && message.id === 1),
          () => `Camoufox launcher did not return oversized response. stderr: ${stderr}`,
        );

        child.stdin.write(`${JSON.stringify({ id: 99, method: "close" })}\n`);
        await waitForExit(child);
      } finally {
        child.kill();
      }

      const response = output.messages.find(
        (message) => isResponse(message) && message.id === 1,
      );

      expect(response?.ok).toBe(false);
      expect(String(response?.error ?? "")).toContain("downloaded");
      expect(String(response?.error ?? "")).toContain("20 B");
      expect(stderr).toContain('"reason":"request_failed"');
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  (hasNode ? it : it.skip)("hosts Playwright MCP requests inside the launcher child", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "truss-camoufox-test-"));
    const fakeModulePath = join(tempDir, "fake-playwright.mjs");
    const fakeMcpModulePath = join(tempDir, "fake-playwright-mcp.mjs");
    const logPath = join(tempDir, "events.jsonl");

    try {
      await writeFile(fakeModulePath, fakePlaywrightModule(), "utf8");
      await writeFile(fakeMcpModulePath, fakePlaywrightMcpModule(), "utf8");

      const child = spawn(nodeCommand, ["--input-type=module", "-e", camoufoxLauncherChildScript], {
        env: {
          ...process.env,
          TRUSS_CAMOUFOX_CHILD_EXECUTABLE: "fake-camoufox",
          TRUSS_CAMOUFOX_CHILD_HEADLESS: "true",
          TRUSS_CAMOUFOX_TAB_BATCH_WINDOW_MS: "0",
          TRUSS_FAKE_CAMOUFOX_LOG: logPath,
          TRUSS_PLAYWRIGHT_CORE_MODULE: pathToFileURL(fakeModulePath).href,
          TRUSS_PLAYWRIGHT_MCP_MODULE: pathToFileURL(fakeMcpModulePath).href,
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const output = collectJsonLines(child.stdout);
      let stderr = "";

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      try {
        await waitUntil(
          () => output.messages.some((message) => message.event === "ready"),
          () => `Camoufox launcher did not become ready. stderr: ${stderr}`,
        );

        child.stdin.write(
          `${JSON.stringify(
            playwrightMcpRequest(1, {
              id: "list",
              jsonrpc: "2.0",
              method: "tools/list",
            }),
          )}\n`,
        );
        child.stdin.write(
          `${JSON.stringify(
            playwrightMcpRequest(2, {
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
          )}\n`,
        );

        await waitUntil(
          () =>
            output.messages.some((message) => isResponse(message) && message.id === 2),
          () => `Camoufox launcher did not return Playwright MCP response. stderr: ${stderr}`,
        );

        child.stdin.write(`${JSON.stringify({ id: 99, method: "close" })}\n`);
        await waitForExit(child);
      } finally {
        child.kill();
      }

      const listResponse = output.messages.find(
        (message) => isResponse(message) && message.id === 1,
      );
      const callResponse = output.messages.find(
        (message) => isResponse(message) && message.id === 2,
      );
      const events = await readEvents(logPath);

      expect(listResponse?.ok).toBe(true);
      expect(listResponse?.result).toMatchObject({
        jsonrpc: "2.0",
        id: "list",
        result: {
          tools: [{ name: "browser_navigate" }],
        },
      });
      expect(callResponse?.ok).toBe(true);
      expect(callResponse?.result).toMatchObject({
        jsonrpc: "2.0",
        id: "navigate",
        result: {
          content: [
            {
              text: "fake mcp browser_navigate",
              type: "text",
            },
          ],
        },
      });
      expect(events.filter((event) => event.event === "context_open")).toHaveLength(2);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  (hasNode ? it : it.skip)("opens concurrent fetches in separate tabs and closes them", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "truss-camoufox-test-"));
    const fakeModulePath = join(tempDir, "fake-playwright.mjs");
    const logPath = join(tempDir, "events.jsonl");

    try {
      await writeFile(fakeModulePath, fakePlaywrightModule(), "utf8");

      const child = spawn(nodeCommand, ["--input-type=module", "-e", camoufoxLauncherChildScript], {
        env: {
          ...process.env,
          TRUSS_CAMOUFOX_CHILD_EXECUTABLE: "fake-camoufox",
          TRUSS_CAMOUFOX_CHILD_HEADLESS: "false",
          TRUSS_FAKE_CAMOUFOX_LOG: logPath,
          TRUSS_FAKE_CAMOUFOX_PAGE_DELAY_MS: "80",
          TRUSS_PLAYWRIGHT_CORE_MODULE: pathToFileURL(fakeModulePath).href,
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const output = collectJsonLines(child.stdout);
      let stderr = "";

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      try {
        await waitUntil(
          () => output.messages.some((message) => message.event === "ready"),
          () => `Camoufox launcher did not become ready. stderr: ${stderr}`,
        );

        child.stdin.write(`${JSON.stringify(fetchRequest(1, "https://example.com/one"))}\n`);
        child.stdin.write(`${JSON.stringify(fetchRequest(2, "https://example.org/two"))}\n`);

        await waitUntil(
          () => output.messages.filter(isResponse).length >= 2,
          () => `Camoufox launcher did not return both responses. stderr: ${stderr}`,
        );

        child.stdin.write(`${JSON.stringify({ id: 99, method: "close" })}\n`);
        await waitForExit(child);
      } finally {
        child.kill();
      }

      const responses = output.messages
        .filter(isResponse)
        .filter((response) => response.id !== 99)
        .sort((a, b) => a.id - b.id);

      expect(responses.map((response) => response.id)).toEqual([1, 2]);
      expect(responses.every((response) => response.ok === true)).toBe(true);

      const events = await readEvents(logPath);
      const browserLaunchEvent = events.find((event) => event.event === "browser_launch");
      const pageOpenEvents = events.filter((event) => event.event === "page_open");
      const pageCloseEvents = events.filter((event) => event.event === "page_close");
      const firstGotoStartIndex = events.findIndex((event) => event.event === "goto_start");
      const firstGotoStartEvent = events.find((event) => event.event === "goto_start");
      const firstPageCloseIndex = events.findIndex((event) => event.event === "page_close");
      const secondPageOpenIndex = events.findIndex(
        (event) => event.event === "page_open" && event.pageId === 2,
      );
      const secondGotoStartIndex = events.findIndex(
        (event) => event.event === "goto_start" && event.url === "https://example.org/two",
      );
      const maxActivePages = Math.max(
        ...events.map((event) =>
          typeof event.activePages === "number" ? event.activePages : 0,
        ),
      );

      expect(browserLaunchEvent?.headless).toBe(true);
      expect(pageOpenEvents).toHaveLength(2);
      expect(secondPageOpenIndex).toBeGreaterThan(-1);
      expect(firstGotoStartIndex).toBeGreaterThan(-1);
      expect(firstGotoStartEvent?.timeout).toBe(10000);
      expect(secondPageOpenIndex).toBeLessThan(firstGotoStartIndex);
      expect(secondGotoStartIndex).toBeGreaterThan(-1);
      expect(firstPageCloseIndex).toBeGreaterThan(-1);
      expect(secondGotoStartIndex).toBeLessThan(firstPageCloseIndex);
      expect(maxActivePages).toBe(2);
      expect(pageCloseEvents).toHaveLength(2);
      expect(countOccurrences(stderr, "Opened Camoufox tab for page load.")).toBe(2);
      expect(stderr).toContain('"activeTabs":2');
      expect(countOccurrences(stderr, "Cleaning up Camoufox tab.")).toBe(2);
      expect(countOccurrences(stderr, "Camoufox tab cleanup finished.")).toBe(2);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});

function listen(server: Server): Promise<number> {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      const address = server.address() as AddressInfo | null;

      if (!address) {
        rejectListen(new Error("Test HTTP server did not expose an address."));
        return;
      }

      resolveListen(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    if (!server.listening) {
      resolveClose();
      return;
    }

    server.close((error) => {
      if (error) {
        rejectClose(error);
        return;
      }

      resolveClose();
    });
  });
}

function fetchRequest(id: number, url: string): Record<string, unknown> {
  return {
    height: 1080,
    id,
    method: "fetchPage",
    url,
    width: 1024,
  };
}

function playwrightMcpRequest(id: number, mcpRequest: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    mcpRequest,
    method: "playwrightMcpRequest",
  };
}

function collectJsonLines(stream: NodeJS.ReadableStream): {
  messages: Array<Record<string, unknown>>;
} {
  const output = {
    messages: [] as Array<Record<string, unknown>>,
  };
  let buffer = "";

  stream.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/u);

    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      output.messages.push(JSON.parse(trimmed) as Record<string, unknown>);
    }
  });

  return output;
}

async function waitUntil(
  condition: () => boolean,
  errorMessage: () => string,
  timeoutMs = 5_000,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) {
      return;
    }

    await sleep(10);
  }

  throw new Error(errorMessage());
}

async function waitUntilAsync(
  condition: () => Promise<boolean>,
  errorMessage: () => string,
  timeoutMs = 5_000,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) {
      return;
    }

    await sleep(10);
  }

  throw new Error(errorMessage());
}

function waitForExit(child: ReturnType<typeof spawn>, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for Camoufox launcher to exit."));
    }, timeoutMs);

    child.once("exit", (code) => {
      clearTimeout(timer);

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Camoufox launcher exited with code ${code ?? "unknown"}.`));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function isResponse(value: Record<string, unknown>): value is {
  error?: unknown;
  id: number;
  ok: boolean;
  result?: unknown;
} {
  return typeof value.id === "number" && typeof value.ok === "boolean";
}

function countOccurrences(value: string, pattern: string): number {
  return value.split(pattern).length - 1;
}

async function readEvents(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, "utf8");

  return text
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function fakePlaywrightModule(): string {
  return `
import { appendFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const logPath = process.env.TRUSS_FAKE_CAMOUFOX_LOG;
const delayMs = Number.parseInt(process.env.TRUSS_FAKE_CAMOUFOX_PAGE_DELAY_MS || "50", 10);
const closeDelayMs = Number.parseInt(process.env.TRUSS_FAKE_CAMOUFOX_CLOSE_DELAY_MS || "0", 10);
let activePages = 0;
let contextId = 0;
let pageId = 0;

function log(event) {
  appendFileSync(logPath, JSON.stringify(event) + "\\n");
}

export const firefox = {
  async launch(options) {
    log({ event: "browser_launch", headless: options?.headless });

    return {
      async newContext(options) {
        const currentContextId = ++contextId;

        log({ event: "context_open", contextId: currentContextId, viewport: options.viewport });

        return {
          async newPage() {
            const currentPageId = ++pageId;
            let currentUrl = "";

            activePages += 1;
            log({
              activePages,
              contextId: currentContextId,
              event: "page_open",
              pageId: currentPageId,
            });

            return {
              async goto(url, options) {
                currentUrl = url;
                const timeout = Number(options?.timeout);
                log({
                  activePages,
                  contextId: currentContextId,
                  event: "goto_start",
                  pageId: currentPageId,
                  timeout,
                  url,
                });
                if (Number.isFinite(timeout) && delayMs > timeout) {
                  await sleep(timeout);
                  log({
                    activePages,
                    contextId: currentContextId,
                    event: "goto_timeout",
                    pageId: currentPageId,
                    timeout,
                    url,
                  });
                  throw new Error("Fake navigation timeout after " + timeout + "ms for " + url);
                }
                await sleep(Number.isFinite(delayMs) ? delayMs : 50);
                log({
                  activePages,
                  contextId: currentContextId,
                  event: "goto_end",
                  pageId: currentPageId,
                  url,
                });

                return {
                  headers: () => ({ "content-type": "text/html; charset=utf-8" }),
                  status: () => 200,
                  statusText: () => "OK",
                  text: async () => "text " + url,
                };
              },
              async content() {
                return "<html><body>" + currentUrl + "</body></html>";
              },
              async close() {
                log({
                  activePages,
                  contextId: currentContextId,
                  event: "page_close_start",
                  pageId: currentPageId,
                });
                if (Number.isFinite(closeDelayMs) && closeDelayMs > 0) {
                  await sleep(closeDelayMs);
                }
                activePages -= 1;
                log({
                  activePages,
                  contextId: currentContextId,
                  event: "page_close",
                  pageId: currentPageId,
                });
              },
              async screenshot() {
                return Buffer.from("fake screenshot");
              },
              async title() {
                return currentUrl;
              },
            };
          },
          async close() {
            log({ event: "context_close", contextId: currentContextId });
          },
        };
      },
      async close() {
        log({ event: "browser_close" });
      },
    };
  },
};
`;
}

function fakePlaywrightMcpModule(): string {
  return `
export async function createConnection(_config, contextGetter) {
  return {
    async close() {},
    server: {
      onerror: null,
      async close() {},
      async connect(transport) {
        transport.onmessage = async (message) => {
          try {
            if (message.method === "initialize") {
              await transport.send({
                jsonrpc: "2.0",
                id: message.id,
                result: {
                  protocolVersion: "2024-11-05",
                  capabilities: { tools: {} },
                  serverInfo: { name: "Fake Playwright MCP", version: "0.0.0" },
                },
              });
              return;
            }

            if (message.method === "notifications/initialized") {
              return;
            }

            if (message.method === "tools/list") {
              await transport.send({
                jsonrpc: "2.0",
                id: message.id,
                result: {
                  tools: [{ name: "browser_navigate" }],
                },
              });
              return;
            }

            if (message.method === "tools/call") {
              await contextGetter();
              await transport.send({
                jsonrpc: "2.0",
                id: message.id,
                result: {
                  content: [
                    {
                      type: "text",
                      text: "fake mcp " + message.params.name,
                    },
                  ],
                },
              });
              return;
            }

            await transport.send({
              jsonrpc: "2.0",
              id: message.id,
              error: { code: -32601, message: "unknown" },
            });
          } catch (error) {
            transport.onerror?.(error);
          }
        };
        await transport.start();
      },
    },
  };
}
`;
}
