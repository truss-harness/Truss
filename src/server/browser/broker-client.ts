import { Buffer } from "node:buffer";
import process from "node:process";
import type {
  CamoufoxBrowser,
  CamoufoxPageFetchResult,
  CamoufoxPlaywrightMcpRequest,
  CamoufoxPlaywrightMcpResponse,
  CamoufoxScreenshotResult,
} from "../utils/camoufox-browser.ts";
import {
  browserBrokerCredentialsFromEnv,
  browserBrokerFetchPagePath,
  browserBrokerHealthPath,
  browserBrokerPlaywrightMcpPath,
  browserBrokerScreenshotPath,
  browserBrokerScreenshotMetadataHeader,
  browserBrokerWaitTimeoutMs,
  decodeBrowserBrokerScreenshotMetadata,
  type BrowserBrokerCredentials,
} from "./broker-protocol.ts";

const browserBrokerRetryDelayMs = 250;
type BrowserBrokerFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface BrowserBrokerClientOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: BrowserBrokerFetch;
  now?: () => number;
  platform?: NodeJS.Platform;
  sleep?: (delayMs: number) => Promise<void>;
  timeoutMs?: number;
}

export async function connectCamoufoxBrowserBroker(
  options: BrowserBrokerClientOptions = {},
): Promise<CamoufoxBrowser> {
  const platform = options.platform ?? process.platform;

  if (platform !== "win32") {
    throw new Error(
      "Truss browser tools are supported only on Windows and require the global Truss Windows service.",
    );
  }

  const credentials = await waitForBrowserBroker(options);

  return new BrokerCamoufoxBrowser(
    credentials,
    options.fetch ?? globalThis.fetch,
  );
}

export async function waitForBrowserBroker(
  options: BrowserBrokerClientOptions = {},
): Promise<BrowserBrokerCredentials> {
  const env = options.env ?? process.env;
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? browserBrokerWaitTimeoutMs;
  const deadline = now() + timeoutMs;
  let lastError = "broker credentials were not provided";

  while (true) {
    let credentials: BrowserBrokerCredentials | null = null;

    try {
      credentials = browserBrokerCredentialsFromEnv(env);

      if (credentials) {
        const response = await fetchImplementation(
          brokerUrl(credentials, browserBrokerHealthPath),
          {
            headers: authorizationHeaders(credentials),
            signal: AbortSignal.timeout(Math.max(1, Math.min(1_000, deadline - now()))),
          },
        );

        if (response.ok) {
          return credentials;
        }

        if (response.status === 401 || response.status === 403) {
          throw new Error(
            "Truss browser service rejected its capability token. Restart the global Truss Windows service.",
          );
        }

        lastError = `health check returned HTTP ${response.status}`;
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);

      if (message.includes("rejected its capability token")) {
        throw caught;
      }

      lastError = message;
    }

    const remainingMs = deadline - now();

    if (remainingMs <= 0) {
      throw browserServiceRequiredError(timeoutMs, lastError);
    }

    await sleep(Math.min(browserBrokerRetryDelayMs, remainingMs));
  }
}

class BrokerCamoufoxBrowser implements CamoufoxBrowser {
  constructor(
    readonly credentials: BrowserBrokerCredentials,
    readonly fetchImplementation: BrowserBrokerFetch,
  ) {}

  async callPlaywrightMcp(
    request: CamoufoxPlaywrightMcpRequest,
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<CamoufoxPlaywrightMcpResponse> {
    const response = await this.#request(browserBrokerPlaywrightMcpPath, {
      body: JSON.stringify({ request }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal,
    });

    return response.json() as Promise<CamoufoxPlaywrightMcpResponse>;
  }

  async close(): Promise<void> {
    // The global Windows service, not an MCP client, owns browser lifecycle.
  }

  async fetchPage(
    url: URL,
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<CamoufoxPageFetchResult> {
    const response = await this.#request(browserBrokerFetchPagePath, {
      body: JSON.stringify({ url: url.href }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal,
    });

    return response.json() as Promise<CamoufoxPageFetchResult>;
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
    const response = await this.#request(browserBrokerScreenshotPath, {
      body: JSON.stringify({
        format: options.format,
        height: options.height,
        quality: options.quality,
        url: url.href,
        width: options.width,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: options.signal,
    });
    const metadata = decodeBrowserBrokerScreenshotMetadata(
      response.headers.get(browserBrokerScreenshotMetadataHeader),
    );

    return {
      ...metadata,
      data: Buffer.from(await response.arrayBuffer()),
    };
  }

  async #request(path: string, init: RequestInit): Promise<Response> {
    let response: Response;

    try {
      response = await this.fetchImplementation(brokerUrl(this.credentials, path), {
        ...init,
        headers: {
          ...authorizationHeaders(this.credentials),
          ...init.headers,
        },
      });
    } catch (caught) {
      if (init.signal?.aborted) {
        throw caught;
      }

      throw new Error(
        `The global Truss Windows browser service is unavailable. Start or restart the Truss service. ${errorMessage(caught)}`,
      );
    }

    if (response.ok) {
      return response;
    }

    const detail = await response
      .json()
      .then((value: unknown) =>
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof (value as Record<string, unknown>).error === "string"
          ? String((value as Record<string, unknown>).error)
          : null,
      )
      .catch(() => null);

    throw new Error(
      detail ?? `Truss browser service request failed with HTTP ${response.status}.`,
    );
  }
}

function authorizationHeaders(credentials: BrowserBrokerCredentials): Record<string, string> {
  return {
    authorization: `Bearer ${credentials.token}`,
  };
}

function brokerUrl(credentials: BrowserBrokerCredentials, path: string): string {
  return new URL(path, `${credentials.url}/`).href;
}

function browserServiceRequiredError(timeoutMs: number, detail: string): Error {
  return new Error(
    `The global Truss Windows browser service is required but was not ready after ${Math.ceil(
      timeoutMs / 1_000,
    )} seconds. Install, start, or restart the Truss service; no local browser fallback is allowed. Last error: ${detail}`,
  );
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}
