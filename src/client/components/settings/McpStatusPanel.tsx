import type { McpDiscoverySummary } from "../../../shared/protocol.ts";
import { MaterialIcon } from "../MaterialIcon.tsx";
import { McpServerDiscoveryList } from "../mcp/McpServerDiscoveryList.tsx";
import { SecondaryButton } from "./SettingsControls.tsx";

export function McpServersSettingsPanel({
  approvingStdioServers,
  error,
  loading,
  mcp,
  onApproveStdioServers,
  onManageServers,
  onReload,
  onRefresh,
  reloading,
}: {
  approvingStdioServers: boolean;
  error: string | null;
  loading: boolean;
  mcp: McpDiscoverySummary | null;
  onApproveStdioServers(): void;
  onManageServers(): void;
  onReload(): void;
  onRefresh(): void;
  reloading: boolean;
}) {
  return (
    <div className="grid max-w-[980px] gap-4 pb-8">
      <article className="grid gap-4 rounded-sm border border-outline-variant bg-surface-container-lowest p-4 shadow-[0_12px_34px_rgb(27_28_25/0.06)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-primary">
            <MaterialIcon name="schema" size={20} />
            <h3 className="text-base font-semibold text-on-surface">
              Runtime MCP discovery
            </h3>
          </div>
          <p className="mt-3 text-sm leading-6 text-on-surface-variant">
            These are the servers and capabilities negotiated by the current Truss
            process. Reload MCP servers after editing mcp.json to reconnect changed
            servers without restarting Truss.
          </p>
          {mcp?.configPath ? (
            <code className="mt-3 block min-w-0 overflow-x-auto whitespace-nowrap rounded-sm border border-outline-variant bg-surface px-3 py-2 text-xs text-on-surface-variant">
              {mcp.configPath}
            </code>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <SecondaryButton
            icon="settings_ethernet"
            label="Manage MCP servers"
            onClick={onManageServers}
          />
          <SecondaryButton
            disabled={loading || reloading}
            icon="sync"
            label={reloading ? "Reloading" : "Reload MCP servers"}
            onClick={onReload}
          />
          <SecondaryButton
            disabled={loading || reloading}
            icon={loading ? "sync" : "refresh"}
            label={loading ? "Refreshing" : "Refresh"}
            onClick={onRefresh}
          />
        </div>
      </article>

      <McpServerDiscoveryList
        approvingStdioServers={approvingStdioServers || reloading}
        error={error}
        loading={loading}
        mcp={mcp}
        onApproveStdioServers={onApproveStdioServers}
      />
    </div>
  );
}


