import { Buffer } from "node:buffer";

export const browserBrokerUrlEnv = "TRUSS_BROWSER_BROKER_URL";
export const browserBrokerTokenEnv = "TRUSS_BROWSER_BROKER_TOKEN";
export const browserBrokerWaitTimeoutMs = 15_000;
export const browserBrokerHealthPath = "/v1/health";
export const browserBrokerFetchPagePath = "/v1/fetch-page";
export const browserBrokerScreenshotPath = "/v1/screenshot";
export const browserBrokerPlaywrightMcpPath = "/v1/playwright-mcp";
export const browserBrokerScreenshotMetadataHeader = "x-truss-browser-metadata";

export interface BrowserBrokerCredentials {
  token: string;
  url: string;
}

export interface BrowserBrokerScreenshotMetadata {
  contentType: "image/jpeg" | "image/png";
  height: number;
  note?: string;
  status: number;
  statusText: string;
  title: string | null;
  width: number;
}

export function browserBrokerCredentialEnv(
  credentials: BrowserBrokerCredentials,
): Record<string, string> {
  return {
    [browserBrokerUrlEnv]: credentials.url,
    [browserBrokerTokenEnv]: credentials.token,
  };
}

export function browserBrokerCredentialsFromEnv(
  env: NodeJS.ProcessEnv,
): BrowserBrokerCredentials | null {
  const token = env[browserBrokerTokenEnv]?.trim();
  const rawUrl = env[browserBrokerUrlEnv]?.trim();

  if (!token || !rawUrl) {
    return null;
  }

  const url = new URL(rawUrl);

  if (url.protocol !== "http:" || !isLoopbackHostname(url.hostname)) {
    throw new Error("Truss browser broker credentials must target an HTTP loopback address.");
  }

  return {
    token,
    url: url.href.replace(/\/+$/u, ""),
  };
}

export function clearBrowserBrokerCredentialsFromEnv(env: NodeJS.ProcessEnv): void {
  delete env[browserBrokerUrlEnv];
  delete env[browserBrokerTokenEnv];
}

export function encodeBrowserBrokerScreenshotMetadata(
  metadata: BrowserBrokerScreenshotMetadata,
): string {
  return Buffer.from(JSON.stringify(metadata), "utf8").toString("base64url");
}

export function decodeBrowserBrokerScreenshotMetadata(
  value: string | null,
): BrowserBrokerScreenshotMetadata {
  if (!value) {
    throw new Error("Truss browser service returned a screenshot without metadata.");
  }

  const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;

  if (!isBrowserBrokerScreenshotMetadata(parsed)) {
    throw new Error("Truss browser service returned invalid screenshot metadata.");
  }

  return parsed;
}

function isBrowserBrokerScreenshotMetadata(
  value: unknown,
): value is BrowserBrokerScreenshotMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const metadata = value as Record<string, unknown>;

  return (
    (metadata.contentType === "image/jpeg" || metadata.contentType === "image/png") &&
    typeof metadata.height === "number" &&
    typeof metadata.status === "number" &&
    typeof metadata.statusText === "string" &&
    (metadata.title === null || typeof metadata.title === "string") &&
    typeof metadata.width === "number" &&
    (metadata.note === undefined || typeof metadata.note === "string")
  );
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");

  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}
