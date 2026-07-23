import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { arch as processArch, platform } from "node:process";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { Readable, Writable } from "node:stream";
import AdmZip from "adm-zip";
import { logHtmlRequest } from "./html-request-logging.ts";
import { errorForLog, messageFromUnknown, truncateForLog } from "./logging.ts";
import { isStandaloneRuntime } from "../runtime/project-root.ts";

export interface CamoufoxPageFetchResult {
  content: string;
  contentType: string;
  headers: Record<string, string>;
  note?: string;
  status: number;
  statusText: string;
}

export interface CamoufoxScreenshotResult {
  contentType: "image/jpeg" | "image/png";
  data: Uint8Array;
  height: number;
  note?: string;
  status: number;
  statusText: string;
  title: string | null;
  width: number;
}

export interface CamoufoxPlaywrightMcpRequest {
  id: number | string;
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface CamoufoxPlaywrightMcpResponse {
  error?: unknown;
  id: number | string | null;
  jsonrpc: "2.0";
  result?: unknown;
}

export interface CamoufoxBrowser {
  callPlaywrightMcp?(
    request: CamoufoxPlaywrightMcpRequest,
    options?: { signal?: AbortSignal },
  ): Promise<CamoufoxPlaywrightMcpResponse>;
  close(): Promise<void>;
  fetchPage(url: URL, options?: { signal?: AbortSignal }): Promise<CamoufoxPageFetchResult>;
  screenshotPage(
    url: URL,
    options: {
      format: "jpeg" | "png";
      height: number;
      quality: number;
      signal?: AbortSignal;
      width: number;
    },
  ): Promise<CamoufoxScreenshotResult>;
}

export interface CamoufoxBrowserOptions {
  env?: NodeJS.ProcessEnv;
  log?(channel: string, message: string, metadata?: Record<string, unknown>): void;
  startTimeoutMs?: number;
  trussHomeDir?: string;
}

interface CamoufoxInstallInfo {
  assetName: string;
  downloadedAt: string;
  releaseTag: string;
  url: string;
}

interface CamoufoxAddonInstallInfo {
  downloadedAt: string;
  name: string;
  url: string;
}

interface CamoufoxReleaseAsset {
  browser_download_url?: unknown;
  name?: unknown;
}

interface CamoufoxRelease {
  assets?: unknown;
}

interface CamoufoxLauncherServer {
  child: CamoufoxLauncherChild;
}

interface CamoufoxNodeCommand {
  args: string[];
  command: string;
}

const defaultStartTimeoutMs = 180_000;
const pageNavigationTimeoutMs = 10_000;
const networkIdleTimeoutMs = 5_000;
const childRequestTimeoutPaddingMs = 5_000;
const defaultChildRequestTimeoutMs =
  pageNavigationTimeoutMs + networkIdleTimeoutMs + childRequestTimeoutPaddingMs;
const defaultMaxResponseBytes = 3 * 1024 * 1024;
const defaultPlaywrightMcpRequestTimeoutMs = 95_000;
export const defaultCamoufoxReleaseTag = "v135.0.1-beta.24";
const defaultCamoufoxAddonUrls = [
  "https://addons.mozilla.org/firefox/downloads/file/4814095/ublock_origin-1.71.0.xpi",
];
const ublockOriginExtensionId = "uBlock0@raymondhill.net";
export const defaultUblockOriginFilterLists = [
  "ublock-filters",
  "ublock-badware",
  "ublock-privacy",
  "ublock-unbreak",
  "ublock-quick-fixes",
  "easylist",
  "easyprivacy",
  "urlhaus-1",
  "plowe-0",
  "fanboy-cookiemonster",
  "ublock-cookies-easylist",
  "adguard-cookies",
  "ublock-cookies-adguard",
] as const;
const camoufoxRepoApi = "https://api.github.com/repos/daijro/camoufox";
const installInfoFileName = "truss-camoufox.json";
const addonInstallInfoFileName = "truss-camoufox-addon.json";
const launcherShutdownTimeoutMs = 5_000;
export const camoufoxLauncherChildScript = `
async function main() {
  const { createInterface } = await import("node:readline");
  const moduleSpecifier = process.env.TRUSS_PLAYWRIGHT_CORE_MODULE || "playwright-core";
  const playwrightMcpModuleSpecifier = process.env.TRUSS_PLAYWRIGHT_MCP_MODULE || "@playwright/mcp";
  const { firefox } = await import(moduleSpecifier);
  const executablePath = process.env.TRUSS_CAMOUFOX_CHILD_EXECUTABLE;
  const timeout = Number.parseInt(process.env.TRUSS_CAMOUFOX_CHILD_TIMEOUT_MS || "", 10);
  const pageNavigationTimeout = Number.parseInt(process.env.TRUSS_CAMOUFOX_PAGE_TIMEOUT_MS || "", 10);
  const networkIdleTimeout = Number.parseInt(process.env.TRUSS_CAMOUFOX_NETWORK_IDLE_TIMEOUT_MS || "", 10);
  const requestTimeout = Number.parseInt(process.env.TRUSS_CAMOUFOX_REQUEST_TIMEOUT_MS || "", 10);
  const maxResponseBytes = Number.parseInt(process.env.TRUSS_CAMOUFOX_MAX_RESPONSE_BYTES || "", 10);
  const tabOpenBatchWindowMs = Number.parseInt(process.env.TRUSS_CAMOUFOX_TAB_BATCH_WINDOW_MS || "", 10);
  const tabCleanupTimeoutMs = Number.parseInt(process.env.TRUSS_CAMOUFOX_TAB_CLEANUP_TIMEOUT_MS || "", 10);

  if (!executablePath) {
    throw new Error("TRUSS_CAMOUFOX_CHILD_EXECUTABLE is required.");
  }

  const browser = await firefox.launch({
    executablePath,
    headless: true,
    timeout: Number.isFinite(timeout) ? timeout : 180000,
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key, value]) => (
        typeof value === "string" &&
        !key.startsWith("TRUSS_CAMOUFOX_CHILD_") &&
        key !== "TRUSS_PLAYWRIGHT_CORE_MODULE"
      )),
    ),
  });
  const defaultContextOptions = () => ({
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
    javaScriptEnabled: true,
    viewport: {
      height: 1080,
      width: 1024,
    },
  });
  const context = await browser.newContext(defaultContextOptions());
  const activeTabs = new Set();
  const activePlaywrightMcpRequests = new Map();
  const requestStates = new Map();
  const tabCleanupTasks = new Set();
  let playwrightMcpBridge = null;
  let playwrightMcpBridgePromise = null;
  let nextTabId = 1;
  let tabSetupQueue = Promise.resolve();
  let closing = false;
  const logLauncher = (message, details) => {
    let suffix = "";

    try {
      suffix = details ? " " + JSON.stringify(details) : "";
    } catch {
      suffix = "";
    }

    console.error(message + suffix);
  };
  const normalizeViewport = (viewport) => {
    const height = Number.parseInt(String(viewport?.height ?? ""), 10);
    const width = Number.parseInt(String(viewport?.width ?? ""), 10);

    return {
      height: Number.isFinite(height) && height > 0 ? height : 1080,
      width: Number.isFinite(width) && width > 0 ? width : 1024,
    };
  };
  const resolvedTabCleanupTimeoutMs = () =>
    Number.isFinite(tabCleanupTimeoutMs) ? Math.max(0, tabCleanupTimeoutMs) : 2000;
  const closePageWithTimeout = async (tab) => {
    const startedAt = Date.now();
    const closePromise = Promise.resolve().then(() => tab.page.close());
    let timer = null;
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ status: "timed_out" }), resolvedTabCleanupTimeoutMs());
    });
    const result = await Promise.race([
      closePromise.then(
        () => ({ status: "closed" }),
        (error) => ({ error, status: "failed" }),
      ),
      timeoutPromise,
    ]);

    if (timer) {
      clearTimeout(timer);
    }

    if (result.status === "timed_out") {
      closePromise.catch(() => undefined);
    }

    return {
      ...result,
      durationMs: Date.now() - startedAt,
    };
  };
  const closeTab = async (tab, reason) => {
    if (tab.closed) {
      return;
    }

    tab.closed = true;
    const activeTabsBefore = activeTabs.size;

    activeTabs.delete(tab);
    logLauncher("Cleaning up Camoufox tab.", {
      activeTabs: activeTabs.size,
      activeTabsBefore,
      method: tab.method,
      reason,
      requestId: tab.requestId,
      tabId: tab.tabId,
      url: tab.url,
    });

    const closeResult = await closePageWithTimeout(tab);

    if (closeResult.status === "failed") {
      logLauncher("Failed to close Camoufox tab page.", {
        durationMs: closeResult.durationMs,
        error: closeResult.error?.stack || closeResult.error?.message || String(closeResult.error),
        method: tab.method,
        reason,
        requestId: tab.requestId,
        tabId: tab.tabId,
        url: tab.url,
      });
    }

    if (closeResult.status === "timed_out") {
      logLauncher("Camoufox tab cleanup timed out.", {
        durationMs: closeResult.durationMs,
        method: tab.method,
        reason,
        requestId: tab.requestId,
        tabId: tab.tabId,
        timeoutMs: resolvedTabCleanupTimeoutMs(),
        url: tab.url,
      });
    }

    logLauncher("Camoufox tab cleanup finished.", {
      activeTabs: activeTabs.size,
      closeStatus: closeResult.status,
      durationMs: closeResult.durationMs,
      method: tab.method,
      reason,
      requestId: tab.requestId,
      tabId: tab.tabId,
      url: tab.url,
    });
  };
  const scheduleCloseTab = (tab, reason) => {
    let task = null;

    task = closeTab(tab, reason)
      .catch((error) => {
        logLauncher("Camoufox tab cleanup task failed.", {
          error: error?.stack || error?.message || String(error),
          method: tab.method,
          reason,
          requestId: tab.requestId,
          tabId: tab.tabId,
          url: tab.url,
        });
      })
      .finally(() => {
        tabCleanupTasks.delete(task);
      });
    tabCleanupTasks.add(task);
  };
  const closeActiveTabs = async (reason) => {
    if (activeTabs.size > 0) {
      logLauncher("Cleaning up active Camoufox tabs.", {
        activeTabs: activeTabs.size,
        reason,
      });
    }

    await Promise.allSettled(Array.from(activeTabs, (tab) => closeTab(tab, reason)));
    if (tabCleanupTasks.size > 0) {
      logLauncher("Waiting for Camoufox tab cleanup tasks.", {
        cleanupTasks: tabCleanupTasks.size,
        reason,
      });
      await Promise.allSettled(Array.from(tabCleanupTasks));
    }
  };
  const shutdown = async () => {
    if (closing) {
      return;
    }

    closing = true;
    try {
      if (playwrightMcpBridge) {
        await playwrightMcpBridge.connection.close().catch(() => undefined);
        playwrightMcpBridge = null;
      }
      playwrightMcpBridgePromise = null;
      await closeActiveTabs("launcher_shutdown");
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    } finally {
      process.exit(0);
    }
  };

  const writeMessage = (message) => {
    process.stdout.write(JSON.stringify(message) + "\\n");
  };
  const normalizeTitle = (value) => {
    const title = String(value || "").replace(/\\s+/g, " ").trim();
    return title || null;
  };
  const shouldReadRenderedDom = (contentType) => {
    const mediaType = String(contentType || "").split(";", 1)[0].trim().toLowerCase();
    return !mediaType || mediaType === "text/html" || mediaType === "application/xhtml+xml";
  };
  const resolvedNetworkIdleTimeoutMs = () =>
    Number.isFinite(networkIdleTimeout) ? Math.max(0, networkIdleTimeout) : 5000;
  const resolvedPageLoadTimeoutMs = () =>
    Number.isFinite(pageNavigationTimeout) ? Math.max(1, pageNavigationTimeout) : 10000;
  const resolvedRequestTimeoutMs = () =>
    Number.isFinite(requestTimeout)
      ? Math.max(1, requestTimeout)
      : resolvedPageLoadTimeoutMs() + resolvedNetworkIdleTimeoutMs() + 5000;
  const resolvedMaxResponseBytes = () =>
    Number.isFinite(maxResponseBytes) ? Math.max(1, maxResponseBytes) : 3145728;
  const formatBytes = (value) => {
    if (value < 1024) {
      return value + " B";
    }

    if (value < 1024 * 1024) {
      return (value / 1024).toFixed(1) + " KiB";
    }

    return (value / (1024 * 1024)).toFixed(1) + " MiB";
  };
  const headerValue = (headers, name) => {
    const lowerName = name.toLowerCase();

    for (const [key, value] of Object.entries(headers || {})) {
      if (String(key).toLowerCase() === lowerName) {
        return String(value || "");
      }
    }

    return "";
  };
  const assertContentLengthWithinLimit = (url, headers) => {
    const contentLength = Number.parseInt(headerValue(headers, "content-length"), 10);
    const maxBytes = resolvedMaxResponseBytes();

    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(
        "Webpage " + url + " is too large to load: content-length " +
          formatBytes(contentLength) + " exceeds the " + formatBytes(maxBytes) + " limit.",
      );
    }
  };
  const assertContentWithinLimit = (url, content) => {
    const byteLength = Buffer.byteLength(String(content || ""), "utf8");
    const maxBytes = resolvedMaxResponseBytes();

    if (byteLength > maxBytes) {
      throw new Error(
        "Webpage " + url + " is too large to load: downloaded " +
          formatBytes(byteLength) + " exceeds the " + formatBytes(maxBytes) + " limit.",
      );
    }
  };
  const navigatePage = async (page, url) => {
    const startedAt = Date.now();
    const timeoutMs = resolvedPageLoadTimeoutMs();
    let response = null;
    let timedOut = false;

    try {
      response = await page.goto(url, {
        timeout: timeoutMs,
        waitUntil: "domcontentloaded",
      });
    } catch (error) {
      const message = String(error && error.message ? error.message : error);

      if (!/Timeout \d+ms exceeded/i.test(message)) {
        throw error;
      }

      timedOut = true;
    }

    if (!response) {
      if (timedOut) {
        return {
          response: null,
          timedOut: true,
          timeoutMs,
        };
      }

      throw new Error("No response received from " + url + ".");
    }

    try {
      const remainingMs = timeoutMs - (Date.now() - startedAt);

      if (remainingMs <= 0) {
        return { response, timedOut: false, timeoutMs };
      }

      await page.waitForLoadState("networkidle", {
        timeout: Math.min(
          resolvedNetworkIdleTimeoutMs(),
          remainingMs,
        ),
      });
    } catch {
      // Useful pages often keep background requests open.
    }

    return { response, timedOut: false, timeoutMs };
  };
  const withTabSetupLock = (callback) => {
    const task = tabSetupQueue.catch(() => undefined).then(callback);

    tabSetupQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };
  const waitForTabOpenBatch = () =>
    new Promise((resolve) =>
      setTimeout(
        resolve,
        Number.isFinite(tabOpenBatchWindowMs) ? Math.max(0, tabOpenBatchWindowMs) : 50,
      ),
    );
  const openTab = (request, viewport) => withTabSetupLock(async () => {
    if (closing) {
      throw new Error("Camoufox launcher is closing.");
    }

    const normalizedViewport = normalizeViewport(viewport);
    const requestDetails = {
      method: request.method,
      requestId: request.id,
      url: request.url,
      viewport: normalizedViewport,
    };

    logLauncher("Opening Camoufox tab for page load.", {
      ...requestDetails,
      activeTabs: activeTabs.size,
    });

    const page = await context.newPage();

    try {
      if (typeof page.setViewportSize === "function") {
        await page.setViewportSize(normalizedViewport);
      }
    } catch (error) {
      await page.close().catch(() => undefined);
      throw error;
    }

    const tab = {
      closed: false,
      method: request.method,
      page,
      requestId: request.id,
      tabId: nextTabId++,
      url: request.url,
    };

    activeTabs.add(tab);
    logLauncher("Opened Camoufox tab for page load.", {
      ...requestDetails,
      activeTabs: activeTabs.size,
      tabId: tab.tabId,
    });
    return tab;
  });
  const cancellationMessage = (state) =>
    state.cancelMessage || "Camoufox request " + state.id + " was cancelled.";
  const createRequestState = (request) => {
    let resolveCancellation;
    const state = {
      cancelMessage: null,
      cancelReason: null,
      cancelled: false,
      cancellation: new Promise((resolve) => {
        resolveCancellation = resolve;
      }),
      id: request.id,
      method: request.method,
      tab: null,
      cancel(reason, message) {
        if (this.cancelled) {
          return;
        }

        this.cancelled = true;
        this.cancelReason = reason;
        this.cancelMessage =
          message || "Camoufox request " + this.id + " was cancelled.";
        resolveCancellation();

        if (this.tab) {
          scheduleCloseTab(this.tab, reason);
        }
      },
      throwIfCancelled() {
        if (this.cancelled) {
          throw new Error(cancellationMessage(this));
        }
      },
    };

    requestStates.set(request.id, state);
    return state;
  };
  const raceRequest = async (state, promise) => {
    state.throwIfCancelled();
    return await Promise.race([
      promise,
      state.cancellation.then(() => {
        throw new Error(cancellationMessage(state));
      }),
    ]);
  };
  const runCancellableRequest = async (request, callback) => {
    const state = createRequestState(request);
    const timeoutMs = resolvedRequestTimeoutMs();
    const timer = setTimeout(() => {
      state.cancel(
        "request_timeout",
        "Camoufox request " + request.id + " timed out after " + timeoutMs + "ms.",
      );
    }, timeoutMs);

    try {
      const result = await raceRequest(state, callback(state));
      state.throwIfCancelled();
      return result;
    } finally {
      clearTimeout(timer);
      requestStates.delete(request.id);
    }
  };
  const cancelRequest = (request) => {
    const requestId = Number(request.requestId);

    if (!Number.isFinite(requestId)) {
      throw new Error("Camoufox cancel request requires numeric requestId.");
    }

    const state = requestStates.get(requestId);

    if (state) {
      state.cancel(
        "request_cancelled",
        typeof request.reason === "string" && request.reason.trim()
          ? "Camoufox request " + requestId + " was cancelled: " + request.reason.trim()
          : "Camoufox request " + requestId + " was cancelled.",
      );
      return true;
    }

    const mcpRequestId = activePlaywrightMcpRequests.get(requestId);

    if (mcpRequestId === undefined) {
      return false;
    }

    if (playwrightMcpBridge) {
      playwrightMcpBridge.transport.notify({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: {
          requestId: mcpRequestId,
          reason: typeof request.reason === "string" && request.reason.trim()
            ? request.reason.trim()
            : "request_cancelled",
        },
      });
    }

    return true;
  };
  const withPage = async (request, viewport, state, callback) => {
    if (closing) {
      throw new Error("Camoufox launcher is closing.");
    }

    let tab = null;
    let cleanupReason = "request_finished";

    try {
      const tabPromise = openTab(request, viewport);
      tabPromise
        .then((openedTab) => {
          if (state.cancelled) {
            scheduleCloseTab(openedTab, state.cancelReason || "request_cancelled");
          }
        })
        .catch(() => undefined);
      tab = await raceRequest(state, tabPromise);
      state.tab = tab;
      state.throwIfCancelled();
      await raceRequest(state, waitForTabOpenBatch());
      await raceRequest(state, tabSetupQueue);
      return await callback(tab.page, state);
    } catch (error) {
      cleanupReason = state.cancelled ? state.cancelReason || "request_cancelled" : "request_failed";
      throw error;
    } finally {
      if (tab) {
        if (state.tab === tab) {
          state.tab = null;
        }
        scheduleCloseTab(tab, cleanupReason);
      }
    }
  };
  const isJsonRpcResponse = (message) =>
    message &&
    typeof message === "object" &&
    message.jsonrpc === "2.0" &&
    Object.prototype.hasOwnProperty.call(message, "id") &&
    (
      Object.prototype.hasOwnProperty.call(message, "result") ||
      Object.prototype.hasOwnProperty.call(message, "error")
    );
  const createPlaywrightMcpTransport = () => {
    const pendingResponses = new Map();
    const transport = {
      onclose: undefined,
      onerror: undefined,
      onmessage: undefined,
      async close() {
        for (const pending of pendingResponses.values()) {
          pending.reject(new Error("Playwright MCP bridge closed."));
        }

        pendingResponses.clear();
        if (typeof transport.onclose === "function") {
          transport.onclose();
        }
      },
      async send(message) {
        if (isJsonRpcResponse(message)) {
          const pending = pendingResponses.get(String(message.id));

          if (pending) {
            pendingResponses.delete(String(message.id));
            pending.resolve(message);
          }

          return;
        }

        if (message && typeof message === "object" && typeof message.method === "string") {
          logLauncher("Playwright MCP bridge notification.", {
            method: message.method,
          });
        }
      },
      async start() {},
      notify(message) {
        if (typeof transport.onmessage !== "function") {
          throw new Error("Playwright MCP bridge transport is not connected.");
        }

        transport.onmessage(message);
      },
      request(message) {
        if (!isValidMcpRequest(message)) {
          return Promise.reject(new Error("Invalid Playwright MCP JSON-RPC request."));
        }

        if (typeof transport.onmessage !== "function") {
          return Promise.reject(new Error("Playwright MCP bridge transport is not connected."));
        }

        return new Promise((resolve, reject) => {
          pendingResponses.set(String(message.id), { reject, resolve });

          try {
            Promise.resolve(transport.onmessage(message)).catch((error) => {
              pendingResponses.delete(String(message.id));
              reject(error);
            });
          } catch (error) {
            pendingResponses.delete(String(message.id));
            reject(error);
          }
        });
      },
    };

    return transport;
  };
  const isValidMcpRequest = (message) =>
    message &&
    typeof message === "object" &&
    message.jsonrpc === "2.0" &&
    (typeof message.id === "string" || typeof message.id === "number") &&
    typeof message.method === "string";
  const createPlaywrightMcpContext = async () => {
    if (closing) {
      throw new Error("Camoufox launcher is closing.");
    }

    return await browser.newContext(defaultContextOptions());
  };
  const ensurePlaywrightMcpBridge = async () => {
    if (playwrightMcpBridge) {
      return playwrightMcpBridge;
    }

    if (playwrightMcpBridgePromise) {
      return await playwrightMcpBridgePromise;
    }

    playwrightMcpBridgePromise = (async () => {
      const { createConnection } = await import(playwrightMcpModuleSpecifier);
      const transport = createPlaywrightMcpTransport();
      const connection = await createConnection(
        {
          browser: {
            browserName: "firefox",
            contextOptions: defaultContextOptions(),
            launchOptions: {
              headless: true,
            },
          },
        },
        createPlaywrightMcpContext,
      );

      connection.server.onerror = (error) => {
        logLauncher("Playwright MCP bridge error.", {
          error: error?.stack || error?.message || String(error),
        });
      };

      await connection.server.connect(transport);
      await transport.request({
        jsonrpc: "2.0",
        id: "truss-playwright-mcp-init",
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "Truss Playwright MCP Adapter",
            version: "0.1.0",
          },
        },
      });
      transport.notify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      });

      playwrightMcpBridge = { connection, transport };
      return playwrightMcpBridge;
    })();

    try {
      return await playwrightMcpBridgePromise;
    } catch (error) {
      playwrightMcpBridgePromise = null;
      throw error;
    }

  };
  const handlePlaywrightMcpRequest = async (request) => {
    const mcpRequest = request.mcpRequest;

    if (!isValidMcpRequest(mcpRequest)) {
      throw new Error("playwrightMcpRequest requires a JSON-RPC request with string or numeric id.");
    }

    const bridge = await ensurePlaywrightMcpBridge();

    activePlaywrightMcpRequests.set(request.id, mcpRequest.id);

    try {
      return await bridge.transport.request(mcpRequest);
    } finally {
      activePlaywrightMcpRequests.delete(request.id);
    }
  };
  const handleRequest = async (request) => {
    if (!request || typeof request !== "object" || typeof request.id !== "number") {
      throw new Error("Invalid Camoufox child request.");
    }

    if (request.method === "close") {
      writeMessage({ id: request.id, ok: true, result: null });
      await shutdown();
      return;
    }

    if (request.method === "cancel") {
      writeMessage({ id: request.id, ok: true, result: { cancelled: cancelRequest(request) } });
      return;
    }

    if (request.method === "fetchPage") {
      const result = await runCancellableRequest(
        request,
        async (state) =>
          await withPage(
            request,
            {
              height: request.height,
              width: request.width,
            },
            state,
            async (page, state) => {
              const navigation = await raceRequest(state, navigatePage(page, request.url));

              if (navigation.timedOut) {
                const content = await raceRequest(state, page.content()).catch(() => "");
                assertContentWithinLimit(request.url, content);

                return {
                  content,
                  contentType: "text/html",
                  headers: {},
                  note: "Navigation timed out after " + navigation.timeoutMs +
                    "ms while loading " + request.url +
                    ". Returning the page content that had already loaded; some assets, scripts, or network requests may not have finished.",
                  status: 200,
                  statusText: "OK (partial - navigation timed out)",
                };
              }

              const response = navigation.response;
              const headers = response.headers();
              assertContentLengthWithinLimit(request.url, headers);
              const contentType = String(headers["content-type"] || "").trim();
              const content = await raceRequest(
                state,
                shouldReadRenderedDom(contentType) ? page.content() : response.text(),
              );
              assertContentWithinLimit(request.url, content);

              return {
                content,
                contentType,
                headers,
                status: response.status(),
                statusText: response.statusText(),
              };
            },
          ),
      );

      writeMessage({ id: request.id, ok: true, result });
      return;
    }

    if (request.method === "screenshotPage") {
      const result = await runCancellableRequest(
        request,
        async (state) =>
          await withPage(
            request,
            {
              height: request.height,
              width: request.width,
            },
            state,
            async (page, state) => {
              const navigation = await raceRequest(state, navigatePage(page, request.url));
              const title = normalizeTitle(
                await raceRequest(state, page.title().catch(() => "")),
              );
              const screenshotOptions = {
                animations: "disabled",
                caret: "hide",
                fullPage: false,
                timeout: resolvedPageLoadTimeoutMs(),
                type: request.format,
              };

              if (request.format === "jpeg") {
                screenshotOptions.quality = request.quality;
              }

              const data = await raceRequest(state, page.screenshot(screenshotOptions));

              return {
                contentType: request.format === "jpeg" ? "image/jpeg" : "image/png",
                dataBase64: Buffer.from(data).toString("base64"),
                height: request.height,
                note: navigation.timedOut
                  ? "Navigation timed out after " + navigation.timeoutMs +
                    "ms while loading " + request.url +
                    ". The screenshot reflects whatever had rendered so far; some assets may not have finished loading."
                  : undefined,
                status: navigation.timedOut ? 200 : navigation.response.status(),
                statusText: navigation.timedOut
                  ? "OK (partial - navigation timed out)"
                  : navigation.response.statusText(),
                title,
                width: request.width,
              };
            },
          ),
      );

      writeMessage({ id: request.id, ok: true, result });
      return;
    }

    if (request.method === "playwrightMcpRequest") {
      const result = await handlePlaywrightMcpRequest(request);

      writeMessage({ id: request.id, ok: true, result });
      return;
    }

    throw new Error("Unknown Camoufox child method: " + request.method);
  };
  const lines = createInterface({
    crlfDelay: Infinity,
    input: process.stdin,
  });

  writeMessage({ event: "ready" });
  lines.on("line", (line) => {
    if (!line.trim()) {
      return;
    }

    void (async () => {
      let request;

      try {
        request = JSON.parse(line);
        await handleRequest(request);
      } catch (error) {
        writeMessage({
          id: request && typeof request.id === "number" ? request.id : null,
          ok: false,
          error: error?.stack || error?.message || String(error),
        });
      }
    })();
  });
  lines.once("close", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
`;

type CamoufoxLog = NonNullable<CamoufoxBrowserOptions["log"]>;
type CamoufoxLauncherChild = ChildProcessByStdio<Writable, Readable, Readable>;

export async function launchCamoufoxBrowser({
  env = process.env,
  log = defaultLog,
  startTimeoutMs = defaultStartTimeoutMs,
  trussHomeDir,
}: CamoufoxBrowserOptions = {}): Promise<CamoufoxBrowser> {
  const executablePath = await resolveCamoufoxExecutable({
    env,
    log,
    trussHomeDir,
  });
  const addonPaths = await resolveCamoufoxAddonPaths({
    env,
    log,
    trussHomeDir,
  });
  const headless = true;
  const requestTimeoutMs = resolveCamoufoxRequestTimeoutMs(env);

  log("browser", "Starting bundled Camoufox browser.", {
    addons: addonPaths.length,
    executablePath,
    headless,
  });

  const launcher = await startCamoufoxLauncherServer({
    addonPaths,
    executablePath,
    env,
    headless,
    requestTimeoutMs,
    log,
    startTimeoutMs,
  });

  log("browser", "Bundled Camoufox browser is ready.");

  return new ConnectedCamoufoxBrowser({
    launcher,
    log,
    requestTimeoutMs: requestTimeoutMs + childRequestTimeoutPaddingMs,
    trussHomeDir,
  });
}

class ConnectedCamoufoxBrowser implements CamoufoxBrowser {
  readonly #launcher: CamoufoxLauncherServer;
  readonly #log: CamoufoxLog;
  readonly #pendingRequests = new Map<
    number,
    {
      abortListener?: () => void;
      method: string;
      reject(error: Error): void;
      resolve(value: unknown): void;
      signal?: AbortSignal;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  readonly #requestTimeoutMs: number;
  readonly #trussHomeDir?: string;
  #closed = false;
  #nextRequestId = 1;
  #stdoutBuffer = "";

  constructor({
    launcher,
    log,
    requestTimeoutMs,
    trussHomeDir,
  }: {
    launcher: CamoufoxLauncherServer;
    log: CamoufoxLog;
    requestTimeoutMs: number;
    trussHomeDir?: string;
  }) {
    this.#launcher = launcher;
    this.#log = log;
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#trussHomeDir = trussHomeDir;
    this.#launcher.child.stdout.on("data", this.#onStdout);
    this.#launcher.child.stderr.on("data", this.#onStderr);
    this.#launcher.child.once("exit", this.#onExit);
    this.#launcher.child.once("error", this.#onError);
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }

    this.#closed = true;

    try {
      await this.#callChild("close", {}, { timeoutMs: launcherShutdownTimeoutMs });
    } catch (caught) {
      this.#log("browser", "Failed to close Camoufox browser through launcher.", {
        error: errorForLog(caught),
      });
    } finally {
      this.#detachChildListeners();
      await terminateCamoufoxLauncher(this.#launcher);
    }
  }

