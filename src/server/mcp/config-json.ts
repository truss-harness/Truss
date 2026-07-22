import type { McpAuthDefinition, McpServerDefinition, McpTransport } from "./types.ts";

export interface ValidatedMcpConfig {
  value: Record<string, unknown>;
  servers: McpServerDefinition[];
}

interface RawMcpServer {
  args?: unknown;
  auth?: unknown;
  bearer_token_env_var?: unknown;
  command?: unknown;
  cwd?: unknown;
  disabled?: unknown;
  disabledReason?: unknown;
  enabled?: unknown;
  env?: unknown;
  env_http_headers?: unknown;
  headers?: unknown;
  http_headers?: unknown;
  name?: unknown;
  transport?: unknown;
  type?: unknown;
  _trussDisabledReason?: unknown;
  _trussManaged?: unknown;
  url?: unknown;
}

const explicitTransports = new Set([
  "stdio",
  "http-sse",
  "streamable-http",
  "local",
  "http",
  "sse",
]);
const authTypes = new Set(["api-key", "oauth2-client-credentials", "oauth2-authorization-code"]);

export async function readMcpJsonFile(
  configPath: string,
  source: string,
): Promise<McpServerDefinition[]> {
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return [];
  }

  const parsed = await parseJsonFile(file);

  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  return normalizeMcpJson(parsed as Record<string, unknown>, configPath, source);
}

export async function readCodexConfigFile(
  configPath: string,
  source: string,
): Promise<McpServerDefinition[]> {
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return [];
  }

  const parsed = await parseTomlFile(file);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }

  const mcpServers = (parsed as Record<string, unknown>).mcp_servers;

  if (!mcpServers || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    return [];
  }

  return normalizeMcpJson({ mcpServers }, configPath, source);
}

export async function existingFiles(paths: string[]): Promise<string[]> {
  const checks = await Promise.all(
    paths.map(async (path) => ((await Bun.file(path).exists()) ? path : null)),
  );

  return checks.filter((path): path is string => Boolean(path));
}

export function validateMcpConfigText(
  text: string,
  configPath: string,
  source: string,
): { ok: true; config: ValidatedMcpConfig } | { ok: false; error: string } {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text) as unknown;
  } catch (caught) {
    return {
      ok: false,
      error: `mcp.json is not valid JSON: ${caught instanceof Error ? caught.message : String(caught)}`,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "mcp.json must contain a JSON object." };
  }

  const value = parsed as Record<string, unknown>;
  const schemaError = validateMcpConfigObject(value);

  if (schemaError) {
    return { ok: false, error: schemaError };
  }

  return {
    ok: true,
    config: {
      value,
      servers: normalizeMcpJson(value, configPath, source),
    },
  };
}

function normalizeMcpJson(
  parsed: Record<string, unknown>,
  configPath: string,
  source: string,
): McpServerDefinition[] {
  const rawServers = parsed.mcpServers ?? parsed.servers;

  if (Array.isArray(rawServers)) {
    return rawServers.flatMap((server, index) =>
      normalizeRawServer(String(index), server, configPath, source),
    );
  }

  if (rawServers && typeof rawServers === "object") {
    return Object.entries(rawServers).flatMap(([name, server]) =>
      normalizeRawServer(name, server, configPath, source),
    );
  }

  return [];
}

function validateMcpConfigObject(config: Record<string, unknown>): string | null {
  if (Object.hasOwn(config, "mcpServers")) {
    const error = validateMcpServerCollection(config.mcpServers, "mcpServers");

    if (error) {
      return error;
    }
  }

  if (Object.hasOwn(config, "servers")) {
    const error = validateMcpServerCollection(config.servers, "servers");

    if (error) {
      return error;
    }
  }

  return null;
}

function validateMcpServerCollection(value: unknown, path: string): string | null {
  if (Array.isArray(value)) {
    for (const [index, server] of value.entries()) {
      const error = validateRawMcpServer(server, `${path}[${index}]`);

      if (error) {
        return error;
      }
    }

    return null;
  }

  if (!value || typeof value !== "object") {
    return `${path} must be an object or array.`;
  }

  for (const [name, server] of Object.entries(value)) {
    const error = validateRawMcpServer(server, `${path}.${name}`);

    if (error) {
      return error;
    }
  }

  return null;
}

