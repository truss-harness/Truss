import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import type {
  CommandRunnerGuardAction,
  CommandRunnerSafetyLevel,
  CommandRunnerSettingsSummary,
  CommandRunnerWhitelistAddedBy,
  CommandRunnerWhitelistEntrySummary,
  CommandRunnerWhitelistEntryUpdate,
  CommandRunnerWhitelistExpiry,
  CommandRunnerWhitelistPatternType,
  FileAccessDirectorySummary,
  FileAccessDirectoryUpdate,
  FileAccessSecurityResponse,
  FileAccessWorkspaceTreeNode,
  FileAccessWorkspaceTreeResponse,
  McpDiscoverySummary,
} from "../../../shared/protocol.ts";
import {
  fetchFileAccessSettings,
  fetchFileAccessWorkspaceTree,
  reloadMcpServers,
  updateFileAccessSettings,
} from "../../api.ts";
import { MaterialIcon } from "../MaterialIcon.tsx";
import { Modal } from "../Modal.tsx";
import { errorMessage } from "./chat-utils.ts";

interface DirectoryGrantDraft {
  path: string;
  readOnly: boolean;
}

interface WorkspaceAccessTreeNodeState extends FileAccessWorkspaceTreeNode {
  childLimit: number;
  children: WorkspaceAccessTreeNodeState[];
  childrenLoaded: boolean;
  childrenTruncated: boolean;
  expanded: boolean;
  loadError: string | null;
  loading: boolean;
}

type SecurityTabId = "filesystem" | "command-runner";
type CommandWhitelistExpiryDraft = CommandRunnerWhitelistExpiry | "existing";

interface CommandWhitelistDraft {
  addedBy: CommandRunnerWhitelistAddedBy;
  expiresAt: string | null;
  expiryPreset: CommandWhitelistExpiryDraft;
  pattern: string;
  reason: string;
  type: CommandRunnerWhitelistPatternType;
}

const defaultCommandRunnerSettings: CommandRunnerSettingsSummary = {
  dangerousAction: "ask",
  guardModelId: null,
  guardProviderId: null,
  postExecutionGuardEnabled: true,
  preExecutionGuardEnabled: true,
  riskyAction: "ask",
  safeAction: "auto-allow",
};

const safetyLevels: CommandRunnerSafetyLevel[] = ["safe", "risky", "dangerous"];
const guardActions: CommandRunnerGuardAction[] = ["auto-allow", "ask", "auto-deny"];
const preExecutionGuardTooltip =
  "Checks the command, working directory, environment overrides, path access, and risky shell behavior before a process starts.";
const postExecutionGuardTooltip =
  "Checks stdout and stderr before output reaches the model, and blocks or redacts dangerous output such as secrets, private data, or prompt-injection text.";
const whitelistTypeTooltip =
  "Prefix matches the start of the command; glob matches the whole command with * and ?; regex uses JavaScript RegExp, so anchor with ^ and $ for exact matching.";
const whitelistPatternTooltip =
  "The shell command pattern to pre-approve. A match skips the pre-execution guard for that command, but does not grant new filesystem access or bypass output guarding.";
const whitelistExpiryTooltip =
  "How long the entry remains active. Expired entries are removed automatically and stop matching commands.";
const whitelistAddedByTooltip =
  "Tracks whether this was added directly by you or approved from an assistant request. LLM-requested entries require a reason.";
const whitelistReasonTooltip =
  "Why this pattern is safe enough to reuse. Required for assistant-requested entries and useful when reviewing the whitelist later.";