  async callPlaywrightMcp(
    request: CamoufoxPlaywrightMcpRequest,
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<CamoufoxPlaywrightMcpResponse> {
    this.#log("browser", "Playwright MCP bridge request.", {
      method: request.method,
      requestId: request.id,
      toolName: playwrightMcpToolName(request),
    });

    const response = await this.#callChild<CamoufoxPlaywrightMcpResponse>(
      "playwrightMcpRequest",
      {
        mcpRequest: request,
      },
      {
        signal,
        timeoutMs: defaultPlaywrightMcpRequestTimeoutMs,
      },
    );

    this.#logPlaywrightMcpRequest(request, response);
    return response;
  }

  async fetchPage(
    url: URL,
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<CamoufoxPageFetchResult> {
    this.#log("browser", "Camoufox page load requested.", {
      height: 1080,
      method: "fetchPage",
      url: url.href,
      width: 1024,
    });

    const response = await this.#callChild<CamoufoxPageFetchResult>(
      "fetchPage",
      {
        height: 1080,
        url: url.href,
        width: 1024,
      },
      { signal },
    );

    this.#logHtml({
      content: response.content,
      contentType: response.contentType,
      isScreenshot: false,
      status: response.status,
      statusText: response.statusText,
      url,
    });

    return response;
  }

  async screenshotPage(
    url: URL,
    options: {
      format: "jpeg" | "png";
      height: number;
      quality: number;
      signal?: AbortSignal;
      width: number;
    },
  ): Promise<CamoufoxScreenshotResult> {
    this.#log("browser", "Camoufox page load requested.", {
      format: options.format,
      height: options.height,
      method: "screenshotPage",
      url: url.href,
      width: options.width,
    });

    const response = await this.#callChild<
      Omit<CamoufoxScreenshotResult, "data"> & {
        dataBase64: string;
      }
    >(
      "screenshotPage",
      {
        format: options.format,
        height: options.height,
        quality: options.quality,
        url: url.href,
        width: options.width,
      },
      { signal: options.signal },
    );
    const data = Buffer.from(response.dataBase64, "base64");

    this.#logHtml({
      content: `[${options.format.toUpperCase()} screenshot: ${data.byteLength} bytes]`,
      contentType: response.contentType,
      isScreenshot: true,
      status: response.status,
      statusText: response.statusText,
      url,
    });

    return {
      contentType: response.contentType,
      data,
      height: response.height,
      note: response.note,
      status: response.status,
      statusText: response.statusText,
      title: response.title,
      width: response.width,
    };
  }

  #logHtml({
    content,
    contentType,
    isScreenshot,
    status,
    statusText,
    url,
  }: {
    content: string;
    contentType: string;
    isScreenshot: boolean;
    status: number;
    statusText: string;
    url: URL;
  }): void {
    if (!this.#trussHomeDir) {
      return;
    }

    void logHtmlRequest(this.#trussHomeDir, {
      timestamp: new Date().toISOString(),
      url: url.href,
      method: "GET",
      status,
      statusText,
      headers: contentType ? { "content-type": contentType } : undefined,
      isStealth: true,
      responseExcerpt: truncateForLog(content, isScreenshot ? 500 : 1000),
    });
  }

  #logPlaywrightMcpRequest(
    request: CamoufoxPlaywrightMcpRequest,
    response: CamoufoxPlaywrightMcpResponse,
  ): void {
    if (!this.#trussHomeDir || request.method !== "tools/call") {
      return;
    }

    const url = playwrightMcpRequestUrl(request, response);

    if (!url) {
      return;
    }

    void logHtmlRequest(this.#trussHomeDir, {
      timestamp: new Date().toISOString(),
      url: url.href,
      method: `PLAYWRIGHT_MCP:${playwrightMcpToolName(request) ?? "tools/call"}`,
      isStealth: true,
      responseExcerpt: truncateForLog(JSON.stringify(response.result ?? response.error ?? null), 1000),
    });
  }

  #callChild<T>(
    method: string,
    params: Record<string, unknown>,
    {
      signal,
      timeoutMs = this.#requestTimeoutMs,
    }: {
      signal?: AbortSignal;
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    if (this.#closed && method !== "close") {
      return Promise.reject(new Error("Camoufox browser is closed."));
    }

    if (signal?.aborted) {
      return Promise.reject(new Error(`Camoufox ${method} request was cancelled.`));
    }

    const id = this.#nextRequestId++;
    const payload = `${JSON.stringify({
      id,
      method,
      ...params,
    })}\n`;

    return new Promise<T>((resolvePromise, rejectPromise) => {
      const cleanup = () => {
        const pending = this.#pendingRequests.get(id);

        if (!pending) {
          return;
        }

        this.#clearPendingRequest(pending);
        this.#pendingRequests.delete(id);
      };
      const rejectAndCancel = (message: string, reason: string) => {
        cleanup();
        this.#sendChildCancel(id, reason);
        rejectPromise(new Error(message));
      };
      const timer = setTimeout(() => {
        rejectAndCancel(
          `Camoufox ${method} request timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
          "request_timeout",
        );
      }, timeoutMs);
      const abortListener = signal
        ? () => {
            rejectAndCancel(`Camoufox ${method} request was cancelled.`, "request_cancelled");
          }
        : undefined;

      if (signal && abortListener) {
        signal.addEventListener("abort", abortListener, { once: true });
      }

      this.#pendingRequests.set(id, {
        abortListener,
        method,
        reject: rejectPromise,
        resolve: (value) => resolvePromise(value as T),
        signal,
        timer,
      });

      try {
        if (!this.#launcher.child.stdin.write(payload)) {
          this.#launcher.child.stdin.once("drain", () => undefined);
        }
      } catch (caught) {
        cleanup();
        rejectPromise(caught instanceof Error ? caught : new Error(String(caught)));
      }
    });
  }

  #onStdout = (chunk: Buffer): void => {
    this.#stdoutBuffer += stripAnsi(chunk.toString("utf8"));
    const lines = this.#stdoutBuffer.split(/\r?\n/u);
    this.#stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      this.#handleChildLine(line);
    }
  };

  #onStderr = (chunk: Buffer): void => {
    for (const line of stripAnsi(chunk.toString("utf8")).split(/\r?\n/u)) {
      const trimmed = line.trim();

      if (trimmed) {
        this.#log("browser", `Camoufox launcher: ${truncateForLog(trimmed, 500)}`);
      }
    }
  };

  #onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    this.#rejectPending(
      new Error(
        `Camoufox launcher exited with code ${code ?? "unknown"} and signal ${signal ?? "none"}.`,
      ),
    );
  };

  #onError = (error: Error): void => {
    this.#rejectPending(error);
  };

  #handleChildLine(line: string): void {
    const trimmed = line.trim();

    if (!trimmed) {
      return;
    }

    let message: {
      error?: unknown;
      id?: unknown;
      ok?: unknown;
      result?: unknown;
    };

    try {
      message = JSON.parse(trimmed) as typeof message;
    } catch {
      this.#log("browser", `Camoufox launcher: ${truncateForLog(trimmed, 500)}`);
      return;
    }

    if (typeof message.id !== "number") {
      return;
    }

    const pending = this.#pendingRequests.get(message.id);

    if (!pending) {
      return;
    }

    this.#clearPendingRequest(pending);
    this.#pendingRequests.delete(message.id);

    if (message.ok) {
      pending.resolve(message.result);
      return;
    }

    pending.reject(new Error(typeof message.error === "string" ? message.error : "Unknown Camoufox launcher error."));
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pendingRequests.values()) {
      this.#clearPendingRequest(pending);
      pending.reject(error);
    }

    this.#pendingRequests.clear();
  }

  #clearPendingRequest(pending: {
    abortListener?: () => void;
    signal?: AbortSignal;
    timer: ReturnType<typeof setTimeout>;
  }): void {
    clearTimeout(pending.timer);

    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
  }

  #sendChildCancel(requestId: number, reason: string): void {
    if (this.#closed) {
      return;
    }

    const id = this.#nextRequestId++;
    const payload = `${JSON.stringify({
      id,
      method: "cancel",
      reason,
      requestId,
    })}\n`;

    try {
      this.#launcher.child.stdin.write(payload);
    } catch {
      // The original request is already rejected; child shutdown will clean up.
    }
  }

  #detachChildListeners(): void {
    this.#launcher.child.stdout.off("data", this.#onStdout);
    this.#launcher.child.stderr.off("data", this.#onStderr);
    this.#launcher.child.off("exit", this.#onExit);
    this.#launcher.child.off("error", this.#onError);
  }
}

function playwrightMcpToolName(request: CamoufoxPlaywrightMcpRequest): string | null {
  if (request.method !== "tools/call" || !request.params || typeof request.params !== "object") {
    return null;
  }

  const name = (request.params as Record<string, unknown>).name;

  return typeof name === "string" && name.trim() ? name.trim() : null;
}

function playwrightMcpRequestUrl(
  request: CamoufoxPlaywrightMcpRequest,
  response: CamoufoxPlaywrightMcpResponse,
): URL | null {
  const params = request.params && typeof request.params === "object"
    ? (request.params as Record<string, unknown>)
    : {};
  const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
    ? (params.arguments as Record<string, unknown>)
    : {};
  const directUrl = typeof args.url === "string" ? parseHttpUrl(args.url) : null;

  if (directUrl) {
    return directUrl;
  }

  const resultText = playwrightMcpResponseText(response);
  const match = /- Page URL:\s*(https?:\/\/\S+)/u.exec(resultText);

  return match?.[1] ? parseHttpUrl(match[1]) : null;
}

function playwrightMcpResponseText(response: CamoufoxPlaywrightMcpResponse): string {
  const result = response.result;

  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return "";
  }

  const content = (result as Record<string, unknown>).content;

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return "";
      }

      const text = (item as Record<string, unknown>).text;

      return typeof text === "string" ? text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export async function resolveCamoufoxExecutable({
  env,
  log,
  trussHomeDir,
}: {
  env: NodeJS.ProcessEnv;
  log: CamoufoxLog;
  trussHomeDir?: string;
}): Promise<string> {
  const configuredExecutable = env.TRUSS_CAMOUFOX_EXECUTABLE?.trim();

  if (configuredExecutable) {
    if (!existsSync(configuredExecutable)) {
      throw new Error(`TRUSS_CAMOUFOX_EXECUTABLE does not exist: ${configuredExecutable}`);
    }

    return configuredExecutable;
  }

  const releaseTag = env.TRUSS_CAMOUFOX_RELEASE_TAG?.trim() || defaultCamoufoxReleaseTag;

  const candidateDirs: string[] = [];

  if (env.TRUSS_CAMOUFOX_INSTALL_DIR?.trim()) {
    candidateDirs.push(resolve(env.TRUSS_CAMOUFOX_INSTALL_DIR.trim()));
  }

  if (isStandaloneRuntime()) {
    candidateDirs.push(join(dirname(process.execPath), "camoufox"));
  }

  candidateDirs.push(join(trussHomeDir || join(homedir(), ".truss"), "camoufox"));

  for (const installDir of candidateDirs) {
    const executablePath = camoufoxExecutablePath(installDir);

    if (existsSync(executablePath) && installInfoSupported(installDir, releaseTag)) {
      if (ensureCamoufoxUblockOriginPolicy(installDir)) {
        log("browser", "Configured bundled uBlock Origin filter lists.", {
          lists: defaultUblockOriginFilterLists.length,
        });
      }

      return executablePath;
    }
  }

  const installDir = candidateDirs[candidateDirs.length - 1];
  await installCamoufox({
    installDir,
    log,
    releaseTag,
  });

  const executablePath = camoufoxExecutablePath(installDir);

  if (!existsSync(executablePath)) {
    throw new Error(`Camoufox install completed but executable was not found at ${executablePath}.`);
  }

  if (ensureCamoufoxUblockOriginPolicy(installDir)) {
    log("browser", "Configured bundled uBlock Origin filter lists.", {
      lists: defaultUblockOriginFilterLists.length,
    });
  }

  return executablePath;
}

export function ensureCamoufoxUblockOriginPolicy(installDir: string): boolean {
  const distributionDir = join(installDir, "distribution");
  const policiesPath = join(distributionDir, "policies.json");
  const existingPolicy = readCamoufoxPolicies(policiesPath);
  const nextPolicy = mergeCamoufoxUblockOriginPolicy(existingPolicy);

  if (JSON.stringify(existingPolicy) === JSON.stringify(nextPolicy)) {
    return false;
  }

  mkdirSync(distributionDir, { recursive: true });
  writeFileSync(policiesPath, `${JSON.stringify(nextPolicy, null, 2)}\n`);
  return true;
}

export function mergeCamoufoxUblockOriginPolicy(
  policyFile: Record<string, unknown>,
): Record<string, unknown> {
  const policies = {
    ...(recordValue(policyFile.policies) ?? {}),
  };
  const thirdParty = {
    ...(recordValue(policies["3rdparty"]) ?? {}),
  };
  const extensions = {
    ...(recordValue(thirdParty.Extensions) ?? {}),
  };
  const existingUblockPolicy = {
    ...(recordValue(extensions[ublockOriginExtensionId]) ?? {}),
  };
  const existingAdminSettings = parseUblockAdminSettings(existingUblockPolicy.adminSettings);
  const existingToOverwrite = {
    ...(recordValue(existingUblockPolicy.toOverwrite) ?? {}),
  };
  const filterLists = [...defaultUblockOriginFilterLists];

  extensions[ublockOriginExtensionId] = {
    ...existingUblockPolicy,
    adminSettings: JSON.stringify({
      ...existingAdminSettings,
      selectedFilterLists: filterLists,
    }),
    toOverwrite: {
      ...existingToOverwrite,
      filterLists,
    },
  };
  thirdParty.Extensions = extensions;
  policies["3rdparty"] = thirdParty;

  return {
    ...policyFile,
    policies,
  };
}

function readCamoufoxPolicies(policiesPath: string): Record<string, unknown> {
  if (!existsSync(policiesPath)) {
    return {};
  }

  const parsed = JSON.parse(readFileSync(policiesPath, "utf8")) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Camoufox policies file must contain a JSON object: ${policiesPath}`);
  }

  return { ...(parsed as Record<string, unknown>) };
}

function parseUblockAdminSettings(value: unknown): Record<string, unknown> {
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;

      return recordValue(parsed) ?? {};
    } catch {
      return {};
    }
  }

  return recordValue(value) ?? {};
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function resolveCamoufoxAddonPaths({
  env,
  log,
  trussHomeDir,
}: {
  env: NodeJS.ProcessEnv;
  log: CamoufoxLog;
  trussHomeDir?: string;
}): Promise<string[]> {
  const addonUrls = camoufoxAddonUrls(env);
  const addonPaths = parsePathList(env.TRUSS_CAMOUFOX_ADDON_PATHS).map((path) => resolve(path));
  const addonsDir = resolve(join(trussHomeDir || join(homedir(), ".truss"), "camoufox-addons"));

  for (const addonUrl of addonUrls) {
    addonPaths.push(
      await installCamoufoxAddon({
        addonsDir,
        log,
        url: addonUrl,
      }),
    );
  }

  return uniqueStrings(
    addonPaths.map((addonPath) => {
      assertCamoufoxAddonPath(addonPath);
      return addonPath;
    }),
  );
}

async function startCamoufoxLauncherServer({
  addonPaths,
  executablePath,
  env,
  headless,
  requestTimeoutMs,
  log,
  startTimeoutMs,
}: {
  addonPaths: string[];
  executablePath: string;
  env: NodeJS.ProcessEnv;
  headless: boolean;
  requestTimeoutMs: number;
  log: CamoufoxLog;
  startTimeoutMs: number;
}): Promise<CamoufoxLauncherServer> {
  const commands = camoufoxNodeCommands(env);
  const failures: string[] = [];

  for (const command of commands) {
    const childEnv = camoufoxLauncherEnv({
      addonPaths,
      env,
      executablePath,
      headless,
      requestTimeoutMs,
      startTimeoutMs,
    });
    const child = spawn(command.command, command.args, {
      cwd: process.cwd(),
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    log("browser", `Starting Camoufox launcher with ${command.command}.`);

    try {
      await waitForCamoufoxLauncherReady(child, startTimeoutMs, log);

      log("browser", "Camoufox launcher is ready.");

      return {
        child,
      };
    } catch (caught) {
      failures.push(`${command.command}: ${messageFromUnknown(caught)}`);
      await terminateCamoufoxLauncher({
        child,
      });

      if (env.TRUSS_CAMOUFOX_NODE?.trim()) {
        break;
      }
    }
  }

  throw new Error(
    [
      "Could not start the bundled Camoufox launcher. Truss uses a bundled JavaScript launcher hosted by Node because Bun cannot host Camoufox's Firefox Juggler pipe reliably on Windows.",
      "Set TRUSS_CAMOUFOX_NODE to the Node executable if node is not on PATH.",
      ...failures.map((failure) => `- ${failure}`),
    ].join("\n"),
  );
}

function camoufoxNodeCommands(env: NodeJS.ProcessEnv): CamoufoxNodeCommand[] {
  const configured = env.TRUSS_CAMOUFOX_NODE?.trim();
  const bundledNodePath = isStandaloneRuntime()
    ? join(dirname(process.execPath), "node.exe")
    : null;

  const candidateBundledLauncherPaths = [];
  if (isStandaloneRuntime()) {
    candidateBundledLauncherPaths.push(join(dirname(process.execPath), "camoufox-launcher.mjs"));
  }

  let bundledLauncherPath: string | undefined;
  for (const candidate of candidateBundledLauncherPaths) {
    if (existsSync(candidate)) {
      bundledLauncherPath = candidate;
      break;
    }
  }

  const args = bundledLauncherPath
    ? [bundledLauncherPath]
    : ["--input-type=module", "-e", camoufoxLauncherChildScript];

  if (configured) {
    return [
      {
        args,
        command: configured,
      },
    ];
  }

  return [
    {
      args,
      command: bundledNodePath && existsSync(bundledNodePath) ? bundledNodePath : "node",
    },
  ];
}

function resolveCamoufoxRequestTimeoutMs(env: NodeJS.ProcessEnv): number {
  return positiveIntegerEnv(env.TRUSS_CAMOUFOX_REQUEST_TIMEOUT_MS) ?? defaultChildRequestTimeoutMs;
}

function resolveCamoufoxMaxResponseBytes(env: NodeJS.ProcessEnv): number {
  return positiveIntegerEnv(env.TRUSS_CAMOUFOX_MAX_RESPONSE_BYTES) ?? defaultMaxResponseBytes;
}

function positiveIntegerEnv(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number.parseInt(value.trim(), 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function envFlagIsFalse(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "false";
}

export function mergeCamoufoxAddonConfigEnv(
  env: Record<string, string>,
  addonPaths: string[],
): Record<string, string> {
  const config = readCamoufoxConfigEnv(env);
  const existingAddons = config.addons;

  if (existingAddons !== undefined && !Array.isArray(existingAddons)) {
    throw new Error("CAMOU_CONFIG addons must be an array when configured.");
  }

  if (addonPaths.length > 0) {
    config.addons = uniqueStrings([
      ...(Array.isArray(existingAddons)
        ? existingAddons.filter((item): item is string => typeof item === "string")
        : []),
      ...addonPaths,
    ]);
  }

  writeCamoufoxConfigEnv(env, config);
  return env;
}

function camoufoxLauncherEnv({
  addonPaths,
  env,
  executablePath,
  headless,
  requestTimeoutMs,
  startTimeoutMs,
}: {
  addonPaths: string[];
  env: NodeJS.ProcessEnv;
  executablePath: string;
  headless: boolean;
  requestTimeoutMs: number;
  startTimeoutMs: number;
}): Record<string, string> {
  const childEnv = processEnvForPlaywright({
    ...process.env,
    ...env,
  });

  mergeCamoufoxAddonConfigEnv(childEnv, addonPaths);

  childEnv.TRUSS_CAMOUFOX_CHILD_EXECUTABLE = executablePath;
  childEnv.TRUSS_CAMOUFOX_CHILD_HEADLESS = headless ? "true" : "false";
  childEnv.TRUSS_CAMOUFOX_CHILD_TIMEOUT_MS = String(startTimeoutMs);
  childEnv.TRUSS_CAMOUFOX_MAX_RESPONSE_BYTES = String(resolveCamoufoxMaxResponseBytes(env));
  childEnv.TRUSS_CAMOUFOX_NETWORK_IDLE_TIMEOUT_MS = String(networkIdleTimeoutMs);
  childEnv.TRUSS_CAMOUFOX_PAGE_TIMEOUT_MS = String(pageNavigationTimeoutMs);
  childEnv.TRUSS_CAMOUFOX_REQUEST_TIMEOUT_MS = String(requestTimeoutMs);
  childEnv.TRUSS_PLAYWRIGHT_MCP_MODULE = playwrightMcpImportSpecifier();
  childEnv.TRUSS_PLAYWRIGHT_CORE_MODULE = playwrightCoreImportSpecifier();

  return childEnv;
}

function readCamoufoxConfigEnv(env: Record<string, string>): Record<string, unknown> {
  const chunks = camoufoxConfigChunks(env);

  if (chunks.length === 0) {
    return {};
  }

  const rawConfig = chunks.map((chunk) => chunk.value).join("");

  if (!rawConfig.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawConfig) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("CAMOU_CONFIG must be a JSON object.");
    }

    return { ...(parsed as Record<string, unknown>) };
  } catch (caught) {
    throw new Error(`CAMOU_CONFIG contains invalid JSON: ${messageFromUnknown(caught)}`);
  }
}

function writeCamoufoxConfigEnv(env: Record<string, string>, config: Record<string, unknown>): void {
  for (const key of Object.keys(env)) {
    if (/^CAMOU_CONFIG_\d+$/u.test(key)) {
      delete env[key];
    }
  }

  const serialized = JSON.stringify(config);
  const chunkSize = platform === "win32" ? 2047 : 32767;
  let chunkIndex = 1;

  for (let offset = 0; offset < serialized.length; offset += chunkSize) {
    env[`CAMOU_CONFIG_${chunkIndex}`] = serialized.slice(offset, offset + chunkSize);
    chunkIndex += 1;
  }
}

function camoufoxConfigChunks(env: Record<string, string>): Array<{
  index: number;
  value: string;
}> {
  return Object.entries(env)
    .map(([key, value]) => {
      const match = /^CAMOU_CONFIG_(\d+)$/u.exec(key);

      return match
        ? {
            index: Number.parseInt(match[1] ?? "", 10),
            value,
          }
        : null;
    })
    .filter((item): item is { index: number; value: string } => Boolean(item))
    .sort((left, right) => left.index - right.index);
}

function playwrightCoreImportSpecifier(): string {
  return moduleImportSpecifier("playwright-core");
}

function playwrightMcpImportSpecifier(): string {
  return moduleImportSpecifier("@playwright/mcp");
}

function moduleImportSpecifier(packageName: string): string {
  const tryResolve = (name: string): string | null => {
    try {
      if (typeof (import.meta as any).resolve === "function") {
        const resolved = (import.meta as any).resolve(name);

        if (resolved) {
          return resolved;
        }
      }
    } catch {
      // ignore
    }

    try {
      return createRequire(import.meta.url).resolve(name);
    } catch {
      // ignore
    }

    return null;
  };

  const resolved = tryResolve(packageName);

  if (resolved) {
    if (
      resolved.startsWith("file:") ||
      resolved.startsWith("data:") ||
      resolved.startsWith("node:")
    ) {
      return resolved;
    }

    if (isAbsolute(resolved)) {
      try {
        return pathToFileURL(resolved).href;
      } catch {
        // ignore
      }
    }

    return resolved;
  }

  return packageName;
}

function waitForCamoufoxLauncherReady(
  child: CamoufoxLauncherChild,
  timeoutMs: number,
  log: CamoufoxLog,
): Promise<void> {
  return new Promise((resolveReady, rejectReady) => {
    let bufferedOutput = "";
    let settled = false;
    const timer = setTimeout(() => {
      finish(
        new Error(
          `Timed out after ${Math.round(timeoutMs / 1000)} seconds while waiting for the Camoufox launcher to become ready.`,
        ),
      );
    }, timeoutMs);

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("error", onError);
      child.off("exit", onExit);

      if (!error) {
        resolveReady();
        return;
      }

      rejectReady(error);
    };

    const onStdout = (chunk: Buffer) => {
      const text = stripAnsi(chunk.toString("utf8"));
      bufferedOutput = truncateForLog(`${bufferedOutput}${text}`, 6_000);

      for (const line of text.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean)) {
        if (isReadyLauncherLine(line)) {
          finish();
          return;
        }

        log("browser", `Camoufox launcher: ${truncateForLog(line, 500)}`);
      }
    };

    const onStderr = (chunk: Buffer) => {
      const text = stripAnsi(chunk.toString("utf8"));
      bufferedOutput = truncateForLog(`${bufferedOutput}${text}`, 6_000);

      for (const line of text.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean)) {
        log("browser", `Camoufox launcher: ${truncateForLog(line, 500)}`);
      }
    };

    const onError = (caught: Error) => {
      finish(caught);
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      const suffix = bufferedOutput.trim()
        ? ` Output: ${truncateForLog(bufferedOutput, 1_500)}`
        : "";

      finish(
        new Error(
          `Camoufox launcher exited before startup completed with code ${code ?? "unknown"} and signal ${signal ?? "none"}.${suffix}`,
        ),
      );
    };

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function isReadyLauncherLine(line: string): boolean {
  try {
    const value = JSON.parse(line) as {
      event?: unknown;
    };

    return value.event === "ready";
  } catch {
    return false;
  }
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/gu, "");
}

async function installCamoufoxAddon({
  addonsDir,
  log,
  url,
}: {
  addonsDir: string;
  log: CamoufoxLog;
  url: string;
}): Promise<string> {
  const installDir = camoufoxAddonInstallDir(addonsDir, url);

  if (addonInstallInfoSupported(installDir, url)) {
    assertCamoufoxAddonPath(installDir);
    return installDir;
  }

  const tempDir = await mkdtemp(join(tmpdir(), "truss-camoufox-addon-"));

  log("browser", "Installing Camoufox addon.", {
    installDir,
    url,
  });

  try {
    const xpiPath = join(tempDir, "addon.xpi");
    await downloadToFile(xpiPath, {
      log,
      progressMessage: "Downloading Camoufox addon.",
      resourceName: "Camoufox addon",
      url,
    });

    if (existsSync(installDir)) {
      rmSync(installDir, { force: true, recursive: true });
    }

    mkdirSync(installDir, { recursive: true });
    new AdmZip(xpiPath).extractAllTo(installDir, true);
    assertCamoufoxAddonPath(installDir);
    writeAddonInstallInfo(installDir, {
      downloadedAt: new Date().toISOString(),
      name: addonNameFromUrl(url),
      url,
    });

    log("browser", "Camoufox addon installed.", {
      installDir,
      url,
    });
  } catch (caught) {
    if (existsSync(installDir)) {
      rmSync(installDir, { force: true, recursive: true });
    }

    throw caught;
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }

  return installDir;
}

function camoufoxAddonUrls(env: NodeJS.ProcessEnv): string[] {
  const urls = envFlagIsFalse(env.TRUSS_CAMOUFOX_DEFAULT_ADDONS)
    ? []
    : [...defaultCamoufoxAddonUrls];

  urls.push(...parseStringList(env.TRUSS_CAMOUFOX_ADDON_URLS));
  return uniqueStrings(urls.map(normalizeCamoufoxAddonUrl));
}

function normalizeCamoufoxAddonUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`TRUSS_CAMOUFOX_ADDON_URLS contains an invalid URL: ${value}`);
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Camoufox addon URLs must use http or https: ${value}`);
  }

  return url.href;
}

function camoufoxAddonInstallDir(addonsDir: string, url: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 12);
  const name = addonNameFromUrl(url);

  return join(addonsDir, `${name}-${hash}`);
}

function addonNameFromUrl(url: string): string {
  const rawName = basename(new URL(url).pathname).replace(/\.(xpi|zip)$/iu, "");
  const safeName = rawName.replace(/[^a-z0-9._-]+/giu, "-").replace(/^-+|-+$/gu, "");

  return safeName || "addon";
}

function assertCamoufoxAddonPath(addonPath: string): void {
  if (!existsSync(addonPath) || !statSync(addonPath).isDirectory()) {
    throw new Error(`Camoufox addon path is not a directory: ${addonPath}`);
  }

  if (!existsSync(join(addonPath, "manifest.json"))) {
    throw new Error(`Camoufox addon path is missing manifest.json: ${addonPath}`);
  }
}

function addonInstallInfoSupported(installDir: string, url: string): boolean {
  try {
    const value = JSON.parse(
      readFileSync(join(installDir, addonInstallInfoFileName), "utf8"),
    ) as Partial<CamoufoxAddonInstallInfo>;

    return value.url === url;
  } catch {
    return false;
  }
}

function writeAddonInstallInfo(installDir: string, info: CamoufoxAddonInstallInfo): void {
  writeFileSync(join(installDir, addonInstallInfoFileName), `${JSON.stringify(info, null, 2)}\n`);
}

function parseStringList(value: unknown): string[] {
  return typeof value === "string"
    ? value
        .split(/[,\r\n]+/u)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function parsePathList(value: unknown): string[] {
  return typeof value === "string"
    ? value
        .split(delimiter)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    unique.push(value);
  }

  return unique;
}

export async function installCamoufox({
  installDir,
  log,
  releaseTag,
}: {
  installDir: string;
  log: CamoufoxLog;
  releaseTag: string;
}): Promise<void> {
  const asset = await findCamoufoxReleaseAsset(releaseTag);
  const tempDir = await mkdtemp(join(tmpdir(), "truss-camoufox-"));

  log("browser", "Installing bundled Camoufox browser.", {
    asset: asset.name,
    installDir,
    releaseTag,
  });

  try {
    const zipPath = join(tempDir, asset.name);
    await downloadToFile(zipPath, {
      log,
      progressMessage: "Downloading bundled Camoufox browser.",
      resourceName: "Camoufox",
      url: asset.url,
    });

    if (existsSync(installDir)) {
      rmSync(installDir, { force: true, recursive: true });
    }

    mkdirSync(installDir, { recursive: true });
    new AdmZip(zipPath).extractAllTo(installDir, true);
    writeInstallInfo(installDir, {
      assetName: asset.name,
      downloadedAt: new Date().toISOString(),
      releaseTag,
      url: asset.url,
    });

    log("browser", "Bundled Camoufox browser installed.", {
      installDir,
    });
  } catch (caught) {
    if (existsSync(installDir)) {
      rmSync(installDir, { force: true, recursive: true });
    }

    throw caught;
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

async function findCamoufoxReleaseAsset(releaseTag: string): Promise<{
  name: string;
  url: string;
}> {
  const apiUrl = `${camoufoxRepoApi}/releases/tags/${encodeURIComponent(releaseTag)}`;
  const response = await fetch(apiUrl, {
    headers: githubHeaders(apiUrl),
  });

  if (!response.ok) {
    throw new Error(
      `Could not fetch Camoufox release ${releaseTag}: HTTP ${response.status} ${response.statusText || "Unknown status"}.`,
    );
  }

  const release = (await response.json()) as CamoufoxRelease;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const platformKey = camoufoxPlatformKey();
  const archKey = camoufoxArchKey();
  const asset = assets
    .map((item): CamoufoxReleaseAsset => (item && typeof item === "object" ? item : {}))
    .find(
      (item) =>
        typeof item.name === "string" &&
        typeof item.browser_download_url === "string" &&
        item.name.endsWith(`-${platformKey}.${archKey}.zip`),
    );

  if (!asset || typeof asset.name !== "string" || typeof asset.browser_download_url !== "string") {
    throw new Error(
      `Camoufox release ${releaseTag} does not include an asset for ${platformKey}.${archKey}.`,
    );
  }

  return {
    name: asset.name,
    url: asset.browser_download_url,
  };
}

async function downloadToFile(
  outputPath: string,
  {
    log,
    progressMessage,
    resourceName,
    url,
  }: {
    log: CamoufoxLog;
    progressMessage: string;
    resourceName: string;
    url: string;
  },
): Promise<void> {
  const response = await fetch(url, {
    headers: githubHeaders(url),
  });

  if (!response.ok || !response.body) {
    throw new Error(
      `Could not download ${resourceName} from ${url}: HTTP ${response.status} ${response.statusText || "Unknown status"}.`,
    );
  }

  const total = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  let downloaded = 0;
  let lastLogged = 0;
  const output = createWriteStream(outputPath);

  try {
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      downloaded += buffer.byteLength;

      if (!output.write(buffer)) {
        await new Promise<void>((resolveWrite) => output.once("drain", resolveWrite));
      }

      if (total > 0 && downloaded - lastLogged >= 25 * 1024 * 1024) {
        lastLogged = downloaded;
        log("browser", progressMessage, {
          downloaded: formatBytes(downloaded),
          total: formatBytes(total),
        });
      }
    }
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      output.end((error?: Error | null) => {
        if (error) {
          rejectClose(error);
          return;
        }

        resolveClose();
      });
    });
  }
}

function installInfoSupported(installDir: string, releaseTag: string): boolean {
  try {
    const value = JSON.parse(
      readFileSync(join(installDir, installInfoFileName), "utf8"),
    ) as Partial<CamoufoxInstallInfo>;

    return value.releaseTag === releaseTag;
  } catch {
    return false;
  }
}

function writeInstallInfo(installDir: string, info: CamoufoxInstallInfo): void {
  writeFileSync(join(installDir, installInfoFileName), `${JSON.stringify(info, null, 2)}\n`);
}

function camoufoxExecutablePath(installDir: string): string {
  switch (camoufoxPlatformKey()) {
    case "win":
      return join(installDir, "camoufox.exe");
    case "mac":
      return join(installDir, "Camoufox.app", "Contents", "MacOS", "camoufox");
    case "lin":
      return join(installDir, "camoufox-bin");
  }
}

function camoufoxPlatformKey(): "lin" | "mac" | "win" {
  switch (platform) {
    case "darwin":
      return "mac";
    case "linux":
      return "lin";
    case "win32":
      return "win";
    default:
      throw new Error(`Camoufox is not available for ${platform}.`);
  }
}

function camoufoxArchKey(): "arm64" | "i686" | "x86_64" {
  switch (processArch) {
    case "arm":
    case "arm64":
      return "arm64";
    case "ia32":
      return "i686";
    case "x64":
      return "x86_64";
    default:
      throw new Error(`Camoufox is not available for ${processArch}.`);
  }
}

function githubHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "Truss Camoufox downloader",
  };
  const token = process.env.GITHUB_TOKEN?.trim();

  if (token && ["api.github.com", "github.com"].includes(new URL(url).hostname)) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function processEnvForPlaywright(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

async function terminateCamoufoxLauncher(launcher: CamoufoxLauncherServer): Promise<void> {
  const child = launcher.child;

  if (child.exitCode !== null || child.killed) {
    return;
  }

  child.stdin.end();

  if (await waitForChildExit(child, launcherShutdownTimeoutMs)) {
    return;
  }

  if (process.platform === "win32" && child.pid) {
    await new Promise<void>((resolveKill) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });

      killer.once("exit", () => resolveKill());
      killer.once("error", () => resolveKill());
    });
    return;
  }

  child.kill("SIGTERM");
  await waitForChildExit(child, launcherShutdownTimeoutMs);
}

function waitForChildExit(child: CamoufoxLauncherChild, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.killed) {
    return Promise.resolve(true);
  }

  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolveExit(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolveExit(true);
    };

    child.once("exit", onExit);
  });
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KiB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function defaultLog(channel: string, message: string, metadata?: Record<string, unknown>): void {
  const details = metadata ? ` ${JSON.stringify(metadata)}` : "";

  console.error(`[${channel}] ${message}${details}`);
}