function validateRawMcpServer(value: unknown, path: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return `${path} must be an object.`;
  }

  const raw = value as RawMcpServer;
  const disabled = raw.disabled === true || raw.enabled === false;
  const stringFields: Array<keyof RawMcpServer> = [
    "bearer_token_env_var",
    "command",
    "cwd",
    "disabledReason",
    "name",
    "transport",
    "type",
    "_trussDisabledReason",
    "url",
  ];

  for (const field of stringFields) {
    if (raw[field] !== undefined && typeof raw[field] !== "string") {
      return `${path}.${String(field)} must be a string.`;
    }
  }

  for (const field of ["disabled", "enabled", "_trussManaged"] as const) {
    if (raw[field] !== undefined && typeof raw[field] !== "boolean") {
      return `${path}.${field} must be a boolean.`;
    }
  }

  if (raw.args !== undefined && !isStringArray(raw.args)) {
    return `${path}.args must be an array of strings.`;
  }

  for (const field of ["env", "env_http_headers", "headers", "http_headers"] as const) {
    if (raw[field] !== undefined && !isStringRecord(raw[field])) {
      return `${path}.${field} must be an object with string values.`;
    }
  }

  const explicitTransport = typeof raw.transport === "string" ? raw.transport : raw.type;

  if (typeof explicitTransport === "string" && !explicitTransports.has(explicitTransport)) {
    return `${path}.transport must be stdio, http-sse, streamable-http, local, http, or sse.`;
  }

  const authError = validateRawMcpAuth(raw.auth, `${path}.auth`);

  if (authError) {
    return authError;
  }

  const command = typeof raw.command === "string" && raw.command.trim() ? raw.command : undefined;
  const url = typeof raw.url === "string" && raw.url.trim() ? raw.url : undefined;
  const transport = inferTransport(raw, command, url);

  if (!disabled && transport === "stdio" && !command) {
    return `${path}.command is required for stdio MCP servers.`;
  }

  if (!disabled && (transport === "http-sse" || transport === "streamable-http")) {
    if (!url) {
      return `${path}.url is required for HTTP MCP servers.`;
    }

    if (!isHttpUrl(url)) {
      return `${path}.url must be an HTTP or HTTPS URL.`;
    }
  }

  if (!disabled && transport === "unknown") {
    return `${path} must include command for stdio or url for a remote MCP server.`;
  }

  return null;
}

