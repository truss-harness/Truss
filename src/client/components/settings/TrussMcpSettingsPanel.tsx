import { useEffect, useRef, useState } from "react";
import type {
  FileAccessDirectorySummary,
  FileAccessSecurityResponse,
  LlmModelProfileSummary,
} from "../../../shared/protocol.ts";
import { highlightCode } from "../../markdown.tsx";
import { formatHumanReadableModelName } from "../chat/chat-utils.ts";
import { MaterialIcon } from "../MaterialIcon.tsx";
import { Modal } from "../Modal.tsx";
import { ModelSelector, type ModelSelectorOption } from "../ModelSelector.tsx";
import {
  commandRunnerSelectedModel,
  sanitizerSelectedModel,
} from "./model-options.ts";
import {
  fileAccessDirectoryScopeLabel,
  fileAccessGrantSourceLabel,
  fileAccessScopeLabel,
  formatDateTime,
} from "./McpConfigUtils.ts";
import {
  PrimaryButton,
  SecondaryButton,
  SettingsAlert,
  SettingsSwitch,
  SettingsTextInput,
} from "./SettingsControls.tsx";
import type { TrussMcpDraft } from "./types.ts";

const trussFirstPartyMcpSetupSnippet = `{
  "mcpServers": {
    "truss-web-tools": {
      "command": "truss",
      "args": ["mcp-server", "truss-web-tools"]
    },
    "truss-playwright-mcp": {
      "command": "truss",
      "args": ["mcp-server", "truss-playwright-mcp"]
    },
    "truss-chat-tools": {
      "command": "truss",
      "args": ["mcp-server", "truss-chat-tools"]
    },
    "truss-filesystem-tools": {
      "command": "truss",
      "args": ["mcp-server", "truss-filesystem-tools", "--workspace-path", "C:/path/to/workspace"]
    },
    "truss-orchestration-tools": {
      "command": "truss",
      "args": ["mcp-server", "truss-orchestration-tools"]
    }
  }
}`;


