import { randomBytes, timingSafeEqual } from "node:crypto";
import type {
  CamoufoxBrowser,
  CamoufoxPlaywrightMcpRequest,
} from "../utils/camoufox-browser.ts";
import { launchCamoufoxBrowser } from "../utils/camoufox-browser.ts";
import {
  browserBrokerFetchPagePath,
  browserBrokerHealthPath,
  browserBrokerPlaywrightMcpPath,
  browserBrokerScreenshotMetadataHeader,
  browserBrokerScreenshotPath,
  encodeBrowserBrokerScreenshotMetadata,
  type BrowserBrokerCredentials,
} from "./broker-protocol.ts";

const maxBrowserBrokerRequestBytes = 8 * 1024 * 1024;

export interface CamoufoxBrokerHostOptions {
  env?: NodeJS.ProcessEnv;
  launchBrowser?: () => Promise<CamoufoxBrowser>;
  log?(channel: string, message: string, metadata?: Record<string, unknown>): void;
  trussHomeDir: string;
}

export class CamoufoxBrokerHost {
  readonly #launchBrowser: () => Promise<CamoufoxBrowser>;
  #browser: CamoufoxBrowser | null = null;
  #launchPromise: Promise<CamoufoxBrowser> | null = null;
  #operationTail: Promise<void> = Promise.resolve();
  #closed = false;

  constructor(options: CamoufoxBrokerHostOptions) {
    this.#launchBrowser =
      options.launchBrowser ??
      (() =>
        launchCamoufoxBrowser({
          env: options.env,
          log: options.log,
          trussHomeDir: options.trussHomeDir,
        }));
  }

  async callPlaywrightMcp(
    request: CamoufoxPlaywrightMcpRequest,
    signal?: AbortSignal,
  ) {
    return this.#withBrowser((browser) => {
      if (!browser.callPlaywrightMcp) {
        throw new Error("Camoufox Playwright MCP bridge is not available.");
      }

      return browser.callPlaywrightMcp(request, { signal });
    }, signal);
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    const browser = this.#browser ?? (await this.#launchPromise?.catch(() => null));

    this.#browser = null;
    this.#launchPromise = null;
    await browser?.close();
  }

  async fetchPage(url: URL, signal?: AbortSignal) {
    return this.#withBrowser((browser) => browser.fetchPage(url, { signal }), signal);
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
  ) {
    return this.#withBrowser((browser) => browser.screenshotPage(url, options), options.signal);
  }

  async #getBrowser(): Promise<CamoufoxBrowser> {
    if (this.#closed) {
      throw new Error("Truss browser broker is closed.");
    }

    if (this.#browser) {
      return this.#browser;
    }

    this.#launchPromise ??= this.#launchBrowser()
      .then(async (browser) => {
        if (this.#closed) {
          await browser.close();
          throw new Error("Truss browser broker closed while Camoufox was starting.");
        }

        this.#browser = browser;
        return browser;
      })
      .catch((caught) => {
        this.#launchPromise = null;
        throw caught;
      });

    return this.#launchPromise;
  }

  async #withBrowser<T>(
    operation: (browser: CamoufoxBrowser) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const previousOperation = this.#operationTail;
    let releaseOperation!: () => void;
    const operationCompleted = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    this.#operationTail = previousOperation.then(() => operationCompleted);

    try {
      await waitForBrokerTurn(previousOperation, signal);
      const browser = await this.#getBrowser();

      try {
        return await operation(browser);
      } catch (caught) {
        if (browserConnectionFailed(caught) && this.#browser === browser) {
          this.#browser = null;
          this.#launchPromise = null;
          await browser.close().catch(() => undefined);
        }

        throw caught;
      }
    } finally {
      releaseOperation();
    }
  }
}

export class BrowserBrokerServer {
  readonly credentials: BrowserBrokerCredentials;
  readonly #host: CamoufoxBrokerHost;
  readonly #server: Bun.Server<undefined>;
  #closed = false;

  private constructor(
    server: Bun.Server<undefined>,
    host: CamoufoxBrokerHost,
    token: string,
  ) {
    if (server.port === undefined) {
      server.stop(true);
      throw new Error("Truss browser broker did not bind a loopback port.");
    }

    this.#server = server;
    this.#host = host;
    this.credentials = {
      token,
      url: `http://127.0.0.1:${server.port}`,
    };
  }