function validateRawMcpAuth(value: unknown, path: string): string | null {
  if (value === undefined) {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return `${path} must be an object.`;
  }

  const auth = value as Record<string, unknown>;
  const type = auth.type;

  if (typeof type !== "string" || !authTypes.has(type)) {
    return `${path}.type must be api-key, oauth2-client-credentials, or oauth2-authorization-code.`;
  }

  for (const [field, fieldValue] of Object.entries(auth)) {
    if (fieldValue !== undefined && typeof fieldValue !== "string") {
      return `${path}.${field} must be a string.`;
    }
  }

  if (type === "api-key" && !stringValue(auth.envVar)) {
    return `${path}.envVar is required for api-key auth.`;
  }

  if (type === "oauth2-client-credentials") {
    for (const field of ["clientIdEnv", "clientSecretEnv", "tokenUrl"]) {
      if (!stringValue(auth[field])) {
        return `${path}.${field} is required for oauth2-client-credentials auth.`;
      }
    }
  }

  if (
    type === "oauth2-authorization-code" &&
    !stringValue(auth.accessTokenEnv) &&
    !stringValue(auth.refreshTokenEnv)
  ) {
    return `${path}.accessTokenEnv or ${path}.refreshTokenEnv is required for oauth2-authorization-code auth.`;
  }

  return null;
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((item) => typeof item === "string");
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeRawServer(
  name: string,
  server: unknown,
  configPath: string,
  source: string,
): McpServerDefinition[] {
  if (!server || typeof server !== "object") {
    return [];
  }

  const raw = server as RawMcpServer;

  const command = typeof raw.command === "string" ? raw.command : undefined;
  const cwd = typeof raw.cwd === "string" ? raw.cwd : undefined;
  const disabled = raw.disabled === true || raw.enabled === false;
  const displayName = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : name;
  const url = typeof raw.url === "string" ? raw.url : undefined;

  return [
    {
      id: `${source}:${name}`,
      name: displayName,
      source,
      trussManaged: raw._trussManaged === true,
      transport: inferTransport(raw, command, url),
      configPath,
      auth: normalizeAuth(raw),
      command,
      cwd,
      disabled,
      disabledReason: disabled
        ? stringValue(raw.disabledReason) ?? stringValue(raw._trussDisabledReason)
        : undefined,
      env: normalizeEnv(raw.env),
      envHeaders: normalizeEnv(raw.env_http_headers),
      headers: normalizeEnv(raw.headers) ?? normalizeEnv(raw.http_headers),
      args: Array.isArray(raw.args)
        ? raw.args.filter((arg): arg is string => typeof arg === "string")
        : undefined,
      url,
    },
  ];
}

function normalizeAuth(rawServer: RawMcpServer): McpAuthDefinition | undefined {
  const bearerTokenEnvVar = stringValue(rawServer.bearer_token_env_var);

  if (bearerTokenEnvVar) {
    return {
      type: "api-key",
      envVar: bearerTokenEnvVar,
      headerName: "Authorization",
      prefix: "Bearer",
    };
  }

  const value = rawServer.auth;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const type = stringValue(raw.type);

  if (type === "api-key") {
    const envVar = stringValue(raw.envVar);

    return envVar
      ? {
          type,
          envVar,
          headerName: stringValue(raw.headerName),
          prefix: stringValue(raw.prefix),
        }
      : undefined;
  }

  if (type === "oauth2-client-credentials") {
    const clientIdEnv = stringValue(raw.clientIdEnv);
    const clientSecretEnv = stringValue(raw.clientSecretEnv);
    const tokenUrl = stringValue(raw.tokenUrl);

    return clientIdEnv && clientSecretEnv && tokenUrl
      ? {
          type,
          clientIdEnv,
          clientSecretEnv,
          tokenUrl,
          scope: stringValue(raw.scope),
        }
      : undefined;
  }

  if (type === "oauth2-authorization-code") {
    const accessTokenEnv = stringValue(raw.accessTokenEnv);
    const refreshTokenEnv = stringValue(raw.refreshTokenEnv);

    return accessTokenEnv || refreshTokenEnv
      ? {
          type,
          accessTokenEnv,
          clientIdEnv: stringValue(raw.clientIdEnv),
          clientSecretEnv: stringValue(raw.clientSecretEnv),
          refreshTokenEnv,
          scope: stringValue(raw.scope),
          tokenUrl: stringValue(raw.tokenUrl),
        }
      : undefined;
  }

  return undefined;
}

function inferTransport(raw: RawMcpServer, command?: string, url?: string): McpTransport {
  const explicit = typeof raw.transport === "string" ? raw.transport : raw.type;

  if (explicit === "stdio" || explicit === "http-sse" || explicit === "streamable-http") {
    return explicit;
  }

  if (explicit === "local") {
    return "stdio";
  }

  if (explicit === "http") {
    return "streamable-http";
  }

  if (explicit === "sse") {
    return "http-sse";
  }

  if (command) {
    return "stdio";
  }

  if (url) {
    return "streamable-http";
  }

  return "unknown";
}

function normalizeEnv(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const env: Record<string, string> = {};

  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      env[key] = item;
    }
  }

  return Object.keys(env).length > 0 ? env : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function parseJsonFile(file: Bun.BunFile): Promise<unknown> {
  try {
    return await file.json();
  } catch {
    return null;
  }
}

async function parseTomlFile(file: Bun.BunFile): Promise<unknown> {
  try {
    return Bun.TOML.parse(await file.text());
  } catch {
    return null;
  }
}
