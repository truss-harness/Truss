import type {
  FileAccessDirectorySummary,
  FileAccessDirectoryUpdate,
  FileAccessSecurityResponse,
} from "../../../shared/protocol.ts";

export function fileAccessScopeLabel(scope: FileAccessSecurityResponse["activeScope"]): string {
  return scope.mode === "workspace" ? `Workspace: ${scope.workspacePath ?? scope.label}` : "Global";
}



export function fileAccessDirectoryScopeLabel(directory: FileAccessDirectorySummary): string {
  return directory.scope === "workspace"
    ? `Workspace: ${directory.workspacePath ?? ""}`
    : "Global";
}



export function fileAccessGrantSourceLabel(source: FileAccessDirectorySummary["grantSource"]): string {
  if (source === "cli-arg") {
    return "CLI grant";
  }

  return "User grant";
}



export function fileAccessDirectoryUpdate(
  directory: FileAccessDirectorySummary,
): FileAccessDirectoryUpdate {
  return {
    path: directory.path,
    readOnly: directory.readOnly,
    scope: directory.scope,
  };
}



export function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}



export function shouldRequestExternalStdioApproval(configText: string): boolean {
  try {
    const parsed = JSON.parse(configText) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }

    const config = parsed as Record<string, unknown>;

    return [
      ...rawMcpServers(config.mcpServers),
      ...rawMcpServers(config.servers),
    ].some(isActiveExternalStdioServer);
  } catch {
    return false;
  }
}



function rawMcpServers(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (!isRecord(value)) {
    return [];
  }

  return Object.values(value).filter(isRecord);
}



function isActiveExternalStdioServer(server: Record<string, unknown>): boolean {
  if (server._trussManaged === true || server.disabled === true || server.enabled === false) {
    return false;
  }

  const explicit = typeof server.transport === "string" ? server.transport : server.type;

  return explicit === "stdio" || explicit === "local" || Boolean(server.command);
}



function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}



export function setAllMcpServersDisabled(
  configText: string,
  disabled: boolean,
): string {
  const parsed = JSON.parse(configText) as unknown;

  if (!isRecord(parsed)) {
    return configText;
  }

  const config = { ...parsed };

  for (const key of ["mcpServers", "servers"] as const) {
    const servers = config[key];

    if (!isRecord(servers)) {
      continue;
    }

    const nextServers: Record<string, unknown> = {};

    for (const [serverId, server] of Object.entries(servers)) {
      if (!isRecord(server) || server._trussManaged === true) {
        nextServers[serverId] = server;
        continue;
      }

      nextServers[serverId] = { ...server, disabled };
    }

    config[key] = nextServers;
  }

  return JSON.stringify(config, null, 2);
}


