import { useEffect, useId, useState } from "react";
import type {
  ChatToolSettings,
  McpCapabilitiesEvent,
  McpServerConnectionSummary,
  McpToolCapability,
  SessionInfo,
  SkillReadResponse,
  SkillSummary,
  SystemReadyEvent,
} from "../../../shared/protocol.ts";
import {
  fetchMcpSettings,
  fetchSession,
  readSkill,
  reloadMcpServers,
  updateMcpSettings,
} from "../../api.ts";
import { MaterialIcon } from "../MaterialIcon.tsx";
import { Modal } from "../Modal.tsx";
import { McpConnectionBadges, mcpServerStatus } from "../mcp/McpConnectionStatus.tsx";
import { McpServerErrorPanel } from "../mcp/McpServerErrorPanel.tsx";
import { McpServerSourceBadge } from "../mcp/McpServerSourceBadge.tsx";
import { SecondaryButton } from "../settings/SettingsControls.tsx";
import {
  setAllMcpServersDisabled,
  shouldRequestExternalStdioApproval,
} from "../settings/McpConfigUtils.ts";
import { errorMessage } from "./chat-utils.ts";

export function ToolSettingsModal({
  onChange,
  onClose,
  onMcpReloaded,
  open,
  settings,
}: {
  onChange(settings: ChatToolSettings): void;
  onClose(): void;
  onMcpReloaded?(mcp: NonNullable<SessionInfo["mcp"]>): void;
  open: boolean;
  settings: ChatToolSettings;
}) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [mcpConfigText, setMcpConfigText] = useState<string | null>(null);
  const [enablingAll, setEnablingAll] = useState(false);
  const [disablingAll, setDisablingAll] = useState(false);
  const [approvingStdioServers, setApprovingStdioServers] = useState(false);
  const [activeTab, setActiveTab] = useState<"mcp" | "skills">("mcp");
  const [selectedSkill, setSelectedSkill] = useState<SkillSummary | null>(null);
  const mcp = session?.mcp;

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const [nextSession, mcpSettings] = await Promise.all([
          fetchSession(),
          fetchMcpSettings(),
        ]);

        if (!cancelled) {
          setSession(nextSession);
          setSessionError(null);
          setMcpConfigText(mcpSettings.mcpConfigText);
        }
      } catch (caught) {
        if (!cancelled) {
          setSessionError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const source = new EventSource("/api/events");

    const handleMcpEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as McpCapabilitiesEvent;

      setSession((current) => (current ? { ...current, mcp: event.mcp } : current));
      setSessionError(null);
    };

    const handleReadyEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as SystemReadyEvent;

      setSession(event.session);
      setSessionError(null);
    };

    source.addEventListener("mcp.capabilities", handleMcpEvent);
    source.addEventListener("system.ready", handleReadyEvent);

    return () => {
      source.removeEventListener("mcp.capabilities", handleMcpEvent);
      source.removeEventListener("system.ready", handleReadyEvent);
      source.close();
    };
  }, [open]);

  function patch(update: Partial<ChatToolSettings>): void {
    onChange({
      ...settings,
      ...update,
    });
  }

  async function approveCurrentStdioServers(): Promise<void> {
    if (
      !window.confirm(
        "Approving allows Truss to spawn active external stdio commands from mcp.json. Approve and reload MCP servers?",
      )
    ) {
      return;
    }

    setApprovingStdioServers(true);
    setSessionError(null);

    try {
      const response = await reloadMcpServers({ approveStdioServers: true });

      setSession((current) => (current ? { ...current, mcp: response.mcp } : current));
      onMcpReloaded?.(response.mcp);
    } catch (caught) {
      setSessionError(errorMessage(caught));
    } finally {
      setApprovingStdioServers(false);
    }
  }

  async function enableAllMcpServers(): Promise<void> {
    if (!window.confirm("Enable all non-Truss-managed MCP servers in mcp.json?")) {
      return;
    }

    setEnablingAll(true);
    setSessionError(null);

    try {
      const currentConfigText = mcpConfigText ?? "{\n  \"mcpServers\": {}\n}\n";
      const nextConfigText = setAllMcpServersDisabled(currentConfigText, false);
      const approveStdioServers = shouldRequestExternalStdioApproval(nextConfigText);
      const response = await updateMcpSettings({
        ...(approveStdioServers ? { approveStdioServers: true } : {}),
        mcpConfigText: nextConfigText,
      });
      const reload = await reloadMcpServers(
        approveStdioServers ? { approveStdioServers: true } : {},
      );

      setMcpConfigText(response.mcpConfigText);
      setSession((current) => (current ? { ...current, mcp: reload.mcp } : current));
      onMcpReloaded?.(reload.mcp);
    } catch (caught) {
      setSessionError(errorMessage(caught));
    } finally {
      setEnablingAll(false);
    }
  }

  async function disableAllMcpServers(): Promise<void> {
    if (!window.confirm("Disable all non-Truss-managed MCP servers in mcp.json?")) {
      return;
    }

    setDisablingAll(true);
    setSessionError(null);

    try {
      const currentConfigText = mcpConfigText ?? "{\n  \"mcpServers\": {}\n}\n";
      const nextConfigText = setAllMcpServersDisabled(currentConfigText, true);
      const response = await updateMcpSettings({ mcpConfigText: nextConfigText });
      const reload = await reloadMcpServers();

      setMcpConfigText(response.mcpConfigText);
      setSession((current) => (current ? { ...current, mcp: reload.mcp } : current));
      onMcpReloaded?.(reload.mcp);
    } catch (caught) {
      setSessionError(errorMessage(caught));
    } finally {
      setDisablingAll(false);
    }
  }

  function setServerEnabled(serverId: string, enabled: boolean): void {
    const current = new Set(settings.disabledMcpServerIds ?? []);

    if (enabled) {
      current.delete(serverId);
    } else {
      current.add(serverId);
    }

    patch({ disabledMcpServerIds: [...current] });
  }

  function setToolEnabled(serverId: string, toolName: string, enabled: boolean): void {
    const current = new Set(settings.disabledMcpTools?.[serverId] ?? []);

    if (enabled) {
      current.delete(toolName);
    } else {
      current.add(toolName);
    }

    patch({
      disabledMcpTools: {
        ...(settings.disabledMcpTools ?? {}),
        [serverId]: [...current],
      },
    });
  }

  return (
    <>
      <Modal
        description={
          activeTab === "skills"
            ? session
              ? `${session.skills.activeSkills} active of ${session.skills.discoveredSkills} discovered skills.`
              : "Loading discovered skills."
            : mcp
              ? `${enabledToolCount(settings, mcp.servers)} of ${mcp.availableTools} MCP tools enabled.`
              : "Configure MCP tools for new messages."
        }
        headerActions={<OpenMcpSettingsLink />}
        headerTabs={<ToolSettingsTabs activeTab={activeTab} onChange={setActiveTab} />}
        icon="construction"
        onClose={onClose}
        open={open}
        size="lg"
        title="MCP Settings"
      >
        <div className="grid gap-4">
          {sessionError ? (
            <p className="rounded-sm border border-error-container bg-error-container/25 px-3 py-2 text-sm text-error">
              {sessionError}
            </p>
          ) : null}

          {activeTab === "mcp" ? (
            <McpServersTab
              approvingStdioServers={approvingStdioServers}
              disablingAll={disablingAll}
              enablingAll={enablingAll}
              loading={!mcp}
              mcp={mcp}
              onApproveStdioServers={() => void approveCurrentStdioServers()}
              onDisableAll={() => void disableAllMcpServers()}
              onEnableAll={() => void enableAllMcpServers()}
              onServerEnabledChange={setServerEnabled}
              onToolEnabledChange={setToolEnabled}
              settings={settings}
            />
          ) : (
            <SkillsTab
              onOpenSkill={setSelectedSkill}
              skills={session?.skills.skills ?? []}
            />
          )}
        </div>
      </Modal>
      <SkillReadModal
        onClose={() => setSelectedSkill(null)}
        open={open && Boolean(selectedSkill)}
        skill={selectedSkill}
      />
    </>
  );
}

