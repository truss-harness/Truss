import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import type {
  McpDiscoverySummary,
  McpPromptCapability,
  McpResourceCapability,
  McpResourceContent,
  McpServerConnectionSummary,
  McpToolCapability,
} from "../../../shared/protocol.ts";
import { readMcpResource } from "../../api.ts";
import { MaterialIcon } from "../MaterialIcon.tsx";
import { McpConnectionBadges, mcpServerStatus } from "./McpConnectionStatus.tsx";
import { McpServerErrorPanel } from "./McpServerErrorPanel.tsx";
import { McpServerSourceBadge } from "./McpServerSourceBadge.tsx";

export function McpServerDiscoveryList({
  approvingStdioServers = false,
  error,
  loading,
  mcp,
  onApproveStdioServers,
}: {
  approvingStdioServers?: boolean;
  error: string | null;
  loading: boolean;
  mcp: McpDiscoverySummary | null;
  onApproveStdioServers?(): void;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-on-surface">MCP servers</h3>
          <p className="mt-1 text-xs leading-5 text-on-surface-variant">
            {mcp
              ? `${mcp.availableTools} tools, ${resourceCount(mcp)} resources, ${promptCount(mcp)} prompts`
              : "Loading discovered MCP capabilities"}
          </p>
        </div>
        <span className="inline-flex items-center gap-2 text-xs text-on-surface-variant">
          {mcp ? <McpConnectionBadges mcp={mcp} /> : null}
          <span>{mcp ? `${mcp.connectedServers}/${mcp.discoveredServers} connected` : "Loading"}</span>
        </span>
      </div>

      {error ? (
        <p className="rounded-sm border border-error-container bg-error-container/25 px-3 py-2 text-sm text-error">
          {error}
        </p>
      ) : null}

      {loading && !mcp ? (
        <div className="flex min-h-24 items-center justify-center rounded-sm border border-outline-variant bg-surface-container-lowest text-sm font-medium text-on-surface-variant">
          <span className="truss-spinner mr-3 h-4 w-4 rounded-full border-2 border-outline-variant border-t-primary" />
          Loading MCP servers
        </div>
      ) : null}

      <div className="grid gap-2">
        {(mcp?.servers ?? []).map((server) => (
          <McpServerDiscoveryCard
            approvingStdioServers={approvingStdioServers}
            key={server.serverId}
            onApproveStdioServers={onApproveStdioServers}
            server={server}
          />
        ))}
        {mcp && mcp.servers.length === 0 ? (
          <p className="rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-3 text-sm text-on-surface-variant">
            No MCP servers are configured.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function McpServerDiscoveryCard({
  approvingStdioServers,
  onApproveStdioServers,
  server,
}: {
  approvingStdioServers: boolean;
  onApproveStdioServers?(): void;
  server: McpServerConnectionSummary;
}) {
  const hasViewableCapabilities = server.resources.length > 0 || server.prompts.length > 0;
  const status = mcpServerStatus(server);
  const canExpand = status === "connected";
  const [expanded, setExpanded] = useState(canExpand && hasViewableCapabilities);
  const panelId = useId();

  useEffect(() => {
    if (!canExpand) {
      setExpanded(false);
      return;
    }

    if (hasViewableCapabilities) {
      setExpanded(true);
    }
  }, [canExpand, hasViewableCapabilities]);

  return (
    <article
      className={[
        "relative rounded-sm border bg-surface-container-lowest px-3 py-3",
        canExpand
          ? "group/mcp-server-card border-outline-variant transition-colors hover:bg-surface-container-low focus-within:bg-surface-container-low"
          : status === "connecting"
            ? "border-outline-variant"
            : status === "disabled"
              ? "border-outline-variant bg-surface-container-low"
              : "border-error-container/70 bg-error-container/10",
      ].join(" ")}
    >
      {canExpand ? (
        <button
          aria-controls={panelId}
          aria-expanded={expanded}
          className="absolute inset-0 z-0 cursor-pointer rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-outline"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          <span className="sr-only">Toggle {server.name} capabilities</span>
        </button>
      ) : null}

      <div
        className={[
          "relative z-10 grid gap-3",
          canExpand ? "pointer-events-none sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start" : "",
        ].join(" ")}
      >
        <McpServerDiscoverySummary
          approvingStdioServers={approvingStdioServers}
          onApproveStdioServers={onApproveStdioServers}
          server={server}
        />
        {canExpand ? (
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-on-surface-variant transition group-hover/mcp-server-card:text-on-surface">
            <MaterialIcon
              className={[
                "transition-transform duration-200 ease-out",
                expanded ? "rotate-180" : "rotate-0",
              ].join(" ")}
              name="expand_more"
              size={20}
            />
          </span>
        ) : null}
      </div>

      {canExpand ? (
        <div
          aria-hidden={!expanded}
          className={[
            "relative z-10 grid transition-[grid-template-rows,opacity,transform] duration-200 ease-out",
            expanded
              ? "grid-rows-[1fr] translate-y-0 opacity-100"
              : "grid-rows-[0fr] -translate-y-1 opacity-0",
          ].join(" ")}
          id={panelId}
          inert={!expanded}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="mt-3 grid gap-3 border-t border-outline-variant/60 pt-3">
              <McpCapabilitySection
                count={server.tools.length}
                empty="No tools exposed by this server."
                title="Tools"
              >
                {server.tools.map((tool) => (
                  <McpToolRow key={tool.name} tool={tool} />
                ))}
              </McpCapabilitySection>
              <McpCapabilitySection
                count={server.resources.length}
                empty="No resources exposed by this server."
                title="Resources"
              >
                {server.resources.map((resource) => (
                  <McpResourceRow
                    key={resource.uri}
                    resource={resource}
                    serverId={server.serverId}
                  />
                ))}
              </McpCapabilitySection>
              <McpCapabilitySection
                count={server.prompts.length}
                empty="No prompts exposed by this server."
                title="Prompts"
              >
                {server.prompts.map((prompt) => (
                  <McpPromptRow key={prompt.name} prompt={prompt} />
                ))}
              </McpCapabilitySection>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function McpServerDiscoverySummary({
  approvingStdioServers,
  onApproveStdioServers,
  server,
}: {
  approvingStdioServers: boolean;
  onApproveStdioServers?(): void;
  server: McpServerConnectionSummary;
}) {
  const status = mcpServerStatus(server);

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {status === "connecting" ? (
          <span className="truss-spinner h-3 w-3 shrink-0 rounded-full border-2 border-outline-variant border-t-primary" />
        ) : status === "disabled" ? (
          <MaterialIcon className="shrink-0 text-on-surface-variant" name="block" size={15} />
        ) : status === "failed" ? (
          <MaterialIcon className="shrink-0 text-error" fill name="error" size={15} />
        ) : (
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-600" />
        )}
        <h4 className="min-w-0 truncate text-sm font-semibold text-on-surface">
          {server.name}
        </h4>
        <McpServerSourceBadge server={server} />
      </div>
      <p className="mt-1 text-xs text-on-surface-variant">
        {status === "connected"
          ? capabilitySummary(server)
          : status === "connecting"
            ? "Connecting"
            : status === "disabled"
              ? disabledStatusText(server)
              : "Failed to start"}
      </p>
      {status === "disabled" ? <McpServerDisabledPanel server={server} /> : null}
      {status === "failed" && server.error ? (
        <McpServerErrorPanel
          approving={approvingStdioServers}
          error={server.error}
          onApproveStdioServers={onApproveStdioServers}
        />
      ) : null}
      {status === "failed" ? <McpJsonSettingsLink /> : null}
    </div>
  );
}

function McpServerDisabledPanel({ server }: { server: McpServerConnectionSummary }) {
  return (
    <div className="mt-3 rounded-sm border border-outline-variant bg-surface px-3 py-2 text-on-surface-variant">
      <div className="flex min-w-0 items-start gap-2">
        <MaterialIcon className="mt-0.5 shrink-0" name="block" size={16} />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-on-surface">
            {disabledPanelTitle(server)}
          </p>
          <p className="mt-1 break-words text-xs leading-5">
            {server.disabledReason ?? "This MCP server is disabled in mcp.json."}
          </p>
        </div>
      </div>
    </div>
  );
}

function disabledStatusText(server: McpServerConnectionSummary): string {
  return server.trussManaged ? "Force-disabled" : "Disabled";
}

function disabledPanelTitle(server: McpServerConnectionSummary): string {
  return server.trussManaged ? "MCP server force-disabled" : "MCP server disabled";
}

function McpJsonSettingsLink() {
  return (
    <a
      className="mt-3 inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-outline-variant bg-surface px-2.5 text-xs font-semibold text-on-surface-variant no-underline transition hover:border-outline hover:bg-surface-container-low hover:text-primary focus-visible:border-outline focus-visible:bg-surface focus-visible:text-primary focus-visible:outline-none"
      href="/settings?tab=mcp-servers"
    >
      <MaterialIcon name="settings" size={15} />
      Open mcp.json settings
    </a>
  );
}

function McpCapabilitySection({
  children,
  count,
  empty,
  title,
}: {
  children: ReactNode;
  count: number;
  empty: string;
  title: string;
}) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <h5 className="text-xs font-semibold uppercase text-on-surface-variant">{title}</h5>
        <span className="text-xs text-on-surface-variant">{count}</span>
      </div>
      {count > 0 ? (
        <div className="grid gap-2">{children}</div>
      ) : (
        <p className="rounded-sm border border-outline-variant/70 bg-surface px-3 py-2 text-xs text-on-surface-variant">
          {empty}
        </p>
      )}
    </section>
  );
}

function McpToolRow({ tool }: { tool: McpToolCapability }) {
  return (
    <div className="grid gap-1 rounded-sm border border-outline-variant bg-surface px-3 py-3">
      <p className="min-w-0 truncate font-mono text-xs font-semibold text-on-surface">
        {tool.name}
      </p>
      {tool.description ? (
        <p className="text-xs leading-5 text-on-surface-variant">{tool.description}</p>
      ) : null}
    </div>
  );
}

type McpResourceReadState =
  | { status: "idle" }
  | { status: "loading" }
  | { contents: McpResourceContent[]; status: "success" }
  | { error: string; status: "error" };

function McpResourceRow({
  resource,
  serverId,
}: {
  resource: McpResourceCapability;
  serverId: string;
}) {
  const [readState, setReadState] = useState<McpResourceReadState>({ status: "idle" });
  const contentId = useId();
  const loading = readState.status === "loading";

  const handleReadResource = async () => {
    if (loading) {
      return;
    }

    setReadState({ status: "loading" });

    try {
      const response = await readMcpResource({
        serverId,
        uri: resource.uri,
      });

      setReadState({
        contents: response.contents,
        status: "success",
      });
    } catch (caught) {
      setReadState({
        error: caught instanceof Error ? caught.message : String(caught),
        status: "error",
      });
    }
  };

  return (
    <div className="grid gap-1 rounded-sm border border-outline-variant bg-surface px-3 py-3">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="min-w-0 break-words text-xs font-semibold text-on-surface">
              {resource.name ?? resource.uri}
            </p>
            {resource.mimeType ? (
              <span className="rounded-sm border border-outline-variant bg-surface-container-low px-1.5 py-0.5 font-mono text-[0.68rem] text-on-surface-variant">
                {resource.mimeType}
              </span>
            ) : null}
          </div>
          <code className="min-w-0 break-all font-mono text-xs text-on-surface-variant">
            {resource.uri}
          </code>
        </div>
        <button
          aria-controls={contentId}
          aria-expanded={readState.status === "success"}
          className="pointer-events-auto inline-grid h-7 w-7 shrink-0 place-items-center rounded-sm border border-outline-variant bg-surface-container-low text-on-surface-variant transition hover:border-outline hover:bg-surface hover:text-primary focus-visible:border-outline focus-visible:text-primary focus-visible:outline-none disabled:cursor-progress disabled:opacity-70"
          disabled={loading}
          onClick={handleReadResource}
          title={loading ? "Reading resource" : "Read resource"}
          type="button"
        >
          {loading ? (
            <span className="truss-spinner h-3.5 w-3.5 rounded-full border-2 border-outline-variant border-t-primary" />
          ) : (
            <MaterialIcon name="article" size={16} />
          )}
          <span className="sr-only">Read {resource.name ?? resource.uri}</span>
        </button>
      </div>
      {readState.status === "error" ? (
        <p
          className="pointer-events-auto mt-2 rounded-sm border border-error-container bg-error-container/25 px-2.5 py-2 text-xs leading-5 text-error"
          id={contentId}
        >
          {readState.error}
        </p>
      ) : null}
      {readState.status === "success" ? (
        <div
          className="pointer-events-auto mt-2 grid gap-2 rounded-sm border border-outline-variant/70 bg-surface-container-low px-2.5 py-2"
          id={contentId}
        >
          {readState.contents.length > 0 ? (
            readState.contents.map((content, index) => (
              <div className="grid gap-1" key={`${content.uri}-${index}`}>
                {readState.contents.length > 1 ? (
                  <code className="min-w-0 break-all font-mono text-[0.68rem] text-on-surface-variant">
                    {content.uri}
                  </code>
                ) : null}
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[0.72rem] leading-5 text-on-surface">{resourceContentPreview(content)}</pre>
              </div>
            ))
          ) : (
            <p className="text-xs text-on-surface-variant">No content returned.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function resourceContentPreview(content: McpResourceContent): string {
  if (content.text !== undefined) {
    return content.text;
  }

  if (content.blob !== undefined) {
    return `Base64 blob content, ${content.blob.length} characters.`;
  }

  return "";
}

function McpPromptRow({ prompt }: { prompt: McpPromptCapability }) {
  const argumentLabels = (prompt.arguments ?? []).map(promptArgumentLabel);

  return (
    <div className="grid gap-1 rounded-sm border border-outline-variant bg-surface px-3 py-3">
      <p className="min-w-0 break-all font-mono text-xs font-semibold text-on-surface">
        {prompt.name}
      </p>
      {prompt.description ? (
        <p className="text-xs leading-5 text-on-surface-variant">{prompt.description}</p>
      ) : null}
      {argumentLabels.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {argumentLabels.map((argument) => (
            <span
              className="rounded-sm border border-outline-variant bg-surface-container-low px-1.5 py-0.5 font-mono text-[0.68rem] text-on-surface-variant"
              key={argument}
            >
              {argument}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function capabilitySummary(server: McpServerConnectionSummary): string {
  return [
    pluralize(server.tools.length, "tool"),
    pluralize(server.resources.length, "resource"),
    pluralize(server.prompts.length, "prompt"),
    server.transport,
  ].join(" / ");
}

function resourceCount(mcp: McpDiscoverySummary): number {
  return mcp.servers.reduce((total, server) => total + server.resources.length, 0);
}

function promptCount(mcp: McpDiscoverySummary): number {
  return mcp.servers.reduce((total, server) => total + server.prompts.length, 0);
}

function pluralize(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function promptArgumentLabel(argument: Record<string, unknown>): string {
  const name = typeof argument.name === "string" && argument.name.trim()
    ? argument.name.trim()
    : "argument";
  const required = argument.required === true;

  return required ? `${name} required` : name;
}
