import type {
  McpDiscoverySummary,
  McpServerConnectionStatus,
  McpServerConnectionSummary,
} from "../../../shared/protocol.ts";
import { MaterialIcon } from "../MaterialIcon.tsx";

export function McpConnectionBadges({
  className = "",
  mcp,
}: {
  className?: string;
  mcp: McpDiscoverySummary;
}) {
  const connecting = mcpConnectingServerCount(mcp);
  const disabled = mcpDisabledServerCount(mcp);
  const failed = mcpFailedServerCount(mcp);

  if (connecting === 0 && disabled === 0 && failed === 0) {
    return null;
  }

  return (
    <span className={["inline-flex shrink-0 items-center gap-1", className].join(" ")}>
      {connecting > 0 ? (
        <span
          aria-label={`${connecting} MCP server${connecting === 1 ? "" : "s"} connecting`}
          className="truss-spinner h-3.5 w-3.5 rounded-full border-2 border-outline-variant border-t-primary"
          role="img"
          title={`${connecting} MCP server${connecting === 1 ? "" : "s"} connecting`}
        />
      ) : null}
      {disabled > 0 ? (
        <span
          aria-label={`${disabled} MCP server${disabled === 1 ? "" : "s"} disabled`}
          className="grid h-4 w-4 place-items-center rounded-full bg-surface-container-high text-on-surface-variant"
          role="img"
          title={`${disabled} MCP server${disabled === 1 ? "" : "s"} disabled`}
        >
          <MaterialIcon name="block" size={13} />
        </span>
      ) : null}
      {failed > 0 ? (
        <span
          aria-label={`${failed} MCP server${failed === 1 ? "" : "s"} failed`}
          className="grid h-4 w-4 place-items-center rounded-full bg-error-container text-error"
          role="img"
          title={`${failed} MCP server${failed === 1 ? "" : "s"} failed`}
        >
          <MaterialIcon fill name="error" size={13} />
        </span>
      ) : null}
    </span>
  );
}

export function mcpServerStatus(
  server: McpServerConnectionSummary,
): McpServerConnectionStatus {
  return server.status ?? (server.connected ? "connected" : "failed");
}

export function mcpConnectingServerCount(mcp: McpDiscoverySummary): number {
  return (
    mcp.connectingServers ??
    mcp.servers.filter((server) => mcpServerStatus(server) === "connecting").length
  );
}

export function mcpFailedServerCount(mcp: McpDiscoverySummary): number {
  return (
    mcp.failedServers ??
    mcp.servers.filter((server) => mcpServerStatus(server) === "failed").length
  );
}

export function mcpDisabledServerCount(mcp: McpDiscoverySummary): number {
  return mcp.servers.filter((server) => mcpServerStatus(server) === "disabled").length;
}
