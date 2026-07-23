import { createInterface } from "node:readline";
import { firefox } from "playwright-core";

async function main() {
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
    viewport: { height: 1080, width: 1024 },
  });

  const context = await browser.newContext(defaultContextOptions());
  const activeTabs = new Set<any>();
  const activePlaywrightMcpRequests = new Map<number, any>();
  const requestStates = new Map<number, any>();
  const tabCleanupTasks = new Set<any>();
  let playwrightMcpBridge: any = null;
  let playwrightMcpBridgePromise: Promise<any> | null = null;
  let nextTabId = 1;
  let tabSetupQueue: Promise<any> = Promise.resolve();
  let closing = false;

  const logLauncher = (message: string, details?: any) => {
    let suffix = "";
    try { suffix = details ? " " + JSON.stringify(details) : ""; } catch { suffix = ""; }
    console.error(message + suffix);
  };

  const writeMessage = (message: any) => {
    process.stdout.write(JSON.stringify(message) + "\n");
  };

  const normalizeViewport = (viewport: any) => {
    const height = Number.parseInt(String(viewport?.height ?? ""), 10);
    const width = Number.parseInt(String(viewport?.width ?? ""), 10);
    return {
      height: Number.isFinite(height) && height > 0 ? height : 1080,
      width: Number.isFinite(width) && width > 0 ? width : 1024,
    };
  };

  const resolvedTabCleanupTimeoutMs = () =>
    Number.isFinite(tabCleanupTimeoutMs) ? Math.max(0, tabCleanupTimeoutMs) : 2000;

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

  const formatBytes = (value: number) => {
    if (value < 1024) return value + " B";
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KiB";
    return (value / (1024 * 1024)).toFixed(1) + " MiB";
  };

  const headerValue = (headers: any, name: string) => {
    const lowerName = name.toLowerCase();
    for (const [key, value] of Object.entries(headers || {})) {
      if (String(key).toLowerCase() === lowerName) return String(value || "");
    }
    return "";
  };

  const assertContentLengthWithinLimit = (url: string, headers: any) => {
    const contentLength = Number.parseInt(headerValue(headers, "content-length"), 10);
    const maxBytes = resolvedMaxResponseBytes();
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error("Webpage " + url + " is too large to load: content-length " +
        formatBytes(contentLength) + " exceeds the " + formatBytes(maxBytes) + " limit.");
    }
  };

  const assertContentWithinLimit = (url: string, content: string) => {
    const byteLength = Buffer.byteLength(String(content || ""), "utf8");
    const maxBytes = resolvedMaxResponseBytes();
    if (byteLength > maxBytes) {
      throw new Error("Webpage " + url + " is too large to load: downloaded " +
        formatBytes(byteLength) + " exceeds the " + formatBytes(maxBytes) + " limit.");
    }
  };

  const shouldReadRenderedDom = (contentType: string) => {
    const mediaType = String(contentType || "").split(";", 1)[0].trim().toLowerCase();
    return !mediaType || mediaType === "text/html" || mediaType === "application/xhtml+xml";
  };

  const normalizeTitle = (value: any) => {
    const title = String(value || "").replace(/\s+/g, " ").trim();
    return title || null;
  };

  const closePageWithTimeout = async (tab: any) => {
    const startedAt = Date.now();
    const closePromise = Promise.resolve().then(() => tab.page.close());
    let timer: any = null;
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ status: "timed_out" }), resolvedTabCleanupTimeoutMs());
    });
    const result: any = await Promise.race([
      closePromise.then(() => ({ status: "closed" }), (error) => ({ error, status: "failed" })),
      timeoutPromise,
    ]);
    if (timer) clearTimeout(timer);
    if (result.status === "timed_out") closePromise.catch(() => undefined);
    return { ...result, durationMs: Date.now() - startedAt };
  };

  const closeTab = async (tab: any, reason: string) => {
    if (tab.closed) return;
    tab.closed = true;
    activeTabs.delete(tab);
    await closePageWithTimeout(tab);
  };

  const scheduleCloseTab = (tab: any, reason: string) => {
    let task: any = null;
    task = closeTab(tab, reason).catch(() => undefined).finally(() => tabCleanupTasks.delete(task));
    tabCleanupTasks.add(task);
  };

  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      if (playwrightMcpBridge) {
        await playwrightMcpBridge.connection.close().catch(() => undefined);
        playwrightMcpBridge = null;
      }
      playwrightMcpBridgePromise = null;
      await Promise.allSettled(Array.from(activeTabs, (tab: any) => closeTab(tab, "launcher_shutdown")));
      if (tabCleanupTasks.size > 0) await Promise.allSettled(Array.from(tabCleanupTasks));
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    } finally {
      process.exit(0);
    }
  };

  const navigatePage = async (page: any, url: string) => {
    const startedAt = Date.now();
    const timeoutMs = resolvedPageLoadTimeoutMs();
    let response: any = null;
    let timedOut = false;
    try {
      response = await page.goto(url, { timeout: timeoutMs, waitUntil: "domcontentloaded" });
    } catch (error: any) {
      const message = String(error && error.message ? error.message : error);
      if (!/Timeout \d+ms exceeded/i.test(message)) throw error;
      timedOut = true;
    }
    if (!response) {
      if (timedOut) return { response: null, timedOut: true, timeoutMs };
      throw new Error("No response received from " + url + ".");
    }
    try {
      const remainingMs = timeoutMs - (Date.now() - startedAt);
      if (remainingMs > 0) {
        await page.waitForLoadState("networkidle", {
          timeout: Math.min(resolvedNetworkIdleTimeoutMs(), remainingMs),
        });
      }
    } catch { /* background requests */ }
    return { response, timedOut: false, timeoutMs };
  };

  const withTabSetupLock = (callback: () => Promise<any>) => {
    const task = tabSetupQueue.catch(() => undefined).then(callback);
    tabSetupQueue = task.then(() => undefined, () => undefined);
    return task;
  };

  const waitForTabOpenBatch = () =>
    new Promise((resolve) =>
      setTimeout(resolve, Number.isFinite(tabOpenBatchWindowMs) ? Math.max(0, tabOpenBatchWindowMs) : 50),
    );

  const openTab = (request: any, viewport: any) => withTabSetupLock(async () => {
    if (closing) throw new Error("Camoufox launcher is closing.");
    const normalizedViewport = normalizeViewport(viewport);
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
    return tab;
  });

  const cancellationMessage = (state: any) =>
    state.cancelMessage || "Camoufox request " + state.id + " was cancelled.";

  const createRequestState = (request: any) => {
    let resolveCancellation: any;
    const state: any = {
      cancelMessage: null,
      cancelReason: null,
      cancelled: false,
      cancellation: new Promise((resolve) => { resolveCancellation = resolve; }),
      id: request.id,
      method: request.method,
      tab: null,
      cancel(reason: string, message?: string) {
        if (this.cancelled) return;
        this.cancelled = true;
        this.cancelReason = reason;
        this.cancelMessage = message || "Camoufox request " + this.id + " was cancelled.";
        resolveCancellation();
        if (this.tab) scheduleCloseTab(this.tab, reason);
      },
      throwIfCancelled() {
        if (this.cancelled) throw new Error(cancellationMessage(this));
      },
    };
    requestStates.set(request.id, state);
    return state;
  };

  const raceRequest = async (state: any, promise: Promise<any>) => {
    state.throwIfCancelled();
    return await Promise.race([
      promise,
      state.cancellation.then(() => { throw new Error(cancellationMessage(state)); }),
    ]);
  };

  const runCancellableRequest = async (request: any, callback: (state: any) => Promise<any>) => {
    const state = createRequestState(request);
    const timeoutMs = resolvedRequestTimeoutMs();
    const timer = setTimeout(() => {
      state.cancel("request_timeout", "Camoufox request " + request.id + " timed out after " + timeoutMs + "ms.");
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

  const cancelRequest = (request: any) => {
    const requestId = Number(request.requestId);
    if (!Number.isFinite(requestId)) throw new Error("Camoufox cancel request requires numeric requestId.");
    const state = requestStates.get(requestId);
    if (state) {
      state.cancel("request_cancelled",
        typeof request.reason === "string" && request.reason.trim()
          ? "Camoufox request " + requestId + " was cancelled: " + request.reason.trim()
          : "Camoufox request " + requestId + " was cancelled.",
      );
      return true;
    }
    const mcpRequestId = activePlaywrightMcpRequests.get(requestId);
    if (mcpRequestId === undefined) return false;
    if (playwrightMcpBridge) {
      playwrightMcpBridge.transport.notify({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: {
          requestId: mcpRequestId,
          reason: typeof request.reason === "string" && request.reason.trim()
            ? request.reason.trim() : "request_cancelled",
        },
      });
    }
    return true;
  };

  const withPage = async (request: any, viewport: any, state: any, callback: (page: any, state: any) => Promise<any>) => {
    if (closing) throw new Error("Camoufox launcher is closing.");
    let tab: any = null;
    let cleanupReason = "request_finished";
    try {
      const tabPromise = openTab(request, viewport);
      tabPromise.then((openedTab: any) => {
        if (state.cancelled) scheduleCloseTab(openedTab, state.cancelReason || "request_cancelled");
      }).catch(() => undefined);
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
        if (state.tab === tab) state.tab = null;
        scheduleCloseTab(tab, cleanupReason);
      }
    }
  };

  const isJsonRpcResponse = (message: any) =>
    message && typeof message === "object" && message.jsonrpc === "2.0" &&
    Object.prototype.hasOwnProperty.call(message, "id") &&
    (Object.prototype.hasOwnProperty.call(message, "result") || Object.prototype.hasOwnProperty.call(message, "error"));

  const isValidMcpRequest = (message: any) =>
    message && typeof message === "object" && message.jsonrpc === "2.0" &&
    (typeof message.id === "string" || typeof message.id === "number") &&
    typeof message.method === "string";

  const createPlaywrightMcpTransport = () => {
    const pendingResponses = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();
    const transport: any = {
      onclose: undefined,
      onerror: undefined,
      onmessage: undefined,
      async close() {
        for (const pending of pendingResponses.values()) {
          pending.reject(new Error("Playwright MCP bridge closed."));
        }
        pendingResponses.clear();
        if (typeof transport.onclose === "function") transport.onclose();
      },
      async send(message: any) {
        if (isJsonRpcResponse(message)) {
          const pending = pendingResponses.get(String(message.id));
          if (pending) {
            pendingResponses.delete(String(message.id));
            pending.resolve(message);
          }
          return;
        }
        if (message && typeof message === "object" && typeof message.method === "string") {
          logLauncher("Playwright MCP bridge notification.", { method: message.method });
        }
      },
      async start() {},
      notify(message: any) {
        if (typeof transport.onmessage !== "function")
          throw new Error("Playwright MCP bridge transport is not connected.");
        transport.onmessage(message);
      },
      request(message: any) {
        if (!isValidMcpRequest(message))
          return Promise.reject(new Error("Invalid Playwright MCP JSON-RPC request."));
        if (typeof transport.onmessage !== "function")
          return Promise.reject(new Error("Playwright MCP bridge transport is not connected."));
        return new Promise((resolve, reject) => {
          pendingResponses.set(String(message.id), { reject, resolve });
          try {
            Promise.resolve(transport.onmessage(message)).catch((error: any) => {
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

  const createPlaywrightMcpContext = async () => {
    if (closing) throw new Error("Camoufox launcher is closing.");
    return await browser.newContext(defaultContextOptions());
  };

  const ensurePlaywrightMcpBridge = async () => {
    if (playwrightMcpBridge) return playwrightMcpBridge;
    if (playwrightMcpBridgePromise) return await playwrightMcpBridgePromise;

    playwrightMcpBridgePromise = (async () => {
      const { createConnection } = await import("@playwright/mcp");
      const transport = createPlaywrightMcpTransport();
      const connection = await createConnection(
        { browser: { browserName: "firefox", contextOptions: defaultContextOptions(), launchOptions: { headless: true } } },
        createPlaywrightMcpContext,
      );
      connection.server.onerror = (error: any) => {
        logLauncher("Playwright MCP bridge error.", { error: error?.stack || error?.message || String(error) });
      };
      await connection.server.connect(transport);
      await transport.request({
        jsonrpc: "2.0",
        id: "truss-playwright-mcp-init",
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "Truss Playwright MCP Adapter", version: "0.1.0" } },
      });
      transport.notify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
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

  const handlePlaywrightMcpRequest = async (request: any) => {
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

  const handleRequest = async (request: any) => {
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
      const result = await runCancellableRequest(request, async (state) =>
        await withPage(request, { height: request.height, width: request.width }, state, async (page, state) => {
          const navigation = await raceRequest(state, navigatePage(page, request.url));
          if (navigation.timedOut) {
            const content = await raceRequest(state, page.content()).catch(() => "");
            assertContentWithinLimit(request.url, content);
            return {
              content,
              contentType: "text/html",
              headers: {},
              note: "Navigation timed out after " + navigation.timeoutMs + "ms while loading " + request.url +
                ". Returning the page content that had already loaded; some assets, scripts, or network requests may not have finished.",
              status: 200,
              statusText: "OK (partial - navigation timed out)",
            };
          }
          const response = navigation.response;
          const headers = response.headers();
          assertContentLengthWithinLimit(request.url, headers);
          const contentType = String(headers["content-type"] || "").trim();
          const content = await raceRequest(state, shouldReadRenderedDom(contentType) ? page.content() : response.text());
          assertContentWithinLimit(request.url, content);
          return { content, contentType, headers, status: response.status(), statusText: response.statusText() };
        }),
      );
      writeMessage({ id: request.id, ok: true, result });
      return;
    }

    if (request.method === "screenshotPage") {
      const result = await runCancellableRequest(request, async (state) =>
        await withPage(request, { height: request.height, width: request.width }, state, async (page, state) => {
          const navigation = await raceRequest(state, navigatePage(page, request.url));
          const title = normalizeTitle(await raceRequest(state, page.title().catch(() => "")));
          const screenshotOptions: any = {
            animations: "disabled",
            caret: "hide",
            fullPage: false,
            timeout: resolvedPageLoadTimeoutMs(),
            type: request.format,
          };
          if (request.format === "jpeg") screenshotOptions.quality = request.quality;
          const data = await raceRequest(state, page.screenshot(screenshotOptions));
          return {
            contentType: request.format === "jpeg" ? "image/jpeg" : "image/png",
            dataBase64: Buffer.from(data).toString("base64"),
            height: request.height,
            note: navigation.timedOut
              ? "Navigation timed out after " + navigation.timeoutMs + "ms while loading " + request.url +
                ". The screenshot reflects whatever had rendered so far; some assets may not have finished loading."
              : undefined,
            status: navigation.timedOut ? 200 : navigation.response.status(),
            statusText: navigation.timedOut ? "OK (partial - navigation timed out)" : navigation.response.statusText(),
            title,
            width: request.width,
          };
        }),
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

  const lines = createInterface({ crlfDelay: Infinity, input: process.stdin });

  writeMessage({ event: "ready" });

  lines.on("line", (line: string) => {
    if (!line.trim()) return;
    void (async () => {
      let request: any;
      try {
        request = JSON.parse(line);
        await handleRequest(request);
      } catch (error: any) {
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

main().catch((error: any) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