export function TrussMcpSettingsPanel({
  draft,
  fastHelperProfile,
  fileAccess,
  fileAccessError,
  fileAccessLoading,
  loadingModels,
  modelOptions,
  onDraftChange,
  onRefreshFileAccess,
  onGrantDirectory,
  onRevokeAllFileAccessGrants,
  onRevokeFileAccessGrant,
  onSave,
  revokingFileAccessGrantId,
}: {
  draft: TrussMcpDraft;
  fastHelperProfile: LlmModelProfileSummary | null;
  fileAccess: FileAccessSecurityResponse | null;
  fileAccessError: string | null;
  fileAccessLoading: boolean;
  loadingModels: boolean;
  modelOptions: ModelSelectorOption[];
  onDraftChange(patch: Partial<TrussMcpDraft>): void;
  onRefreshFileAccess(): void;
  onGrantDirectory(scope: "global" | "workspace", readOnly?: boolean, directoryPath?: string): void;
  onRevokeAllFileAccessGrants(): void;
  onRevokeFileAccessGrant(directory: FileAccessDirectorySummary): void;
  onSave(): void;
  revokingFileAccessGrantId: number | null;
}) {
  const [setupInstructionsOpen, setSetupInstructionsOpen] = useState(false);
  const [useCustomModel, setUseCustomModel] = useState(
    Boolean(draft.sanitizerProviderId && draft.sanitizerModelId),
  );
  const [useCustomCommandGuardModel, setUseCustomCommandGuardModel] = useState(
    Boolean(draft.commandRunner.guardProviderId && draft.commandRunner.guardModelId),
  );
  const selectedModel = sanitizerSelectedModel(draft);
  const selectedModelKey = selectedModel
    ? `${selectedModel.providerId}:${selectedModel.modelId}`
    : null;
  const selectedCommandGuardModel = commandRunnerSelectedModel(draft.commandRunner);
  const selectedCommandGuardModelKey = selectedCommandGuardModel
    ? `${selectedCommandGuardModel.providerId}:${selectedCommandGuardModel.modelId}`
    : null;
  const saveDisabled =
    draft.saving ||
    (useCustomModel && !selectedModel) ||
    (useCustomCommandGuardModel && !selectedCommandGuardModel);

  useEffect(() => {
    if (selectedModelKey) {
      setUseCustomModel(true);
    }
  }, [selectedModelKey]);

  useEffect(() => {
    if (selectedCommandGuardModelKey) {
      setUseCustomCommandGuardModel(true);
    }
  }, [selectedCommandGuardModelKey]);

  function selectSanitizerMode(custom: boolean): void {
    setUseCustomModel(custom);

    if (!custom) {
      onDraftChange({
        sanitizerModelId: null,
        sanitizerProviderId: null,
      });
      return;
    }
  }

  function selectCommandGuardMode(custom: boolean): void {
    setUseCustomCommandGuardModel(custom);

    if (!custom) {
      onDraftChange({
        commandRunner: {
          ...draft.commandRunner,
          guardModelId: null,
          guardProviderId: null,
        },
      });
    }
  }

  return (
    <div className="grid max-w-[840px] gap-4">
      <div className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4 shadow-[0_12px_34px_rgb(27_28_25/0.06)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-primary">
              <MaterialIcon name="info" size={20} />
              <h3 className="text-base font-semibold text-on-surface">
                Truss first-party MCP tools are available locally
              </h3>
            </div>
            <p className="mt-3 text-sm leading-6 text-on-surface-variant">
              Other software applications can connect to bundled Truss MCP
              servers over stdio to use web tools, scoped conversation
              search, workspace-scoped filesystem tools, MCP config editing,
              and documentation resources.
            </p>
          </div>
          <button
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-sm border border-primary bg-primary px-4 text-sm font-semibold text-on-primary transition hover:bg-primary-container hover:text-on-primary-container focus:border-outline focus:outline-none"
            onClick={() => setSetupInstructionsOpen(true)}
            type="button"
          >
            <MaterialIcon name="article" size={18} />
            Setup Instructions
          </button>
        </div>
      </div>

      <FileAccessGrantsCard
        error={fileAccessError}
        fileAccess={fileAccess}
        loading={fileAccessLoading}
        onRefresh={onRefreshFileAccess}
        onGrant={onGrantDirectory}
        onRevokeAll={onRevokeAllFileAccessGrants}
        onRevoke={onRevokeFileAccessGrant}
        revokingAll={revokingFileAccessGrantId === -1}
        revokingGrantId={revokingFileAccessGrantId}
      />

      <article className="grid gap-4 rounded-sm border border-outline-variant bg-surface-container-lowest p-4 shadow-[0_12px_34px_rgb(27_28_25/0.06)]">
        <div>
          <h3 className="text-lg font-semibold text-on-surface">
            Playwright Browser MCP
          </h3>
          <p className="mt-2 text-sm leading-6 text-on-surface-variant">
            Exposes Playwright MCP browser automation through the always-headless
            Camoufox instance owned by the global Truss Windows service. Save and
            reload MCP servers after changing these settings.
          </p>
        </div>
        <div className="grid gap-3">
          <CommandRunnerGuardToggle
            checked={draft.playwrightMcp.enabled}
            description="Adds the managed truss-playwright-mcp entry as an active interactive browser automation server."
            icon="web_asset"
            label="Enable Playwright Browser"
            onChange={(value) =>
              onDraftChange({
                playwrightMcp: {
                  ...draft.playwrightMcp,
                  enabled: value,
                },
              })
            }
          />
          <SettingsTextInput
            helpText="Use * for every upstream Playwright MCP tool, or comma/newline-separated tool names such as browser_navigate, browser_click, browser_type."
            label="Allowed tools"
            mono
            onChange={(value) =>
              onDraftChange({
                playwrightMcp: {
                  ...draft.playwrightMcp,
                  tools: value,
                },
              })
            }
            value={draft.playwrightMcp.tools}
          />
        </div>
      </article>

      <article className="grid gap-4 rounded-sm border border-outline-variant bg-surface-container-lowest p-4 shadow-[0_12px_34px_rgb(27_28_25/0.06)]">
        <div>
          <h3 className="text-lg font-semibold text-on-surface">Webpage Sanitizer</h3>
          <p className="mt-2 text-sm leading-6 text-on-surface-variant">
            Choose the model Truss Web Tools uses to condense webpage content before
            returning it to chat. Default uses the fast helper profile.
          </p>
        </div>
        <div className="grid gap-3">
          <span className="text-xs font-semibold uppercase text-on-surface-variant">
            Webpage Sanitizer model source
          </span>
          <SanitizerModeToggle
            custom={useCustomModel}
            onChange={selectSanitizerMode}
          />
          <div className="grid gap-2">
            <div
              aria-hidden={useCustomModel}
              className={[
                "grid transition-[grid-template-rows,opacity,transform] duration-200 ease-out",
                useCustomModel
                  ? "grid-rows-[0fr] -translate-y-1 opacity-0"
                  : "grid-rows-[1fr] translate-y-0 opacity-100",
              ].join(" ")}
            >
              <div className="min-h-0 overflow-hidden">
                <DefaultSanitizerModelCard profile={fastHelperProfile} />
              </div>
            </div>
            <div
              aria-hidden={!useCustomModel}
              className={[
                "grid transition-[grid-template-rows,opacity,transform] duration-200 ease-out",
                useCustomModel
                  ? "grid-rows-[1fr] translate-y-0 opacity-100"
                  : "grid-rows-[0fr] -translate-y-1 opacity-0",
              ].join(" ")}
            >
              <div
                className={[
                  "min-h-0",
                  useCustomModel ? "overflow-visible" : "overflow-hidden",
                ].join(" ")}
              >
                <div className="grid gap-2">
                  {useCustomModel ? (
                    <>
                      <ModelSelector
                        disabled={modelOptions.length === 0 && !selectedModel}
                        loading={loadingModels}
                        onChange={(selection) =>
                          onDraftChange({
                            sanitizerModelId: selection.modelId,
                            sanitizerProviderId: selection.providerId,
                          })
                        }
                        options={modelOptions}
                        selected={selectedModel}
                      />
                      <span className="text-xs leading-5 text-on-surface-variant">
                        The selector uses models from enabled provider settings.
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          <span className="text-xs leading-5 text-on-surface-variant">
            Default uses the current fast helper. Custom model uses the selection saved
            here for Truss Web Tools.
          </span>
        </div>
      </article>

      <article className="grid gap-4 rounded-sm border border-outline-variant bg-surface-container-lowest p-4 shadow-[0_12px_34px_rgb(27_28_25/0.06)]">
        <div>
          <h3 className="text-lg font-semibold text-on-surface">Command Runner</h3>
          <p className="mt-2 text-sm leading-6 text-on-surface-variant">
            Choose the model that evaluates shell commands before execution and
            command output before it is returned to chat.
          </p>
        </div>
        <div className="grid gap-3">
          <span className="text-xs font-semibold uppercase text-on-surface-variant">
            Command guard model source
          </span>
          <SanitizerModeToggle
            custom={useCustomCommandGuardModel}
            onChange={selectCommandGuardMode}
          />
          <div className="grid gap-2">
            <div
              aria-hidden={useCustomCommandGuardModel}
              className={[
                "grid transition-[grid-template-rows,opacity,transform] duration-200 ease-out",
                useCustomCommandGuardModel
                  ? "grid-rows-[0fr] -translate-y-1 opacity-0"
                  : "grid-rows-[1fr] translate-y-0 opacity-100",
              ].join(" ")}
            >
              <div className="min-h-0 overflow-hidden">
                <DefaultSanitizerModelCard profile={fastHelperProfile} />
              </div>
            </div>
            <div
              aria-hidden={!useCustomCommandGuardModel}
              className={[
                "grid transition-[grid-template-rows,opacity,transform] duration-200 ease-out",
                useCustomCommandGuardModel
                  ? "grid-rows-[1fr] translate-y-0 opacity-100"
                  : "grid-rows-[0fr] -translate-y-1 opacity-0",
              ].join(" ")}
            >
              <div
                className={[
                  "min-h-0",
                  useCustomCommandGuardModel ? "overflow-visible" : "overflow-hidden",
                ].join(" ")}
              >
                <div className="grid gap-2">
                  {useCustomCommandGuardModel ? (
                    <>
                      <ModelSelector
                        disabled={
                          modelOptions.length === 0 && !selectedCommandGuardModel
                        }
                        loading={loadingModels}
                        onChange={(selection) =>
                          onDraftChange({
                            commandRunner: {
                              ...draft.commandRunner,
                              guardModelId: selection.modelId,
                              guardProviderId: selection.providerId,
                            },
                          })
                        }
                        options={modelOptions}
                        selected={selectedCommandGuardModel}
                      />
                      <span className="text-xs leading-5 text-on-surface-variant">
                        The selector uses models from enabled provider settings.
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          <span className="text-xs leading-5 text-on-surface-variant">
            Default uses the current fast helper. Custom model uses the selection saved
            here for Command Runner guards.
          </span>
        </div>
        <div className="grid gap-3 border-t border-outline-variant pt-4">
          <CommandRunnerGuardToggle
            checked={draft.commandRunner.preExecutionGuardEnabled}
            description="Checks the command, working directory, environment overrides, path access, and risky shell behavior before a process starts."
            icon="policy"
            label="Pre-execution guard"
            onChange={(value) =>
              onDraftChange({
                commandRunner: {
                  ...draft.commandRunner,
                  preExecutionGuardEnabled: value,
                },
              })
            }
          />
          <CommandRunnerGuardToggle
            checked={draft.commandRunner.postExecutionGuardEnabled}
            description="Checks stdout and stderr before output reaches the model, and blocks or redacts dangerous output such as secrets, private data, or prompt-injection text."
            icon="shield"
            label="Post-execution output guard"
            onChange={(value) =>
              onDraftChange({
                commandRunner: {
                  ...draft.commandRunner,
                  postExecutionGuardEnabled: value,
                },
              })
            }
          />
        </div>
      </article>

      {draft.error ? <SettingsAlert tone="error" message={draft.error} /> : null}
      <div className="flex justify-end">
        <PrimaryButton
          disabled={saveDisabled}
          icon="save"
          label={draft.saving ? "Saving" : "Save Truss MCP settings"}
          onClick={onSave}
        />
      </div>

      <TrussMcpSetupInstructionsModal
        onClose={() => setSetupInstructionsOpen(false)}
        open={setupInstructionsOpen}
      />
    </div>
  );
}



function FileAccessGrantsCard({
  error,
  fileAccess,
  loading,
  onRefresh,
  onGrant,
  onRevokeAll,
  onRevoke,
  revokingAll,
  revokingGrantId,
}: {
  error: string | null;
  fileAccess: FileAccessSecurityResponse | null;
  loading: boolean;
  onRefresh(): void;
  onGrant(scope: "global" | "workspace", readOnly?: boolean, directoryPath?: string): void;
  onRevokeAll(): void;
  onRevoke(directory: FileAccessDirectorySummary): void;
  revokingAll: boolean;
  revokingGrantId: number | null;
}) {
  const [newDirectoryPath, setNewDirectoryPath] = useState("");
  const grants = (fileAccess?.directories ?? []).filter((d) => d.scope === "global");
  const revokeAllDisabled = loading || grants.length === 0 || revokingAll;

  return (
    <article className="grid gap-4 rounded-sm border border-outline-variant bg-surface-container-lowest p-4 shadow-[0_12px_34px_rgb(27_28_25/0.06)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-primary">
            <MaterialIcon name="folder_managed" size={20} />
            <h3 className="text-lg font-semibold text-on-surface">Global granted directories</h3>
          </div>
          <p className="mt-2 text-sm leading-6 text-on-surface-variant">
            These directories are accessible by Truss in all contexts.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <SecondaryButton
            disabled={revokeAllDisabled}
            icon={revokingAll ? "sync" : "delete_sweep"}
            label={revokingAll ? "Revoking all" : "Revoke all"}
            onClick={onRevokeAll}
          />
          <SecondaryButton
            disabled={loading}
            icon={loading ? "sync" : "refresh"}
            label={loading ? "Refreshing" : "Refresh"}
            onClick={onRefresh}
          />
        </div>
      </div>

      <div className="rounded-sm border border-outline-variant bg-surface p-3">
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <SettingsTextInput
              label="Grant new directory globally"
              onChange={setNewDirectoryPath}
              placeholder="C:/path/to/directory"
              value={newDirectoryPath}
            />
          </div>
          <PrimaryButton
            disabled={loading || !newDirectoryPath.trim()}
            icon="add"
            label="Grant"
            onClick={() => {
              onGrant("global", false, newDirectoryPath.trim());
              setNewDirectoryPath("");
            }}
          />
        </div>
        <p className="mt-2 text-xs text-on-surface-variant">
          Paste a directory path above to allow Truss to read and write files within it across all
          contexts.
        </p>
      </div>

      {loading ? (
        <div className="flex min-h-24 items-center justify-center text-sm text-on-surface-variant">
          Loading granted directories...
        </div>
      ) : (
        <div className="grid gap-3">
          {grants.length > 0 ? (
            grants.map((directory) => (
              <FileAccessGrantRow
                directory={directory}
                key={directory.grantId ?? directory.path}
                onRevoke={onRevoke}
                revoking={directory.grantId !== undefined && directory.grantId === revokingGrantId}
              />
            ))
          ) : (
            <div className="flex flex-col items-center gap-4 rounded-sm border border-outline-variant bg-surface px-6 py-8 text-center">
              <p className="max-w-md text-sm text-on-surface-variant">
                No global directories are currently granted.
              </p>
            </div>
          )}
        </div>
      )}

      {error ? <SettingsAlert tone="error" message={error} /> : null}
    </article>
  );
}



function CommandRunnerGuardToggle({
  checked,
  description,
  icon,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  icon: string;
  label: string;
  onChange(value: boolean): void;
}) {
  return (
    <div
      className="flex items-start justify-between gap-4 rounded-sm border border-outline-variant bg-surface px-3 py-3"
      title={description}
    >
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-outline-variant bg-surface-container-low text-primary">
          <MaterialIcon name={icon} size={18} />
        </span>
        <span className="grid min-w-0 gap-1">
          <span className="text-sm font-semibold text-on-surface">{label}</span>
          <span className="text-xs leading-5 text-on-surface-variant">{description}</span>
        </span>
      </div>
      <SettingsSwitch checked={checked} label={label} onChange={onChange} />
    </div>
  );
}



function FileAccessGrantRow({
  directory,
  onRevoke,
  revoking = false,
}: {
  directory: FileAccessDirectorySummary;
  onRevoke?(directory: FileAccessDirectorySummary): void;
  revoking?: boolean;
}) {
  const revokeEnabled = Boolean(onRevoke && directory.source === "user" && directory.grantId);
  const sourceLabel =
    directory.source === "workspace"
      ? "Workspace root"
      : fileAccessGrantSourceLabel(directory.grantSource);

  return (
    <div
      className={[
        "grid gap-3 rounded-sm border px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
        directory.exists
          ? "border-outline-variant bg-surface text-on-surface"
          : "border-error-container bg-error-container/20 text-error",
      ].join(" ")}
    >
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2">
        <MaterialIcon
          className={directory.exists ? "text-primary" : "text-error"}
          name={directory.exists ? "folder" : "warning"}
          size={19}
        />
        <div className="grid min-w-0 gap-1">
          <code className="min-w-0 break-words text-xs [overflow-wrap:anywhere]">
            {directory.path}
          </code>
          <div className="flex flex-wrap gap-2 text-xs font-medium text-on-surface-variant">
            <span>{sourceLabel}</span>
            <span>{fileAccessDirectoryScopeLabel(directory)}</span>
            <span className="font-semibold text-on-surface">
              {directory.readOnly ? "Read-only" : "Read/write"}
            </span>
            {directory.expiresAt ? <span>Expires {formatDateTime(directory.expiresAt)}</span> : null}
          </div>
          {directory.error ? <span className="text-xs text-error">{directory.error}</span> : null}
        </div>
      </div>
      {onRevoke ? (
        <button
          className="inline-flex h-9 items-center justify-center gap-2 rounded-sm border border-outline-variant bg-surface-container-low px-3 text-xs font-semibold text-on-surface-variant transition hover:bg-surface-container hover:text-error focus:border-outline focus:bg-surface focus:outline-none disabled:cursor-not-allowed disabled:opacity-45"
          disabled={!revokeEnabled || revoking}
          onClick={() => onRevoke(directory)}
          type="button"
        >
          <MaterialIcon name={revoking ? "sync" : "delete"} size={16} />
          {revoking ? "Revoking" : "Revoke"}
        </button>
      ) : null}
    </div>
  );
}



function SanitizerModeToggle({
  custom,
  onChange,
}: {
  custom: boolean;
  onChange(custom: boolean): void;
}) {
  return (
    <div className="inline-flex w-fit rounded-sm border border-outline-variant bg-surface-container-low p-1">
      {[
        { custom: false, label: "Default" },
        { custom: true, label: "Custom model" },
      ].map((option) => (
        <button
          aria-pressed={custom === option.custom}
          className={[
            "h-8 rounded-sm px-3 text-xs font-semibold uppercase transition focus:border-outline focus:outline-none",
            custom === option.custom
              ? "bg-primary text-on-primary"
              : "text-on-surface-variant hover:bg-surface-container hover:text-primary",
          ].join(" ")}
          key={option.label}
          onClick={() => onChange(option.custom)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}



function DefaultSanitizerModelCard({
  profile,
}: {
  profile: LlmModelProfileSummary | null;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-sm border border-outline-variant bg-surface px-3 py-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm border border-outline-variant bg-surface-container-low text-primary">
        <MaterialIcon name="bolt" size={20} />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate text-sm font-semibold text-on-surface">
          {profile ? formatHumanReadableModelName(profile.modelId) : "Fast helper"}
        </span>
        <span className="truncate text-xs font-medium uppercase text-on-surface-variant">
          {profile?.providerLabel ?? "No configured provider"}
        </span>
      </span>
    </div>
  );
}



function TrussMcpSetupInstructionsModal({
  onClose,
  open,
}: {
  onClose(): void;
  open: boolean;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "done" | "error">("idle");
  const copyStatusTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyStatusTimeoutRef.current !== null) {
        window.clearTimeout(copyStatusTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (open) {
      return;
    }

    if (copyStatusTimeoutRef.current !== null) {
      window.clearTimeout(copyStatusTimeoutRef.current);
      copyStatusTimeoutRef.current = null;
    }

    setCopyStatus("idle");
  }, [open]);

  function setTransientCopyStatus(status: "done" | "error"): void {
    if (copyStatusTimeoutRef.current !== null) {
      window.clearTimeout(copyStatusTimeoutRef.current);
    }

    setCopyStatus(status);
    copyStatusTimeoutRef.current = window.setTimeout(() => {
      setCopyStatus("idle");
      copyStatusTimeoutRef.current = null;
    }, 1800);
  }

  async function copySetupSnippet(): Promise<void> {
    try {
      await navigator.clipboard.writeText(trussFirstPartyMcpSetupSnippet);
      setTransientCopyStatus("done");
    } catch {
      setTransientCopyStatus("error");
    }
  }

  const copyLabel =
    copyStatus === "done" ? "Copied" : copyStatus === "error" ? "Copy failed" : "Copy";

  return (
    <Modal
      description="Bundled first-party Truss stdio MCP server configuration."
      footer={<SecondaryButton icon="close" label="Close" onClick={onClose} />}
      icon="article"
      onClose={onClose}
      open={open}
      size="lg"
      title="Setup instructions"
    >
      <div className="grid gap-3">
        <p className="text-sm leading-6 text-on-surface-variant">
          Add stdio MCP server entries in the client application that should use
          first-party Truss tools.
        </p>
        <div className="overflow-hidden rounded-sm border border-outline-variant bg-inverse-surface text-inverse-on-surface shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
            <span className="text-xs font-semibold uppercase text-inverse-on-surface/65">
              JSON
            </span>
            <button
              className="inline-flex h-8 items-center gap-2 rounded-sm border border-white/15 bg-white/5 px-2.5 text-xs font-semibold text-inverse-on-surface transition hover:bg-white/10 focus:border-white/35 focus:outline-none"
              onClick={() => void copySetupSnippet()}
              type="button"
            >
              <MaterialIcon
                name={
                  copyStatus === "done"
                    ? "check"
                    : copyStatus === "error"
                      ? "error"
                      : "content_copy"
                }
                size={16}
              />
              {copyLabel}
            </button>
          </div>
          <pre className="overflow-x-auto px-3 py-3 text-xs leading-5">
            <code className="language-json">
              {highlightCode(trussFirstPartyMcpSetupSnippet, "json")}
            </code>
          </pre>
        </div>
      </div>
    </Modal>
  );
}