  static start({
    host,
    token = randomBytes(32).toString("base64url"),
  }: {
    host: CamoufoxBrokerHost;
    token?: string;
  }): BrowserBrokerServer {
    let broker: BrowserBrokerServer | null = null;
    const server = Bun.serve({
      fetch: (request) => {
        if (!broker) {
          return jsonError("Truss browser broker is starting.", 503);
        }

        return broker.handle(request);
      },
      hostname: "127.0.0.1",
      port: 0,
    });

    broker = new BrowserBrokerServer(server, host, token);
    return broker;
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    this.#server.stop(true);
    await this.#host.close();
  }

  async handle(request: Request): Promise<Response> {
    if (!authorized(request, this.credentials.token)) {
      return jsonError("Invalid browser broker capability token.", 401);
    }

    const { pathname } = new URL(request.url);

    if (pathname === browserBrokerHealthPath) {
      return request.method === "GET"
        ? new Response(null, { status: 204 })
        : jsonError("Method not allowed.", 405);
    }

    if (request.method !== "POST") {
      return jsonError("Method not allowed.", 405);
    }

    try {
      const body = await readBrokerJson(request);

      if (pathname === browserBrokerFetchPagePath) {
        const url = browserRequestUrl(body.url);
        const result = await this.#host.fetchPage(url, request.signal);
        return Response.json(result);
      }

      if (pathname === browserBrokerScreenshotPath) {
        const url = browserRequestUrl(body.url);
        const format = body.format === "jpeg" || body.format === "png" ? body.format : null;
        const height = positiveInteger(body.height);
        const quality = positiveInteger(body.quality);
        const width = positiveInteger(body.width);

        if (
          !format ||
          !height ||
          height > 1_920 ||
          !quality ||
          quality > 100 ||
          !width ||
          width > 1_024
        ) {
          throw new BrokerRequestError("Invalid screenshot options.");
        }

        const result = await this.#host.screenshotPage(url, {
          format,
          height,
          quality,
          signal: request.signal,
          width,
        });
        const { data, ...metadata } = result;

        return new Response(
          data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
          {
          headers: {
            "content-type": result.contentType,
            [browserBrokerScreenshotMetadataHeader]:
              encodeBrowserBrokerScreenshotMetadata(metadata),
          },
          },
        );
      }

      if (pathname === browserBrokerPlaywrightMcpPath) {
        if (!isPlaywrightMcpRequest(body.request)) {
          throw new BrokerRequestError("Invalid Playwright MCP request.");
        }

        const result = await this.#host.callPlaywrightMcp(body.request, request.signal);
        return Response.json(result);
      }

      return jsonError("Not found.", 404);
    } catch (caught) {
      return jsonError(
        caught instanceof Error ? caught.message : String(caught),
        caught instanceof BrokerRequestError ? 400 : 500,
      );
    }
  }
}

class BrokerRequestError extends Error {}

async function readBrokerJson(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");

  if (Number.isFinite(contentLength) && contentLength > maxBrowserBrokerRequestBytes) {
    throw new BrokerRequestError("Browser broker request is too large.");
  }

  const text = await request.text();

  if (Buffer.byteLength(text, "utf8") > maxBrowserBrokerRequestBytes) {
    throw new BrokerRequestError("Browser broker request is too large.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new BrokerRequestError("Browser broker request must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BrokerRequestError("Browser broker request must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

function browserRequestUrl(value: unknown): URL {
  if (typeof value !== "string") {
    throw new BrokerRequestError("Browser request URL is required.");
  }

  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BrokerRequestError("Browser request URL must use HTTP or HTTPS.");
  }

  return url;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function isPlaywrightMcpRequest(value: unknown): value is CamoufoxPlaywrightMcpRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const request = value as Record<string, unknown>;

  return (
    request.jsonrpc === "2.0" &&
    (typeof request.id === "string" || typeof request.id === "number") &&
    typeof request.method === "string"
  );
}

function authorized(request: Request, expectedToken: string): boolean {
  const value = request.headers.get("authorization");
  const token = value?.startsWith("Bearer ") ? value.slice("Bearer ".length) : "";
  const actual = Buffer.from(token);
  const expected = Buffer.from(expectedToken);

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function browserConnectionFailed(caught: unknown): boolean {
  const message = caught instanceof Error ? caught.message : String(caught);

  return /browser.+(?:closed|disconnected)|launcher.+(?:closed|exited|failed)|EPIPE/iu.test(message);
}

function waitForBrokerTurn(previousOperation: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return previousOperation;
  }

  if (signal.aborted) {
    return Promise.reject(new Error("Truss browser broker request was cancelled."));
  }

  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      reject(new Error("Truss browser broker request was cancelled."));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    void previousOperation.then(() => {
      signal.removeEventListener("abort", onAbort);

      if (signal.aborted) {
        reject(new Error("Truss browser broker request was cancelled."));
      } else {
        resolve();
      }
    });
  });
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}