export function SecuritySettingsModal({
  onClose,
  onMcpReloaded,
  open,
}: {
  onClose(): void;
  onMcpReloaded?(mcp: McpDiscoverySummary): void;
  open: boolean;
}) {
  const [activeTab, setActiveTab] = useState<SecurityTabId>("filesystem");
  const [settings, setSettings] = useState<FileAccessSecurityResponse | null>(null);
  const [directories, setDirectories] = useState<DirectoryGrantDraft[]>([]);
  const [ignorePatternsText, setIgnorePatternsText] = useState("");
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceAccessTreeNodeState | null>(null);
  const [workspaceTreeError, setWorkspaceTreeError] = useState<string | null>(null);
  const [workspaceTreeLoading, setWorkspaceTreeLoading] = useState(false);
  const [commandRunner, setCommandRunner] = useState<CommandRunnerSettingsSummary>(
    defaultCommandRunnerSettings,
  );
  const [commandWhitelist, setCommandWhitelist] = useState<CommandWhitelistDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      setWorkspaceTree(null);
      setWorkspaceTreeError(null);

      try {
        const response = await fetchFileAccessSettings();

        if (cancelled) {
          return;
        }

        setSettings(response);
        setDirectories(directoryDraftsFromSettings(response.directories));
        setIgnorePatternsText(response.ignorePatterns.join("\n"));
        setCommandRunner(response.commandRunner.settings);
        setCommandWhitelist(whitelistDraftsFromSettings(response.commandRunner.whitelistEntries));
      } catch (caught) {
        if (!cancelled) {
          setError(errorMessage(caught));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const actionDisabled = loading || saving;

  async function save(): Promise<void> {
    if (actionDisabled) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await updateFileAccessSettings({
        commandRunner: {
          ...commandRunner,
          whitelistEntries: normalizedWhitelistDrafts(commandWhitelist),
        },
        directories: normalizedGrantDrafts(directories),
        ignorePatterns: normalizedLines(ignorePatternsText.split(/\r?\n/)),
      });
      const reload = await reloadMcpServers();

      setSettings(response);
      setDirectories(directoryDraftsFromSettings(response.directories));
      setIgnorePatternsText(response.ignorePatterns.join("\n"));
      setCommandRunner(response.commandRunner.settings);
      setCommandWhitelist(whitelistDraftsFromSettings(response.commandRunner.whitelistEntries));
      onMcpReloaded?.(reload.mcp);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  function patchDirectory(index: number, value: string): void {
    setDirectories((current) =>
      current.map((directory, currentIndex) =>
        currentIndex === index ? { ...directory, path: value } : directory,
      ),
    );
  }

  function patchDirectoryReadOnly(index: number, readOnly: boolean): void {
    setDirectories((current) =>
      current.map((directory, currentIndex) =>
        currentIndex === index ? { ...directory, readOnly } : directory,
      ),
    );
  }

  function removeDirectory(index: number): void {
    setDirectories((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  async function inspectWorkspaceAccess(): Promise<void> {
    if (actionDisabled || workspaceTreeLoading) {
      return;
    }

    setWorkspaceTreeLoading(true);
    setWorkspaceTreeError(null);

    try {
      const response = await fetchFileAccessWorkspaceTree();

      setWorkspaceTree(workspaceAccessTreeFromResponse(response));
    } catch (caught) {
      setWorkspaceTreeError(errorMessage(caught));
    } finally {
      setWorkspaceTreeLoading(false);
    }
  }

  async function toggleWorkspaceTreeNode(path: string): Promise<void> {
    if (!workspaceTree) {
      return;
    }

    const node = findWorkspaceTreeNode(workspaceTree, path);

    if (!node?.hasChildren) {
      return;
    }

    if (node.expanded) {
      setWorkspaceTree((current) =>
        current
          ? updateWorkspaceTreeNode(current, path, (item) => ({
              ...item,
              expanded: false,
            }))
          : current,
      );
      return;
    }

    setWorkspaceTree((current) =>
      current
        ? updateWorkspaceTreeNode(current, path, (item) => ({
            ...item,
            expanded: true,
          }))
        : current,
    );

    if (node.childrenLoaded || node.loading) {
      return;
    }

    setWorkspaceTree((current) =>
      current
        ? updateWorkspaceTreeNode(current, path, (item) => ({
            ...item,
            loadError: null,
            loading: true,
          }))
        : current,
    );

    try {
      const response = await fetchFileAccessWorkspaceTree(path);

      setWorkspaceTree((current) =>
        current
          ? updateWorkspaceTreeNode(current, path, (item) => ({
              ...item,
              childLimit: response.limit,
              children: workspaceAccessChildStates(response.children, response.limit),
              childrenLoaded: true,
              childrenTruncated: response.truncated,
              expanded: true,
              loadError: null,
              loading: false,
            }))
          : current,
      );
    } catch (caught) {
      setWorkspaceTree((current) =>
        current
          ? updateWorkspaceTreeNode(current, path, (item) => ({
              ...item,
              loadError: errorMessage(caught),
              loading: false,
            }))
          : current,
      );
    }
  }

  function patchCommandRunner(patch: Partial<CommandRunnerSettingsSummary>): void {
    setCommandRunner((current) => ({ ...current, ...patch }));
  }

  function patchWhitelist(index: number, patch: Partial<CommandWhitelistDraft>): void {
    setCommandWhitelist((current) =>
      current.map((entry, currentIndex) =>
        currentIndex === index ? { ...entry, ...patch } : entry,
      ),
    );
  }

  function removeWhitelist(index: number): void {
    setCommandWhitelist((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <Modal
      closeLabel="Close Security"
      description="Control filesystem access and Command Runner guard behavior."
      footer={
        <>
          <button
            className="h-10 rounded-sm border border-outline-variant px-4 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-45"
            disabled={actionDisabled}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-primary bg-primary px-4 text-sm font-semibold text-on-primary transition hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-45"
            disabled={actionDisabled}
            onClick={() => void save()}
            type="button"
          >
            <MaterialIcon name="save" size={18} />
            {saving ? "Saving..." : "Save and reload MCP"}
          </button>
        </>
      }
      icon="lock"
      onClose={actionDisabled ? () => undefined : onClose}
      open
      size="lg"
      title="Security"
    >
      <div className="grid gap-5">
        {loading ? (
          <div className="flex min-h-32 items-center justify-center text-sm text-on-surface-variant">
            Loading security settings...
          </div>
        ) : (
          <>
            <SecurityTabBar activeTab={activeTab} onChange={setActiveTab} />
            {activeTab === "filesystem" ? (
              <FilesystemSecurityPanel
                actionDisabled={actionDisabled}
                directories={directories}
                ignorePatternsText={ignorePatternsText}
                onAddDirectory={() =>
                  setDirectories((current) => [...current, { path: "", readOnly: false }])
                }
                onInspectWorkspaceAccess={() => void inspectWorkspaceAccess()}
                onPatchDirectory={patchDirectory}
                onPatchDirectoryReadOnly={patchDirectoryReadOnly}
                onRemoveDirectory={removeDirectory}
                onResetIgnorePatterns={() =>
                  setIgnorePatternsText(settings?.defaultIgnorePatterns.join("\n") ?? "")
                }
                onSetIgnorePatternsText={setIgnorePatternsText}
                onToggleWorkspaceTreeNode={(path) => void toggleWorkspaceTreeNode(path)}
                settings={settings}
                workspaceTree={workspaceTree}
                workspaceTreeError={workspaceTreeError}
                workspaceTreeLoading={workspaceTreeLoading}
              />
            ) : (
              <CommandRunnerSecurityPanel
                actionDisabled={actionDisabled}
                onAddWhitelist={() =>
                  setCommandWhitelist((current) => [
                    ...current,
                    {
                      addedBy: "user",
                      expiresAt: null,
                      expiryPreset: "permanent",
                      pattern: "",
                      reason: "",
                      type: "prefix",
                    },
                  ])
                }
                onPatchCommandRunner={patchCommandRunner}
                onPatchWhitelist={patchWhitelist}
                onRemoveWhitelist={removeWhitelist}
                settings={commandRunner}
                whitelist={commandWhitelist}
              />
            )}
          </>
        )}

        {error ? (
          <p className="rounded-sm border border-error-container bg-error-container/25 px-3 py-2 text-sm text-error">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function SecurityTabBar({
  activeTab,
  onChange,
}: {
  activeTab: SecurityTabId;
  onChange(tab: SecurityTabId): void;
}) {
  const tabs: Array<{ icon: string; id: SecurityTabId; label: string }> = [
    { icon: "folder_managed", id: "filesystem", label: "Filesystem" },
    { icon: "terminal", id: "command-runner", label: "Command Runner" },
  ];

  return (
    <div
      aria-label="Security sections"
      className="flex gap-2 overflow-x-auto border-b border-outline-variant pb-2"
      role="tablist"
    >
      {tabs.map((tab) => (
        <button
          aria-selected={activeTab === tab.id}
          className={[
            "inline-flex h-9 shrink-0 items-center gap-2 rounded-sm border px-3 text-sm font-semibold transition focus:border-outline focus:outline-none",
            activeTab === tab.id
              ? "border-primary bg-primary text-on-primary"
              : "border-outline-variant bg-surface text-on-surface-variant hover:bg-surface-container hover:text-primary",
          ].join(" ")}
          key={tab.id}
          onClick={() => onChange(tab.id)}
          role="tab"
          type="button"
        >
          <MaterialIcon name={tab.icon} size={17} />
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function FilesystemSecurityPanel({
  actionDisabled,
  directories,
  ignorePatternsText,
  onAddDirectory,
  onInspectWorkspaceAccess,
  onPatchDirectory,
  onPatchDirectoryReadOnly,
  onRemoveDirectory,
  onResetIgnorePatterns,
  onSetIgnorePatternsText,
  onToggleWorkspaceTreeNode,
  settings,
  workspaceTree,
  workspaceTreeError,
  workspaceTreeLoading,
}: {
  actionDisabled: boolean;
  directories: DirectoryGrantDraft[];
  ignorePatternsText: string;
  onAddDirectory(): void;
  onInspectWorkspaceAccess(): void;
  onPatchDirectory(index: number, value: string): void;
  onPatchDirectoryReadOnly(index: number, readOnly: boolean): void;
  onRemoveDirectory(index: number): void;
  onResetIgnorePatterns(): void;
  onSetIgnorePatternsText(value: string): void;
  onToggleWorkspaceTreeNode(path: string): void;
  settings: FileAccessSecurityResponse | null;
  workspaceTree: WorkspaceAccessTreeNodeState | null;
  workspaceTreeError: string | null;
  workspaceTreeLoading: boolean;
}) {
  return (
    <>
      <section className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-on-surface">Workspace directory</h3>
          <button
            className="inline-flex h-8 items-center justify-center gap-1 rounded-sm border border-outline-variant px-2 text-xs font-semibold text-on-surface-variant transition hover:bg-surface-container hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
            disabled={actionDisabled || workspaceTreeLoading || !settings?.workspaceDirectory}
            onClick={onInspectWorkspaceAccess}
            type="button"
          >
            <MaterialIcon name="account_tree" size={15} />
            Inspect workspace access
          </button>
        </div>
        {settings?.workspaceDirectory ? (
          <DirectoryStatusRow directory={settings.workspaceDirectory} />
        ) : (
          <p className="rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface-variant">
            No workspace directory is automatically granted in global mode.
          </p>
        )}
        {workspaceTreeError ? (
          <p className="rounded-sm border border-error-container bg-error-container/20 px-3 py-2 text-xs text-error">
            {workspaceTreeError}
          </p>
        ) : null}
        {workspaceTree ? (
          <WorkspaceAccessTree
            loading={workspaceTreeLoading}
            onToggle={onToggleWorkspaceTreeNode}
            root={workspaceTree}
          />
        ) : workspaceTreeLoading ? (
          <p className="rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-3 text-sm text-on-surface-variant">
            Inspecting workspace access...
          </p>
        ) : null}
      </section>

      <section className="grid gap-3">
        <div>
          <h3 className="text-sm font-semibold text-on-surface">Granted directories</h3>
          <p className="mt-1 text-xs leading-5 text-on-surface-variant">
            These directories apply only to{" "}
            <span className="font-semibold text-on-surface">
              {settings?.activeScope.mode === "workspace"
                ? settings.activeScope.workspacePath
                : "Global"}
            </span>{" "}
            after MCP reloads and expire automatically after 24 hours.
          </p>
        </div>
        <div className="grid gap-2">
          {directories.map((directory, index) => {
            const savedDirectory = settings?.directories.find((item) =>
              samePath(item.path, directory.path),
            );

            return (
              <div
                className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                key={index}
              >
                <div className="grid min-w-0 gap-1">
                  <input
                    className="h-10 min-w-0 rounded-sm border border-outline-variant bg-surface px-3 text-sm text-on-surface outline-none transition placeholder:text-on-surface-variant/55 focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={actionDisabled}
                    onChange={(event) => onPatchDirectory(index, event.target.value)}
                    placeholder={"C:\\path\\to\\directory"}
                    value={directory.path}
                  />
                  {savedDirectory?.expiresAt ? (
                    <span className="inline-flex min-w-0 items-center gap-1 text-xs font-medium text-on-surface-variant">
                      <MaterialIcon name="schedule" size={14} />
                      Expires {formatDateTime(savedDirectory.expiresAt)}
                    </span>
                  ) : null}
                </div>
                <label
                  className={[
                    "inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-outline-variant px-3 text-xs font-semibold text-on-surface-variant transition",
                    actionDisabled
                      ? "cursor-not-allowed opacity-45"
                      : "hover:bg-surface-container hover:text-primary",
                  ].join(" ")}
                >
                  <input
                    checked={directory.readOnly}
                    className="sr-only"
                    disabled={actionDisabled}
                    onChange={(event) =>
                      onPatchDirectoryReadOnly(index, event.target.checked)
                    }
                    type="checkbox"
                  />
                  <MaterialIcon name={directory.readOnly ? "visibility" : "edit"} size={16} />
                  {directory.readOnly ? "Read-only" : "Read/write"}
                </label>
                <button
                  aria-label="Remove directory"
                  className="grid h-10 w-10 place-items-center rounded-sm border border-outline-variant text-on-surface-variant transition hover:bg-surface-container hover:text-error disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={actionDisabled}
                  onClick={() => onRemoveDirectory(index)}
                  title="Remove directory"
                  type="button"
                >
                  <MaterialIcon name="delete" size={18} />
                </button>
              </div>
            );
          })}
          <button
            className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-sm border border-outline-variant px-3 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
            disabled={actionDisabled}
            onClick={onAddDirectory}
            type="button"
          >
            <MaterialIcon name="add" size={18} />
            Add directory
          </button>
        </div>
      </section>

      <section className="grid gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-on-surface">Ignored file patterns</h3>
            <p className="mt-1 text-xs leading-5 text-on-surface-variant">
              Patterns use gitignore/.aiignore-style matching. Empty uses Truss defaults
              for common secret files.
            </p>
          </div>
          <button
            className="inline-flex h-8 items-center justify-center gap-1 rounded-sm border border-outline-variant px-2 text-xs font-semibold text-on-surface-variant transition hover:bg-surface-container hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
            disabled={actionDisabled || !settings}
            onClick={onResetIgnorePatterns}
            type="button"
          >
            <MaterialIcon name="restart_alt" size={15} />
            Defaults
          </button>
        </div>
        <textarea
          className="min-h-44 min-w-0 resize-y rounded-sm border border-outline-variant bg-surface px-3 py-2 font-mono text-xs leading-5 text-on-surface outline-none transition placeholder:text-on-surface-variant/55 focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
          disabled={actionDisabled}
          onChange={(event) => onSetIgnorePatternsText(event.target.value)}
          spellCheck={false}
          value={ignorePatternsText}
        />
        {settings?.usingDefaultIgnorePatterns ? (
          <p className="text-xs leading-5 text-on-surface-variant">
            Truss is using the default secret-file patterns because no custom list is saved.
          </p>
        ) : null}
      </section>
    </>
  );
}

function WorkspaceAccessTree({
  loading,
  onToggle,
  root,
}: {
  loading: boolean;
  onToggle(path: string): void;
  root: WorkspaceAccessTreeNodeState;
}) {
  return (
    <div className="max-h-96 overflow-auto rounded-sm border border-outline-variant bg-surface-container-lowest py-2">
      <WorkspaceAccessTreeNodeRow level={0} node={root} onToggle={onToggle} />
      {loading ? (
        <p className="px-3 py-2 text-xs text-on-surface-variant">Refreshing workspace access...</p>
      ) : null}
    </div>
  );
}

function WorkspaceAccessTreeNodeRow({
  level,
  node,
  onToggle,
}: {
  level: number;
  node: WorkspaceAccessTreeNodeState;
  onToggle(path: string): void;
}) {
  const canExpand = node.hasChildren;
  const paddingLeft = `${0.75 + level * 1.1}rem`;

  return (
    <div>
      <div
        className="grid min-h-8 grid-cols-[1.5rem_1.35rem_minmax(0,1fr)_auto] items-center gap-1 px-2 text-sm text-on-surface hover:bg-surface-container"
        style={{ paddingLeft }}
      >
        {canExpand ? (
          <button
            aria-label={node.expanded ? "Collapse directory" : "Expand directory"}
            className="grid h-6 w-6 place-items-center rounded-sm text-on-surface-variant transition hover:bg-surface-container-high hover:text-primary"
            onClick={() => onToggle(node.path)}
            type="button"
          >
            <MaterialIcon
              className={node.loading ? "animate-spin" : undefined}
              name={
                node.loading
                  ? "progress_activity"
                  : node.expanded
                    ? "expand_more"
                    : "chevron_right"
              }
              size={17}
            />
          </button>
        ) : (
          <span />
        )}
        <MaterialIcon
          className="text-on-surface-variant"
          name={workspaceTreeTypeIcon(node.type)}
          size={16}
        />
        <span className="min-w-0">
          <span className="block truncate font-medium">{node.name}</span>
          {node.relativePath !== "." ? (
            <span className="block truncate font-mono text-[0.68rem] leading-4 text-on-surface-variant">
              {node.relativePath}
            </span>
          ) : null}
        </span>
        <WorkspaceAccessRuleIndicator node={node} />
      </div>
      {node.error ? (
        <p
          className="px-3 pb-1 text-xs text-error"
          style={{ paddingLeft: `${2.35 + level * 1.1}rem` }}
        >
          {node.error}
        </p>
      ) : null}
      {node.expanded ? (
        <div>
          {node.children.map((child) => (
            <WorkspaceAccessTreeNodeRow
              key={child.path}
              level={level + 1}
              node={child}
              onToggle={onToggle}
            />
          ))}
          {node.loading ? (
            <p
              className="py-1 text-xs text-on-surface-variant"
              style={{ paddingLeft: `${2.35 + level * 1.1}rem` }}
            >
              Loading...
            </p>
          ) : null}
          {node.loadError ? (
            <p
              className="py-1 text-xs text-error"
              style={{ paddingLeft: `${2.35 + level * 1.1}rem` }}
            >
              {node.loadError}
            </p>
          ) : null}
          {node.childrenLoaded &&
          node.children.length === 0 &&
          !node.loading &&
          !node.loadError ? (
            <p
              className="py-1 text-xs text-on-surface-variant"
              style={{ paddingLeft: `${2.35 + level * 1.1}rem` }}
            >
              Empty directory
            </p>
          ) : null}
          {node.childrenTruncated ? (
            <p
              className="py-1 text-xs text-on-surface-variant"
              style={{ paddingLeft: `${2.35 + level * 1.1}rem` }}
            >
              Showing first {node.childLimit.toLocaleString()} entries.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceAccessRuleIndicator({ node }: { node: WorkspaceAccessTreeNodeState }) {
  const tooltipId = useId();
  const label = workspaceTreeAccessLabel(node.access);

  return (
    <span
      aria-describedby={tooltipId}
      className={[
        "group/access-rule relative inline-grid h-7 w-7 place-items-center rounded-sm border text-xs transition focus:outline-none focus:ring-1 focus:ring-primary",
        node.access === "deny"
          ? "border-error-container bg-error-container/25 text-error"
          : node.access === "read-only"
            ? "border-outline-variant bg-secondary-container/35 text-secondary"
            : "border-primary-container bg-primary-container/30 text-primary",
      ].join(" ")}
      tabIndex={0}
      title={`${label}: ${node.rule}`}
    >
      <MaterialIcon name={workspaceTreeAccessIcon(node.access)} size={15} />
      <span className="sr-only">{label}</span>
      <span
        className="pointer-events-none absolute right-0 top-[calc(100%+0.4rem)] z-[140] grid w-72 translate-y-[-0.25rem] gap-1 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-left text-xs leading-5 text-on-surface-variant opacity-0 shadow-panel transition group-hover/access-rule:translate-y-0 group-hover/access-rule:opacity-100 group-focus/access-rule:translate-y-0 group-focus/access-rule:opacity-100"
        id={tooltipId}
        role="tooltip"
      >
        <span className="font-semibold text-on-surface">{label}</span>
        <span>{node.rule}</span>
      </span>
    </span>
  );
}

function CommandRunnerSecurityPanel({
  actionDisabled,
  onAddWhitelist,
  onPatchCommandRunner,
  onPatchWhitelist,
  onRemoveWhitelist,
  settings,
  whitelist,
}: {
  actionDisabled: boolean;
  onAddWhitelist(): void;
  onPatchCommandRunner(patch: Partial<CommandRunnerSettingsSummary>): void;
  onPatchWhitelist(index: number, patch: Partial<CommandWhitelistDraft>): void;
  onRemoveWhitelist(index: number): void;
  settings: CommandRunnerSettingsSummary;
  whitelist: CommandWhitelistDraft[];
}) {
  return (
    <div className="grid gap-5">
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold text-on-surface">Guard toggles</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <CommandRunnerSwitchCard
            checked={settings.preExecutionGuardEnabled}
            disabled={actionDisabled}
            icon="policy"
            label="Pre-execution guard"
            onChange={(value) => onPatchCommandRunner({ preExecutionGuardEnabled: value })}
            tooltip={preExecutionGuardTooltip}
          />
          <CommandRunnerSwitchCard
            checked={settings.postExecutionGuardEnabled}
            disabled={actionDisabled}
            icon="shield"
            label="Post-execution output guard"
            onChange={(value) => onPatchCommandRunner({ postExecutionGuardEnabled: value })}
            tooltip={postExecutionGuardTooltip}
          />
        </div>
      </section>

      <section className="grid gap-3">
        <div>
          <h3 className="text-sm font-semibold text-on-surface">
            Auto-action by danger level
          </h3>
          <p className="mt-1 text-xs leading-5 text-on-surface-variant">
            Recommended preset: safe auto-allows, risky asks, dangerous asks.
          </p>
        </div>
        <div className="grid gap-2">
          {safetyLevels.map((level) => (
            <GuardActionRow
              action={settings[`${level}Action`]}
              disabled={actionDisabled}
              key={level}
              level={level}
              onChange={(action) => onPatchCommandRunner(guardActionPatch(level, action))}
            />
          ))}
        </div>
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-on-surface">Command whitelist</h3>
            <p className="mt-1 text-xs leading-5 text-on-surface-variant">
              Matching entries skip the pre-execution guard for the raw shell command.
              They do not add filesystem access or bypass the post-execution output guard.
              Prefix matches the start, glob matches the whole command, and regex uses
              JavaScript RegExp.
            </p>
          </div>
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-sm border border-outline-variant px-3 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
            disabled={actionDisabled}
            onClick={onAddWhitelist}
            type="button"
          >
            <MaterialIcon name="add" size={17} />
            Add pattern
          </button>
        </div>
        <div className="grid gap-3">
          {whitelist.length === 0 ? (
            <p className="rounded-sm border border-outline-variant bg-surface px-3 py-3 text-sm text-on-surface-variant">
              No command patterns are pre-approved.
            </p>
          ) : (
            whitelist.map((entry, index) => (
              <WhitelistEntryEditor
                actionDisabled={actionDisabled}
                entry={entry}
                index={index}
                key={index}
                onPatch={onPatchWhitelist}
                onRemove={onRemoveWhitelist}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function CommandRunnerSwitchCard({
  checked,
  disabled,
  icon,
  label,
  onChange,
  tooltip,
}: {
  checked: boolean;
  disabled: boolean;
  icon: string;
  label: string;
  onChange(value: boolean): void;
  tooltip: string;
}) {
  const tooltipId = useId();

  return (
    <label
      aria-describedby={tooltipId}
      className={[
        "group/guard-switch relative flex items-center justify-between gap-3 rounded-sm border border-outline-variant bg-surface px-3 py-3",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-surface-container",
      ].join(" ")}
      title={tooltip}
    >
      <span className="flex min-w-0 items-center gap-2">
        <MaterialIcon className="text-primary" name={icon} size={18} />
        <span className="text-sm font-semibold text-on-surface">{label}</span>
      </span>
      <input
        checked={checked}
        className="h-4 w-4 accent-primary"
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span
        className="pointer-events-none absolute left-3 top-[calc(100%+0.45rem)] z-[120] max-w-80 translate-y-[-0.25rem] rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-xs leading-5 text-on-surface-variant opacity-0 shadow-panel transition group-hover/guard-switch:translate-y-0 group-hover/guard-switch:opacity-100 group-focus-within/guard-switch:translate-y-0 group-focus-within/guard-switch:opacity-100"
        id={tooltipId}
        role="tooltip"
      >
        {tooltip}
      </span>
    </label>
  );
}

function GuardActionRow({
  action,
  disabled,
  level,
  onChange,
}: {
  action: CommandRunnerGuardAction;
  disabled: boolean;
  level: CommandRunnerSafetyLevel;
  onChange(action: CommandRunnerGuardAction): void;
}) {
  return (
    <div className="grid gap-2 rounded-sm border border-outline-variant bg-surface px-3 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center">
      <span className="text-sm font-semibold capitalize text-on-surface">{level}</span>
      <div className="inline-flex w-fit rounded-sm border border-outline-variant bg-surface-container-low p-1">
        {guardActions.map((candidate) => (
          <button
            aria-pressed={action === candidate}
            className={[
              "h-8 rounded-sm px-3 text-xs font-semibold uppercase transition focus:border-outline focus:outline-none disabled:cursor-not-allowed disabled:opacity-45",
              action === candidate
                ? "bg-primary text-on-primary"
                : "text-on-surface-variant hover:bg-surface-container hover:text-primary",
            ].join(" ")}
            disabled={disabled}
            key={candidate}
            onClick={() => onChange(candidate)}
            type="button"
          >
            {guardActionLabel(candidate)}
          </button>
        ))}
      </div>
    </div>
  );
}

function WhitelistEntryEditor({
  actionDisabled,
  entry,
  index,
  onPatch,
  onRemove,
}: {
  actionDisabled: boolean;
  entry: CommandWhitelistDraft;
  index: number;
  onPatch(index: number, patch: Partial<CommandWhitelistDraft>): void;
  onRemove(index: number): void;
}) {
  return (
    <div className="grid gap-3 rounded-sm border border-outline-variant bg-surface px-3 py-3">
      <div className="grid gap-2 lg:grid-cols-[8rem_minmax(0,1fr)_9rem_9rem_auto]">
        <WhitelistFieldTooltip tooltip={whitelistTypeTooltip}>
          <select
            className="h-10 w-full rounded-sm border border-outline-variant bg-surface-container-low px-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
            disabled={actionDisabled}
            onChange={(event) =>
              onPatch(index, {
                type: event.target.value as CommandRunnerWhitelistPatternType,
              })
            }
            title={whitelistTypeTooltip}
            value={entry.type}
          >
            <option value="prefix">Prefix</option>
            <option value="glob">Glob</option>
            <option value="regex">Regex</option>
          </select>
        </WhitelistFieldTooltip>
        <WhitelistFieldTooltip tooltip={whitelistPatternTooltip}>
          <input
            className="h-10 w-full min-w-0 rounded-sm border border-outline-variant bg-surface-container-low px-3 font-mono text-sm text-on-surface outline-none transition placeholder:text-on-surface-variant/55 focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
            disabled={actionDisabled}
            onChange={(event) => onPatch(index, { pattern: event.target.value })}
            placeholder={
              entry.type === "prefix"
                ? "git "
                : entry.type === "glob"
                  ? "npm run *"
                  : "^ls\\s"
            }
            title={whitelistPatternTooltip}
            value={entry.pattern}
          />
        </WhitelistFieldTooltip>
        <WhitelistFieldTooltip tooltip={whitelistExpiryTooltip}>
          <select
            className="h-10 w-full rounded-sm border border-outline-variant bg-surface-container-low px-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
            disabled={actionDisabled}
            onChange={(event) =>
              onPatch(index, {
                expiryPreset: event.target.value as CommandWhitelistExpiryDraft,
              })
            }
            title={whitelistExpiryTooltip}
            value={entry.expiryPreset}
          >
            {entry.expiryPreset === "existing" ? <option value="existing">Existing</option> : null}
            <option value="permanent">Permanent</option>
            <option value="24-hours">24 hours</option>
            <option value="1-month">1 month</option>
          </select>
        </WhitelistFieldTooltip>
        <WhitelistFieldTooltip tooltip={whitelistAddedByTooltip}>
          <select
            className="h-10 w-full rounded-sm border border-outline-variant bg-surface-container-low px-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
            disabled={actionDisabled}
            onChange={(event) =>
              onPatch(index, {
                addedBy: event.target.value as CommandRunnerWhitelistAddedBy,
              })
            }
            title={whitelistAddedByTooltip}
            value={entry.addedBy}
          >
            <option value="user">User</option>
            <option value="llm-request">LLM request</option>
          </select>
        </WhitelistFieldTooltip>
        <button
          aria-label="Remove whitelist entry"
          className="grid h-10 w-10 place-items-center rounded-sm border border-outline-variant text-on-surface-variant transition hover:bg-surface-container hover:text-error disabled:cursor-not-allowed disabled:opacity-45"
          disabled={actionDisabled}
          onClick={() => onRemove(index)}
          title="Remove whitelist entry"
          type="button"
        >
          <MaterialIcon name="delete" size={18} />
        </button>
      </div>
      <WhitelistFieldTooltip tooltip={whitelistReasonTooltip}>
        <input
          className="h-10 w-full min-w-0 rounded-sm border border-outline-variant bg-surface-container-low px-3 text-sm text-on-surface outline-none transition placeholder:text-on-surface-variant/55 focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
          disabled={actionDisabled}
          onChange={(event) => onPatch(index, { reason: event.target.value })}
          placeholder={entry.addedBy === "llm-request" ? "Required reason" : "Reason"}
          title={whitelistReasonTooltip}
          value={entry.reason}
        />
      </WhitelistFieldTooltip>
      {entry.expiresAt && entry.expiryPreset === "existing" ? (
        <span className="inline-flex min-w-0 items-center gap-1 text-xs font-medium text-on-surface-variant">
          <MaterialIcon name="schedule" size={14} />
          Expires {formatDateTime(entry.expiresAt)}
        </span>
      ) : null}
    </div>
  );
}

function WhitelistFieldTooltip({
  children,
  tooltip,
}: {
  children: ReactNode;
  tooltip: string;
}) {
  return (
    <span className="group/whitelist-field relative block min-w-0" title={tooltip}>
      {children}
      <span
        className="pointer-events-none absolute left-0 top-[calc(100%+0.45rem)] z-[120] w-72 max-w-[calc(100vw-3rem)] translate-y-[-0.25rem] rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-xs leading-5 text-on-surface-variant opacity-0 shadow-panel transition group-hover/whitelist-field:translate-y-0 group-hover/whitelist-field:opacity-100 group-focus-within/whitelist-field:translate-y-0 group-focus-within/whitelist-field:opacity-100"
        role="tooltip"
      >
        {tooltip}
      </span>
    </span>
  );
}

function DirectoryStatusRow({ directory }: { directory: FileAccessDirectorySummary }) {
  return (
    <div
      className={[
        "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-sm border px-3 py-2 text-sm",
        directory.exists
          ? "border-outline-variant bg-surface-container-lowest text-on-surface"
          : "border-error-container bg-error-container/20 text-error",
      ].join(" ")}
    >
      <MaterialIcon
        className={directory.exists ? "text-primary" : "text-error"}
        name={directory.exists ? "folder" : "warning"}
        size={18}
      />
      <span className="grid min-w-0 gap-1">
        <span className="min-w-0 break-words font-mono text-xs [overflow-wrap:anywhere]">
          {directory.path}
        </span>
        <span className="flex flex-wrap gap-2 text-xs text-on-surface-variant">
          <span>
            {directory.source === "workspace"
              ? "Workspace root"
              : directory.scope === "workspace"
                ? `Workspace grant: ${directory.workspacePath ?? ""}`
                : "Global grant"}
          </span>
          <span className="font-semibold text-on-surface">
            {directory.readOnly ? "Read-only" : "Read/write"}
          </span>
        </span>
        {directory.error ? <span className="text-xs">{directory.error}</span> : null}
      </span>
    </div>
  );
}

function normalizedLines(lines: string[]): string[] {
  return lines.map((line) => line.trim()).filter(Boolean);
}

function directoryDraftsFromSettings(
  directories: FileAccessDirectorySummary[],
): DirectoryGrantDraft[] {
  return directories.map((directory) => ({
    path: directory.path,
    readOnly: directory.readOnly,
  }));
}

function normalizedGrantDrafts(directories: DirectoryGrantDraft[]): FileAccessDirectoryUpdate[] {
  return directories
    .map((directory) => ({
      path: directory.path.trim(),
      readOnly: directory.readOnly,
    }))
    .filter((directory) => Boolean(directory.path));
}

function workspaceAccessTreeFromResponse(
  response: FileAccessWorkspaceTreeResponse,
): WorkspaceAccessTreeNodeState {
  return {
    ...response.directory,
    childLimit: response.limit,
    children: workspaceAccessChildStates(response.children, response.limit),
    childrenLoaded: true,
    childrenTruncated: response.truncated,
    expanded: true,
    loadError: null,
    loading: false,
  };
}

function workspaceAccessChildStates(
  children: FileAccessWorkspaceTreeNode[],
  childLimit: number,
): WorkspaceAccessTreeNodeState[] {
  return children.map((child) => ({
    ...child,
    childLimit,
    children: [],
    childrenLoaded: false,
    childrenTruncated: false,
    expanded: false,
    loadError: null,
    loading: false,
  }));
}

function findWorkspaceTreeNode(
  node: WorkspaceAccessTreeNodeState,
  path: string,
): WorkspaceAccessTreeNodeState | null {
  if (samePath(node.path, path)) {
    return node;
  }

  for (const child of node.children) {
    const match = findWorkspaceTreeNode(child, path);

    if (match) {
      return match;
    }
  }

  return null;
}

function updateWorkspaceTreeNode(
  node: WorkspaceAccessTreeNodeState,
  path: string,
  update: (node: WorkspaceAccessTreeNodeState) => WorkspaceAccessTreeNodeState,
): WorkspaceAccessTreeNodeState {
  if (samePath(node.path, path)) {
    return update(node);
  }

  return {
    ...node,
    children: node.children.map((child) => updateWorkspaceTreeNode(child, path, update)),
  };
}

function workspaceTreeAccessIcon(
  access: WorkspaceAccessTreeNodeState["access"],
): string {
  switch (access) {
    case "deny":
      return "block";
    case "read-only":
      return "visibility";
    case "read-write":
      return "edit";
  }
}

function workspaceTreeAccessLabel(
  access: WorkspaceAccessTreeNodeState["access"],
): string {
  switch (access) {
    case "deny":
      return "Deny";
    case "read-only":
      return "Read-only";
    case "read-write":
      return "Read-write access";
  }
}

function workspaceTreeTypeIcon(type: WorkspaceAccessTreeNodeState["type"]): string {
  switch (type) {
    case "directory":
      return "folder";
    case "file":
      return "draft";
    case "symlink":
      return "shortcut";
    case "other":
      return "insert_drive_file";
  }
}

function whitelistDraftsFromSettings(
  entries: CommandRunnerWhitelistEntrySummary[],
): CommandWhitelistDraft[] {
  return entries.map((entry) => ({
    addedBy: entry.addedBy,
    expiresAt: entry.expiresAt,
    expiryPreset: entry.expiresAt ? "existing" : "permanent",
    pattern: entry.pattern,
    reason: entry.reason ?? "",
    type: entry.type,
  }));
}

function normalizedWhitelistDrafts(
  entries: CommandWhitelistDraft[],
): CommandRunnerWhitelistEntryUpdate[] {
  return entries
    .map((entry) => ({
      addedBy: entry.addedBy,
      expiresAt: expiresAtForDraft(entry),
      pattern: entry.pattern.trim(),
      reason: entry.reason.trim() || null,
      type: entry.type,
    }))
    .filter((entry) => Boolean(entry.pattern));
}

function expiresAtForDraft(entry: CommandWhitelistDraft): string | null {
  if (entry.expiryPreset === "existing") {
    return entry.expiresAt;
  }

  if (entry.expiryPreset === "permanent") {
    return null;
  }

  const expires = new Date();

  if (entry.expiryPreset === "24-hours") {
    expires.setHours(expires.getHours() + 24);
  } else {
    expires.setMonth(expires.getMonth() + 1);
  }

  return expires.toISOString();
}

function samePath(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  return left.replace(/\\/g, "/").toLowerCase() === right.replace(/\\/g, "/").toLowerCase();
}

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function guardActionLabel(action: CommandRunnerGuardAction): string {
  switch (action) {
    case "auto-allow":
      return "Auto-allow";
    case "auto-deny":
      return "Auto-deny";
    case "ask":
      return "Ask";
  }
}

function guardActionPatch(
  level: CommandRunnerSafetyLevel,
  action: CommandRunnerGuardAction,
): Partial<CommandRunnerSettingsSummary> {
  switch (level) {
    case "safe":
      return { safeAction: action };
    case "risky":
      return { riskyAction: action };
    case "dangerous":
      return { dangerousAction: action };
  }
}
