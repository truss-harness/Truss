import { createHash } from "node:crypto";
import { join } from "node:path";
import type { TrussHome } from "../setup/truss-home.ts";
import type { McpLoaderResult, McpServerDefinition } from "./types.ts";

interface StdioApprovalFile {
  approvals: string[];
  version: 1;
}

export interface McpStdioApprovalSummary {
  args: string[];
  command: string;
  configPath: string;
  cwd: string | null;
  id: string;
  name: string;
  source: string;
}

const approvalFileName = "mcp-stdio-approvals.json";

export async function annotateMcpStdioApprovals(
  loaderResult: McpLoaderResult,
  trussHome: TrussHome,
): Promise<McpLoaderResult> {
  const approvals = await readMcpStdioApprovalSet(trussHome);

  return {
    ...loaderResult,
    servers: loaderResult.servers.map((server) => annotateMcpStdioApproval(server, approvals)),
  };
}

export async function approveMcpStdioServers(
  trussHome: TrussHome,
  servers: McpServerDefinition[],
): Promise<McpStdioApprovalSummary[]> {
  const approvals = await readMcpStdioApprovalSet(trussHome);
  const approvedServers = servers.filter(mcpStdioApprovalRequired);

  for (const server of approvedServers) {
    approvals.add(mcpStdioApprovalKey(server));
  }

  await writeMcpStdioApprovalSet(trussHome, approvals);
  return approvedServers.map(mcpStdioApprovalSummary);
}

export async function unapprovedMcpStdioServers(
  trussHome: TrussHome,
  servers: McpServerDefinition[],
): Promise<McpStdioApprovalSummary[]> {
  const approvals = await readMcpStdioApprovalSet(trussHome);

  return servers
    .filter((server) => mcpStdioApprovalRequired(server) && !approvals.has(mcpStdioApprovalKey(server)))
    .map(mcpStdioApprovalSummary);
}

export function mcpStdioApprovalRequired(server: McpServerDefinition): boolean {
  return server.transport === "stdio" && !server.disabled && !server.trussManaged;
}

export function mcpStdioApprovalKey(server: McpServerDefinition): string {
  return createHash("sha256")
    .update(
      canonicalStringify({
        args: server.args ?? [],
        command: server.command ?? "",
        cwd: server.cwd ?? null,
        env: sortRecord(server.env ?? {}),
      }),
    )
    .digest("hex");
}

function annotateMcpStdioApproval(
  server: McpServerDefinition,
  approvals: Set<string>,
): McpServerDefinition {
  if (!mcpStdioApprovalRequired(server)) {
    return server;
  }

  const approvalKey = mcpStdioApprovalKey(server);

  return {
    ...server,
    stdioCommandApprovalKey: approvalKey,
    stdioCommandApproved: approvals.has(approvalKey),
  };
}

function mcpStdioApprovalSummary(server: McpServerDefinition): McpStdioApprovalSummary {
  return {
    args: server.args ?? [],
    command: server.command ?? "",
    configPath: server.configPath,
    cwd: server.cwd ?? null,
    id: server.id,
    name: server.name,
    source: server.source,
  };
}

async function readMcpStdioApprovalSet(trussHome: TrussHome): Promise<Set<string>> {
  const file = Bun.file(mcpStdioApprovalPath(trussHome));

  if (!(await file.exists())) {
    return new Set();
  }

  try {
    const parsed = (await file.json()) as Partial<StdioApprovalFile>;
    const approvals = Array.isArray(parsed.approvals)
      ? parsed.approvals.filter((item): item is string => typeof item === "string")
      : [];

    return new Set(approvals);
  } catch {
    return new Set();
  }
}

async function writeMcpStdioApprovalSet(
  trussHome: TrussHome,
  approvals: Set<string>,
): Promise<void> {
  const value: StdioApprovalFile = {
    approvals: [...approvals].sort(),
    version: 1,
  };

  await Bun.write(mcpStdioApprovalPath(trussHome), `${JSON.stringify(value, null, 2)}\n`);
}

function mcpStdioApprovalPath(trussHome: TrussHome): string {
  return join(trussHome.dir, approvalFileName);
}

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }

  if (!value || typeof value !== "object") {
    return JSON.stringify(value);
  }

  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalStringify(item)}`)
    .join(",")}}`;
}

function sortRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}
