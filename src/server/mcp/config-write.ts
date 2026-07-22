import { ensureGlobalMcpConfig, type GlobalMcpConfigOptions } from "./global-config.ts";
import { validateMcpConfigText } from "./config-json.ts";
import {
  approveMcpStdioServers,
  unapprovedMcpStdioServers,
  type McpStdioApprovalSummary,
} from "./stdio-approval.ts";
import type { McpServerDefinition } from "./types.ts";

export interface WriteGlobalMcpConfigResult {
  approvedStdioServers: McpStdioApprovalSummary[];
  config: Record<string, unknown>;
  servers: McpServerDefinition[];
}

export async function writeGlobalMcpConfigText({
  approveStdioServers,
  mcpConfigText,
  options,
}: {
  approveStdioServers: boolean;
  mcpConfigText: string;
  options: GlobalMcpConfigOptions;
}): Promise<WriteGlobalMcpConfigResult> {
  const validation = validateMcpConfigText(
    mcpConfigText,
    options.trussHome.mcpConfigPath,
    "truss-global",
  );

  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const unapproved = await unapprovedMcpStdioServers(
    options.trussHome,
    validation.config.servers,
  );

  if (unapproved.length > 0 && !approveStdioServers) {
    throw new Error(
      [
        "Saving this mcp.json would allow local MCP commands to run.",
        "Approve the local command changes in the browser before saving.",
        `Unapproved servers: ${unapproved.map((server) => server.name).join(", ")}`,
      ].join(" "),
    );
  }

  await Bun.write(
    options.trussHome.mcpConfigPath,
    mcpConfigText.endsWith("\n") ? mcpConfigText : `${mcpConfigText}\n`,
  );
  await ensureGlobalMcpConfig(options);

  const approvedStdioServers = approveStdioServers
    ? await approveMcpStdioServers(options.trussHome, validation.config.servers)
    : [];

  return {
    approvedStdioServers,
    config: validation.config.value,
    servers: validation.config.servers,
  };
}