function ToolSettingsTabs({
  activeTab,
  onChange,
}: {
  activeTab: "mcp" | "skills";
  onChange(tab: "mcp" | "skills"): void;
}) {
  return (
    <div
      aria-label="MCP settings views"
      className="flex min-w-0 gap-2 overflow-x-auto"
      role="tablist"
    >
      <ToolSettingsTabButton
        active={activeTab === "mcp"}
        icon="hub"
        label="MCP Servers"
        onClick={() => onChange("mcp")}
      />
      <ToolSettingsTabButton
        active={activeTab === "skills"}
        icon="extension"
        label="Skills"
        onClick={() => onChange("skills")}
      />
    </div>
  );
}

function ToolSettingsTabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      aria-selected={active}
      className={[
        "inline-flex h-8 shrink-0 items-center gap-2 rounded-t-sm border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline",
        active
          ? "border-primary bg-primary text-on-primary shadow-[0_1px_3px_rgb(27_28_25/0.14)]"
          : "border-outline-variant bg-surface text-on-surface-variant hover:bg-surface-container hover:text-primary",
      ].join(" ")}
      onClick={onClick}
      role="tab"
      type="button"
    >
      <MaterialIcon name={icon} size={17} />
      {label}
    </button>
  );
}

function McpServersTab({
  approvingStdioServers,
  disablingAll,
  enablingAll,
  loading,
  mcp,
  onApproveStdioServers,
  onDisableAll,
  onEnableAll,
  onServerEnabledChange,
  onToolEnabledChange,
  settings,
}: {
  approvingStdioServers: boolean;
  disablingAll: boolean;
  enablingAll: boolean;
  loading: boolean;
  mcp: SessionInfo["mcp"] | undefined;
  onApproveStdioServers(): void;
  onDisableAll(): void;
  onEnableAll(): void;
  onServerEnabledChange(serverId: string, enabled: boolean): void;
  onToolEnabledChange(serverId: string, toolName: string, enabled: boolean): void;
  settings: ChatToolSettings;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-on-surface">MCP servers</h3>
        <div className="flex flex-wrap items-center gap-2">
          <SecondaryButton
            disabled={enablingAll || disablingAll || loading}
            icon="check_circle"
            label={enablingAll ? "Enabling all" : "Enable all"}
            onClick={onEnableAll}
          />
          <SecondaryButton
            disabled={enablingAll || disablingAll || loading}
            icon="block"
            label={disablingAll ? "Disabling all" : "Disable all"}
            onClick={onDisableAll}
          />
          <span className="inline-flex items-center gap-2 text-xs text-on-surface-variant">
            {mcp ? <McpConnectionBadges mcp={mcp} /> : null}
            <span>{mcp ? `${mcp.connectedServers}/${mcp.discoveredServers} connected` : "Loading"}</span>
          </span>
        </div>
      </div>
      <div className="grid gap-2">
        {(mcp?.servers ?? []).map((server) => (
          <McpServerToggleCard
            approvingStdioServers={approvingStdioServers}
            key={server.serverId}
            onApproveStdioServers={onApproveStdioServers}
            onServerEnabledChange={(enabled) => onServerEnabledChange(server.serverId, enabled)}
            onToolEnabledChange={(toolName, enabled) =>
              onToolEnabledChange(server.serverId, toolName, enabled)
            }
            server={server}
            settings={settings}
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

function SkillsTab({
  onOpenSkill,
  skills,
}: {
  onOpenSkill(skill: SkillSummary): void;
  skills: SkillSummary[];
}) {
  const globalSkills = skills.filter((skill) => skill.scope === "global");
  const workspaceSkills = skills.filter((skill) => skill.scope === "workspace");

  return (
    <section className="grid gap-4">
      <SkillScopeSection
        emptyText="No global skills discovered."
        onOpenSkill={onOpenSkill}
        skills={globalSkills}
        title="Global skills"
      />
      <SkillScopeSection
        emptyText="No workspace-scoped skills discovered."
        onOpenSkill={onOpenSkill}
        skills={workspaceSkills}
        title="Workspace-scoped skills"
      />
    </section>
  );
}

function SkillScopeSection({
  emptyText,
  onOpenSkill,
  skills,
  title,
}: {
  emptyText: string;
  onOpenSkill(skill: SkillSummary): void;
  skills: SkillSummary[];
  title: string;
}) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-on-surface">{title}</h3>
        <span className="text-xs font-medium text-on-surface-variant">{skills.length}</span>
      </div>
      <div className="grid gap-2">
        {skills.map((skill) => (
          <SkillSummaryButton
            key={skill.id}
            onClick={() => onOpenSkill(skill)}
            skill={skill}
          />
        ))}
        {skills.length === 0 ? (
          <p className="rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-3 text-sm text-on-surface-variant">
            {emptyText}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function SkillSummaryButton({
  onClick,
  skill,
}: {
  onClick(): void;
  skill: SkillSummary;
}) {
  return (
    <button
      className="grid gap-2 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-3 text-left transition hover:border-outline hover:bg-surface-container-low focus-visible:border-outline focus-visible:bg-surface focus-visible:outline-none"
      onClick={onClick}
      type="button"
    >
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <MaterialIcon className="shrink-0 text-primary" name="extension" size={16} />
        <span className="min-w-0 truncate text-sm font-semibold text-on-surface">
          {skill.name}
        </span>
        <span className="rounded-sm border border-outline-variant bg-surface px-1.5 py-0.5 text-[0.68rem] font-semibold uppercase text-on-surface-variant">
          {skill.source}
        </span>
        {skill.active ? (
          <span className="rounded-sm border border-primary/30 bg-primary-container px-1.5 py-0.5 text-[0.68rem] font-semibold uppercase text-on-primary-container">
            active
          </span>
        ) : null}
      </span>
      {skill.description ? (
        <span className="text-xs leading-5 text-on-surface-variant">
          {skill.description}
        </span>
      ) : null}
      <span className="min-w-0 truncate font-mono text-[0.68rem] text-on-surface-variant">
        {skill.path}
      </span>
    </button>
  );
}

function SkillReadModal({
  onClose,
  open,
  skill,
}: {
  onClose(): void;
  open: boolean;
  skill: SkillSummary | null;
}) {
  const [document, setDocument] = useState<SkillReadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !skill) {
      return;
    }

    let cancelled = false;

    setLoading(true);
    setError(null);
    setDocument(null);

    void (async () => {
      try {
        const response = await readSkill({ skillId: skill.id });

        if (!cancelled) {
          setDocument(response);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(errorMessage(caught));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, skill]);

  return (
    <Modal
      bodyClassName="overflow-hidden"
      description={skill ? `${skill.scope}/${skill.source} - ${skill.path}` : undefined}
      icon="extension"
      onClose={onClose}
      open={open && Boolean(skill)}
      size="lg"
      title={skill?.name ?? "Skill"}
    >
      {loading ? (
        <div className="flex items-center gap-2 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-3 text-sm text-on-surface-variant">
          <span className="truss-spinner h-4 w-4 shrink-0 rounded-full border-2 border-outline-variant border-t-primary" />
          Loading
        </div>
      ) : null}
      {error ? (
        <p className="rounded-sm border border-error-container bg-error-container/25 px-3 py-2 text-sm text-error">
          {error}
        </p>
      ) : null}
      {document ? (
        <pre className="truss-message-scrollbar max-h-[65vh] min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-outline-variant bg-surface-container-lowest px-4 py-3 font-mono text-xs leading-5 text-on-surface">
          {document.body}
        </pre>
      ) : null}
    </Modal>
  );
}

function OpenMcpSettingsLink() {
  return (
    <a
      aria-label="Open MCP Settings"
      className="truss-modal-header-button group/mcp-settings relative"
      href="/settings?tab=mcp-servers"
      title="MCP Servers"
    >
      <MaterialIcon name="settings" size={18} />
      <span className="pointer-events-none absolute right-0 top-[calc(100%+7px)] z-[130] w-max max-w-48 translate-y-[-0.25rem] whitespace-nowrap rounded-sm border border-outline-variant bg-surface px-2 py-1 text-xs font-medium text-on-surface opacity-0 shadow-[0_10px_24px_rgb(27_28_25/0.14)] transition group-hover/mcp-settings:translate-y-0 group-hover/mcp-settings:opacity-100 group-focus-visible/mcp-settings:translate-y-0 group-focus-visible/mcp-settings:opacity-100">
        MCP Servers
      </span>
    </a>
  );
}

function McpServerToggleCard({
  approvingStdioServers,
  onApproveStdioServers,
  onServerEnabledChange,
  onToolEnabledChange,
  server,
  settings,
}: {
  approvingStdioServers: boolean;
  onApproveStdioServers(): void;
  onServerEnabledChange(enabled: boolean): void;
  onToolEnabledChange(toolName: string, enabled: boolean): void;
  server: McpServerConnectionSummary;
  settings: ChatToolSettings;
}) {
  const serverEnabled = !(settings.disabledMcpServerIds ?? []).includes(server.serverId);
  const status = mcpServerStatus(server);
  const connected = status === "connected";
  const [expanded, setExpanded] = useState(false);
  const toolsPanelId = useId();

  return (
    <article
      className={[
        "relative rounded-sm border bg-surface-container-lowest px-3 py-3",
        connected
          ? "group/mcp-server-card border-outline-variant transition-colors hover:bg-surface-container-low focus-within:bg-surface-container-low"
          : status === "connecting"
            ? "border-outline-variant"
            : status === "disabled"
              ? "border-outline-variant bg-surface-container-low"
              : "border-error-container/70 bg-error-container/10",
      ].join(" ")}
    >
      {connected ? (
        <button
          aria-controls={toolsPanelId}
          aria-expanded={expanded}
          className="absolute inset-0 z-0 cursor-pointer rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-outline"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          <span className="sr-only">Toggle {server.name} tools</span>
        </button>
      ) : null}

      <div
        className={[
          "relative z-10 grid gap-3",
          connected
            ? "pointer-events-none sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-start"
            : "",
        ].join(" ")}
      >
        <McpServerToggleSummary
          approvingStdioServers={approvingStdioServers}
          onApproveStdioServers={onApproveStdioServers}
          server={server}
          settings={settings}
        />
        {connected ? (
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
        {connected ? (
          <div
            className="pointer-events-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <SettingsSwitch
              checked={serverEnabled}
              label={`${server.name} enabled`}
              onChange={onServerEnabledChange}
            />
          </div>
        ) : null}
      </div>

      {connected ? (
        <div
          aria-hidden={!expanded}
          className={[
            "relative z-10 grid transition-[grid-template-rows,opacity,transform] duration-200 ease-out",
            expanded
              ? "grid-rows-[1fr] translate-y-0 opacity-100"
              : "grid-rows-[0fr] -translate-y-1 opacity-0",
          ].join(" ")}
          id={toolsPanelId}
          inert={!expanded}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="min-h-0 overflow-hidden">
            {server.tools.length > 0 ? (
              <div className="mt-3 grid gap-2 border-t border-outline-variant/60 pt-3">
                {server.tools.map((tool) => (
                  <McpToolToggleRow
                    disabled={!serverEnabled}
                    key={tool.name}
                    onChange={(enabled) => onToolEnabledChange(tool.name, enabled)}
                    serverId={server.serverId}
                    settings={settings}
                    tool={tool}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-3 border-t border-outline-variant/60 pt-3 text-xs text-on-surface-variant">
                No tools exposed by this server.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function McpServerToggleSummary({
  approvingStdioServers,
  onApproveStdioServers,
  server,
  settings,
}: {
  approvingStdioServers: boolean;
  onApproveStdioServers(): void;
  server: McpServerConnectionSummary;
  settings: ChatToolSettings;
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
          ? `${enabledServerToolCount(settings, server)} of ${server.tools.length} tools enabled`
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
      href="/settings?tab=third-party-mcp"
    >
      <MaterialIcon name="settings" size={15} />
      Open mcp.json settings
    </a>
  );
}

function McpToolToggleRow({
  disabled,
  onChange,
  serverId,
  settings,
  tool,
}: {
  disabled: boolean;
  onChange(enabled: boolean): void;
  serverId: string;
  settings: ChatToolSettings;
  tool: McpToolCapability;
}) {
  const toolEnabled = !(settings.disabledMcpTools?.[serverId] ?? []).includes(tool.name);

  return (
    <div className="grid gap-3 rounded-sm border border-outline-variant bg-surface px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div className="min-w-0">
        <p className="truncate font-mono text-xs font-semibold text-on-surface">{tool.name}</p>
        {tool.description ? (
          <p className="mt-1 text-xs leading-5 text-on-surface-variant">
            {tool.description}
          </p>
        ) : null}
      </div>
      <SettingsSwitch
        checked={toolEnabled}
        disabled={disabled}
        label={`${tool.name} enabled`}
        onChange={onChange}
      />
    </div>
  );
}

function SettingsSwitch({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange(value: boolean): void;
}) {
  return (
    <label className="relative inline-flex h-7 w-12 shrink-0 items-center">
      <input
        aria-label={label}
        checked={checked}
        className="peer sr-only"
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span className="absolute inset-0 rounded-full border border-outline-variant bg-surface-container-low transition peer-checked:border-primary peer-checked:bg-primary peer-disabled:opacity-45" />
      <span className="absolute left-1 h-5 w-5 rounded-full bg-on-surface-variant transition peer-checked:translate-x-5 peer-checked:bg-on-primary peer-disabled:opacity-45" />
    </label>
  );
}

function enabledToolCount(
  settings: ChatToolSettings,
  servers: McpServerConnectionSummary[],
): number {
  return servers.reduce((total, server) => total + enabledServerToolCount(settings, server), 0);
}

function enabledServerToolCount(
  settings: ChatToolSettings,
  server: McpServerConnectionSummary,
): number {
  if ((settings.disabledMcpServerIds ?? []).includes(server.serverId)) {
    return 0;
  }

  const disabledTools = new Set(settings.disabledMcpTools?.[server.serverId] ?? []);

  return server.tools.filter((tool) => !disabledTools.has(tool.name)).length;
}
