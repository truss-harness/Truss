import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import type {
  ChatAttachment,
  ChatToolSettings,
  McpDiscoverySummary,
} from "../../../shared/protocol.ts";
import { getMcpPrompt } from "../../api.ts";
import { requestBrowserNotificationPermission } from "../../browser-notifications.ts";
import {
  attachmentErrorFromMessage,
  attachmentErrorFromRejections,
  createChatAttachments,
  FileDropTextarea,
  ComposerAttachmentImageConfirmationRequiredError,
  selectComposerAttachments,
  type AttachmentErrorState,
  type ComposerAttachment,
  type ComposerMcpPrompt,
  SUPPORTED_ATTACHMENT_ACCEPT,
} from "../FileDropTextarea.tsx";
import { MaterialIcon } from "../MaterialIcon.tsx";
import {
  mcpConnectingServerCount,
  mcpFailedServerCount,
} from "../mcp/McpConnectionStatus.tsx";
import {
  LargeImageAttachmentConfirmation,
  type LargeImageAttachmentConfirmationState,
} from "./AttachmentImageConfirmation.tsx";
import { errorMessage } from "./chat-utils.ts";
import { ToolSettingsModal } from "./ToolSettingsModal.tsx";
import { SecuritySettingsModal } from "./SecuritySettingsModal.tsx";
import type { ComposerMode } from "./types.ts";

const compactIconButtonSize = 36;
const compactIconButtonGap = 4;
const dockedVerticalToolsMinHeight = compactIconButtonSize * 3 + compactIconButtonGap * 2;
type DraftEditDirection = "delete" | "insert" | "neutral";

export function ChatPromptCard({
  disabled,
  docked,
  followUps = [],
  mode,
  mcp,
  onModeChange,
  onMcpReloaded,
  onSend,
  onStop,
  onToolSettingsChange,
  running = false,
  toolSettings,
}: {
  disabled: boolean;
  docked: boolean;
  followUps?: string[];
  mode: ComposerMode;
  mcp: McpDiscoverySummary | null;
  onModeChange(mode: ComposerMode): void;
  onMcpReloaded?(mcp: McpDiscoverySummary): void;
  onSend(content: string, attachments: ChatAttachment[]): void;
  onStop?(): void;
  onToolSettingsChange(settings: ChatToolSettings): void;
  running?: boolean;
  toolSettings: ChatToolSettings;
}) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<AttachmentErrorState | null>(null);
  const [securitySettingsOpen, setSecuritySettingsOpen] = useState(false);
  const [toolSettingsOpen, setToolSettingsOpen] = useState(false);
  const [imageConfirmation, setImageConfirmation] =
    useState<LargeImageAttachmentConfirmationState | null>(null);
  const [confirmedImageAttachmentIds, setConfirmedImageAttachmentIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [isPreparingFiles, setIsPreparingFiles] = useState(false);
  const [dismissedFollowUpKey, setDismissedFollowUpKey] = useState("");
  const [dockedToolsStacked, setDockedToolsStacked] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dockedComposerBodyRef = useRef<HTMLDivElement | null>(null);
  const dockedToolsStackedRef = useRef(false);
  const draftEditDirectionRef = useRef<DraftEditDirection>("neutral");
  const draftEditDirectionTimeoutRef = useRef<number | null>(null);
  const canSubmit =
    running || (!disabled && !isPreparingFiles && (draft.trim() || attachments.length > 0));
  const followUpKey = followUps.slice(0, 3).join("\u001f");
  const visibleFollowUps =
    docked && followUpKey && followUpKey !== dismissedFollowUpKey ? followUps.slice(0, 3) : [];

  useEffect(() => {
    if (!followUpKey) {
      setDismissedFollowUpKey("");
    }
  }, [followUpKey]);

  useEffect(() => {
    if (!docked) {
      updateDockedToolsStacked(false);
      return;
    }

    const element = dockedComposerBodyRef.current;

    if (!element) {
      return;
    }

    const updateStackedState = () => {
      const nextStacked =
        element.getBoundingClientRect().height >= dockedVerticalToolsMinHeight;
      const currentStacked = dockedToolsStackedRef.current;

      if (nextStacked === currentStacked) {
        return;
      }

      const editDirection = draftEditDirectionRef.current;

      if (
        (nextStacked && editDirection === "delete") ||
        (!nextStacked && editDirection === "insert")
      ) {
        return;
      }

      updateDockedToolsStacked(nextStacked);
    };

    updateStackedState();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(updateStackedState);
    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, [docked]);

  useEffect(
    () => () => {
      if (draftEditDirectionTimeoutRef.current !== null) {
        window.clearTimeout(draftEditDirectionTimeoutRef.current);
      }
    },
    [],
  );

  function submitPrompt(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (running) {
      onStop?.();
      return;
    }

    void submitDraft();
  }

  async function submitDraft(
    confirmedImageIds: ReadonlySet<string> = confirmedImageAttachmentIds,
  ): Promise<void> {
    const trimmed = draft.trim();

    if ((!trimmed && attachments.length === 0) || disabled || isPreparingFiles) {
      return;
    }

    requestBrowserNotificationPermission();
    setIsPreparingFiles(true);

    try {
      const chatAttachments = await createChatAttachments(attachments, {
        confirmedImageAttachmentIds: confirmedImageIds,
      });

      onSend(trimmed, chatAttachments);
      setDraft("");
      setAttachments([]);
      setAttachmentError(null);
      setImageConfirmation(null);
      setConfirmedImageAttachmentIds(new Set());
    } catch (caught) {
      if (caught instanceof ComposerAttachmentImageConfirmationRequiredError) {
        setAttachmentError(null);
        setImageConfirmation({
          attachmentId: caught.attachmentId,
          fileName: caught.fileName,
          pageCount: caught.pageCount,
        });
        return;
      }

      setAttachmentError(attachmentErrorFromMessage(errorMessage(caught)));
    } finally {
      setIsPreparingFiles(false);
    }
  }

  function confirmLargeImageAttachment(): void {
    if (!imageConfirmation) {
      return;
    }

    const nextConfirmedImageAttachmentIds = new Set(confirmedImageAttachmentIds);
    nextConfirmedImageAttachmentIds.add(imageConfirmation.attachmentId);
    setConfirmedImageAttachmentIds(nextConfirmedImageAttachmentIds);
    setImageConfirmation(null);
    void submitDraft(nextConfirmedImageAttachmentIds);
  }

  function handleAttachmentsChange(nextAttachments: ComposerAttachment[]): void {
    setAttachments(nextAttachments);
    setImageConfirmation(null);
    setConfirmedImageAttachmentIds(new Set());
  }

  function handleDraftChange(nextDraft: string): void {
    const editDirection =
      nextDraft.length > draft.length
        ? "insert"
        : nextDraft.length < draft.length
          ? "delete"
          : "neutral";

    draftEditDirectionRef.current = editDirection;

    if (draftEditDirectionTimeoutRef.current !== null) {
      window.clearTimeout(draftEditDirectionTimeoutRef.current);
    }

    draftEditDirectionTimeoutRef.current = window.setTimeout(() => {
      draftEditDirectionRef.current = "neutral";
      draftEditDirectionTimeoutRef.current = null;
    }, 120);

    setDraft(nextDraft);
  }

  function updateDockedToolsStacked(nextStacked: boolean): void {
    dockedToolsStackedRef.current = nextStacked;
    setDockedToolsStacked(nextStacked);
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const files = event.target.files;

    if (!files) {
      return;
    }

    const result = selectComposerAttachments(files);

    if (result.rejections.length > 0) {
      setAttachmentError(attachmentErrorFromRejections(result.rejections));
    } else {
      setAttachmentError(null);
    }

    if (result.attachments.length > 0) {
      setAttachments((current) => [...current, ...result.attachments]);
      setImageConfirmation(null);
      setConfirmedImageAttachmentIds(new Set());
    }

    event.target.value = "";
  }

  function selectFollowUp(prompt: string): void {
    if (disabled || isPreparingFiles) {
      return;
    }

    setDraft(prompt);
    setDismissedFollowUpKey(followUpKey);
  }

  async function resolveMcpPrompt(prompt: ComposerMcpPrompt): Promise<string> {
    const response = await getMcpPrompt({
      arguments: mcpPromptTemplateArguments(prompt),
      name: prompt.name,
      serverId: prompt.serverId,
    });

    return response.text.trim();
  }

  return (
    <div
      className={[
        "grid w-full min-w-0 gap-3 transition-all duration-500 ease-out",
        docked
          ? "truss-chat-dock sticky bottom-0 z-20 shrink-0 bg-surface/95 px-5 py-3 pt-0 backdrop-blur sm:px-8 lg:px-12"
          : "",
      ].join(" ")}
    >
      {imageConfirmation ? (
        <LargeImageAttachmentConfirmation
          confirmation={imageConfirmation}
          disabled={isPreparingFiles}
          onCancel={() => setImageConfirmation(null)}
          onConfirm={confirmLargeImageAttachment}
        />
      ) : null}

      <div className="grid w-full min-w-0 gap-0">
        {visibleFollowUps.length > 0 ? (
          <FollowUpPromptPanel
            disabled={disabled || isPreparingFiles}
            onDismiss={() => setDismissedFollowUpKey(followUpKey)}
            onSelect={selectFollowUp}
            prompts={visibleFollowUps}
          />
        ) : null}

        <form
          className={[
            docked
              ? [
                  "mx-auto flex w-full max-w-[980px] items-center gap-3 border border-outline-variant/80 bg-surface-container-lowest px-3 py-2 shadow-[0_14px_34px_rgb(60_50_30/0.08),inset_0_0_0_1px_rgb(255_255_255/0.65)]",
                  visibleFollowUps.length > 0 ? "rounded-b-sm rounded-t-none" : "rounded-sm",
                ].join(" ")
              : "w-full min-w-0 overflow-visible rounded-sm border border-outline-variant bg-surface shadow-[0_24px_80px_rgb(60_50_30/0.1)]",
          ].join(" ")}
          onSubmit={submitPrompt}
        >
          {docked ? (
            <>
              <div
                aria-label="Composer tools"
                className={[
                  "truss-composer-tool-stack",
                  dockedToolsStacked ? "truss-composer-tool-stack-stacked" : "",
                ].filter(Boolean).join(" ")}
              >
                <input
                  accept={SUPPORTED_ATTACHMENT_ACCEPT}
                  className="hidden"
                  multiple
                  onChange={handleFileInputChange}
                  ref={fileInputRef}
                  type="file"
                />
                <IconButton
                  className="truss-composer-tool-action truss-composer-tool-action-0"
                  label="Attach files"
                  onClick={() => fileInputRef.current?.click()}
                  position="absolute"
                  size="compact"
                >
                  <MaterialIcon name="attach_file" size={20} />
                </IconButton>
                <IconButton
                  className="truss-composer-tool-action truss-composer-tool-action-1"
                  label="Security"
                  onClick={() => setSecuritySettingsOpen(true)}
                  position="absolute"
                  size="compact"
                >
                  <MaterialIcon name="lock" size={20} />
                </IconButton>
                <IconButton
                  className="truss-composer-tool-action truss-composer-tool-action-2"
                  label={toolButtonLabel(toolSettings, mcp)}
                  onClick={() => setToolSettingsOpen(true)}
                  position="absolute"
                  size="compact"
                >
                  <McpToolButtonIcon mcp={mcp} />
                </IconButton>
              </div>
              <div className="min-w-0 flex-1" ref={dockedComposerBodyRef}>
                <FileDropTextarea
                  attachments={attachments}
                  attachmentError={attachmentError}
                  compact
                  disabled={disabled || isPreparingFiles}
                  docked
                  label="Message"
                  mcpPrompts={mcpPromptSuggestions(mcp)}
                  onAttachmentError={setAttachmentError}
                  onAttachmentErrorDismiss={() => setAttachmentError(null)}
                  onAttachmentsChange={handleAttachmentsChange}
                  onChange={handleDraftChange}
                  onMcpPromptResolve={resolveMcpPrompt}
                  onSubmitRequested={() => void submitDraft()}
                  placeholder="How can Truss help you today?"
                  rows={1}
                  value={draft}
                />
              </div>
              <IconButton
                disabled={!canSubmit}
                label={submitButtonLabel({ isPreparingFiles, running })}
                onClick={running ? onStop : undefined}
                type={running ? "button" : "submit"}
              >
                <SubmitButtonIcon
                  isPreparingFiles={isPreparingFiles}
                  running={running}
                  size="regular"
                />
              </IconButton>
            </>
          ) : (
            <>
              <FileDropTextarea
                attachments={attachments}
                attachmentError={attachmentError}
                disabled={disabled || isPreparingFiles}
                label="Message"
                mcpPrompts={mcpPromptSuggestions(mcp)}
                onAttachmentError={setAttachmentError}
                onAttachmentErrorDismiss={() => setAttachmentError(null)}
                onAttachmentsChange={handleAttachmentsChange}
                onChange={handleDraftChange}
                onMcpPromptResolve={resolveMcpPrompt}
                onSubmitRequested={() => void submitDraft()}
                placeholder="How can Truss help you today?"
                value={draft}
              />

              <div className="flex min-h-24 flex-col gap-4 border-t border-outline-variant bg-surface-container-low/45 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-1">
                  <input
                    accept={SUPPORTED_ATTACHMENT_ACCEPT}
                    className="hidden"
                    multiple
                    onChange={handleFileInputChange}
                    ref={fileInputRef}
                    type="file"
                  />
                  <IconButton
                    label="Attach files"
                    onClick={() => fileInputRef.current?.click()}
                    size="compact"
                  >
                    <MaterialIcon name="attach_file" size={20} />
                  </IconButton>
                  <IconButton
                    label="Security"
                    onClick={() => setSecuritySettingsOpen(true)}
                    size="compact"
                  >
                    <MaterialIcon name="lock" size={20} />
                  </IconButton>
                  <IconButton
                    label={toolButtonLabel(toolSettings, mcp)}
                    onClick={() => setToolSettingsOpen(true)}
                    size="compact"
                  >
                    <McpToolButtonIcon mcp={mcp} />
                  </IconButton>
                </div>

                <div className="flex items-center justify-between gap-4 sm:justify-end">
                  <ModeToggle mode={mode} onModeChange={onModeChange} />
                  <IconButton
                    disabled={!canSubmit}
                    label={submitButtonLabel({ isPreparingFiles, running })}
                    onClick={running ? onStop : undefined}
                    type={running ? "button" : "submit"}
                  >
                    <SubmitButtonIcon
                      isPreparingFiles={isPreparingFiles}
                      running={running}
                      size="large"
                    />
                  </IconButton>
                </div>
              </div>
            </>
          )}
        </form>
      </div>
      <ToolSettingsModal
        onChange={onToolSettingsChange}
        onClose={() => setToolSettingsOpen(false)}
        onMcpReloaded={onMcpReloaded}
        open={toolSettingsOpen}
        settings={toolSettings}
      />
      <SecuritySettingsModal
        onClose={() => setSecuritySettingsOpen(false)}
        onMcpReloaded={onMcpReloaded}
        open={securitySettingsOpen}
      />
    </div>
  );
}

function submitButtonLabel({
  isPreparingFiles,
  running,
}: {
  isPreparingFiles: boolean;
  running: boolean;
}): string {
  if (running) {
    return "Stop request";
  }

  return isPreparingFiles ? "Preparing files" : "Send message (Enter) - New line (Shift+Enter)";
}

function SubmitButtonIcon({
  isPreparingFiles,
  running,
  size,
}: {
  isPreparingFiles: boolean;
  running: boolean;
  size: "large" | "regular";
}) {
  if (running) {
    return <MaterialIcon fill name="stop" size={size === "large" ? 28 : 25} />;
  }

  return isPreparingFiles ? (
    <LoadingSpinner size={size} />
  ) : (
    <MaterialIcon name="send" size={size === "large" ? 28 : 25} />
  );
}

function FollowUpPromptPanel({
  disabled,
  onDismiss,
  onSelect,
  prompts,
}: {
  disabled: boolean;
  onDismiss(): void;
  onSelect(prompt: string): void;
  prompts: string[];
}) {
  return (
    <div
      aria-label="Follow-up prompts"
      className="truss-follow-up-panel mx-auto grid w-full max-w-[980px] grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-t-sm border border-b-0 border-outline-variant/80 bg-surface-container-lowest px-2 py-2 shadow-[0_12px_28px_rgb(60_50_30/0.07),inset_0_0_0_1px_rgb(255_255_255/0.55)]"
    >
      <div className="grid min-w-0 gap-1">
        {prompts.slice(0, 3).map((prompt, index) => (
          <button
            className="flex min-h-8 min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm leading-5 text-on-surface-variant transition hover:bg-surface-container-low hover:text-on-surface focus-visible:bg-surface-container-low focus-visible:text-on-surface focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
            disabled={disabled}
            key={`${index}:${prompt}`}
            onClick={() => onSelect(prompt)}
            type="button"
          >
            <MaterialIcon className="shrink-0 text-primary" name="subdirectory_arrow_right" size={17} />
            <span className="min-w-0 truncate">{prompt}</span>
          </button>
        ))}
      </div>
      <button
        aria-label="Dismiss follow-up prompts"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-sm text-on-surface-variant transition hover:bg-surface-container-low hover:text-primary focus-visible:bg-surface-container-low focus-visible:text-primary focus-visible:outline-none"
        onClick={onDismiss}
        title="Dismiss follow-up prompts"
        type="button"
      >
        <MaterialIcon name="close" size={17} />
      </button>
    </div>
  );
}

export function ModeToggle({
  compact = false,
  disabled = false,
  mode,
  onModeChange,
  sessionStartedMode = null,
  tooltipPlacement = "top",
}: {
  compact?: boolean;
  disabled?: boolean;
  mode: ComposerMode;
  onModeChange(mode: ComposerMode): void;
  sessionStartedMode?: ComposerMode | null;
  tooltipPlacement?: "bottom" | "top";
}) {
  const tooltipClass =
    tooltipPlacement === "bottom"
      ? "top-[calc(100%+8px)] translate-y-[-0.25rem] group-hover/toggle:translate-y-0 group-focus-visible/toggle:translate-y-0"
      : "bottom-[calc(100%+8px)] translate-y-2 group-hover/toggle:translate-y-0 group-focus-visible/toggle:translate-y-0";
  const buttonClass = compact ? "h-8 w-10" : "h-8 w-12";

  return (
    <div className="relative inline-grid h-10 shrink-0 grid-cols-2 rounded-sm border border-outline-variant bg-surface-container-low p-1">
      <span
        aria-hidden="true"
        className={[
          "absolute bottom-1 left-1 top-1 w-[calc(50%-4px)] rounded-sm shadow-[0_2px_7px_rgb(27_28_25/0.08)] transition-[transform,background-color] duration-200 ease-out",
          mode === "conversation"
            ? "translate-x-0 bg-secondary-container"
            : "translate-x-full bg-tertiary-container",
        ].join(" ")}
      />
      {(["conversation", "agent"] as const).map((item) => (
        <button
          aria-label={modeToggleLabel(item)}
          aria-pressed={mode === item}
          className={[
            "group/toggle relative z-10 grid place-items-center rounded-sm transition-colors duration-200",
            buttonClass,
            disabled ? "cursor-not-allowed opacity-50" : "",
            mode === item
              ? item === "conversation"
                ? "text-on-secondary-container"
                : "text-on-tertiary"
              : "text-on-surface-variant hover:text-primary",
          ].join(" ")}
          disabled={disabled}
          key={item}
          onClick={() => onModeChange(item)}
          type="button"
        >
          <MaterialIcon name={modeToggleIcon(item)} size={compact ? 17 : 18} />
          <span
            className={[
              "pointer-events-none absolute left-1/2 z-50 w-80 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-sm border border-outline-variant bg-surface px-3 py-2 text-left text-[11px] font-medium normal-case leading-4 text-on-surface opacity-0 shadow-[0_12px_28px_rgb(27_28_25/0.14)] transition-[opacity,transform] duration-[180ms] ease-in group-hover/toggle:opacity-100 group-hover/toggle:duration-200 group-hover/toggle:ease-out group-focus-visible/toggle:opacity-100 group-focus-visible/toggle:duration-200 group-focus-visible/toggle:ease-out",
              tooltipClass,
            ].join(" ")}
          >
            {sessionStartedMode
              ? `Applies to your next message only. Session was started in ${modeTooltipSessionLabel(
                  sessionStartedMode,
                )} mode.`
              : item === "conversation"
                ? "Conversation mode: Interactive dialogue driven by you, where the AI might use tools step-by-step as you ask."
                : "Agentic mode: Multi-step problem solving that runs an independent loop of planning, tool execution, and self-correction until finished."}
          </span>
        </button>
      ))}
    </div>
  );
}

function modeTooltipSessionLabel(mode: ComposerMode): string {
  return mode === "agent" ? "agentic" : "conversation";
}

function modeToggleIcon(mode: ComposerMode): string {
  return mode === "conversation" ? "chat_bubble" : "smart_toy";
}

function modeToggleLabel(mode: ComposerMode): string {
  return mode === "conversation" ? "Conversation mode" : "Agent mode";
}

function toolButtonLabel(
  settings: ChatToolSettings,
  mcp: McpDiscoverySummary | null,
): string {
  const disabledServerCount = settings.disabledMcpServerIds?.length ?? 0;
  const disabledToolCount = Object.values(settings.disabledMcpTools ?? {}).reduce(
    (total, tools) => total + tools.length,
    0,
  );
  const disabledCount = disabledServerCount + disabledToolCount;
  const connectingCount = mcp ? mcpConnectingServerCount(mcp) : 0;
  const failedCount = mcp ? mcpFailedServerCount(mcp) : 0;
  const details = [
    disabledCount > 0 ? `${disabledCount} disabled` : null,
    connectingCount > 0 ? `${connectingCount} connecting` : null,
    failedCount > 0 ? `${failedCount} failed` : null,
  ].filter((detail): detail is string => Boolean(detail));

  return details.length > 0 ? `MCP Settings (${details.join(", ")})` : "MCP Settings";
}

function mcpPromptSuggestions(mcp: McpDiscoverySummary | null): ComposerMcpPrompt[] {
  if (!mcp) {
    return [];
  }

  return mcp.servers.flatMap((server) =>
    server.status === "connected"
      ? server.prompts.map((prompt) => ({
          arguments: prompt.arguments,
          description: prompt.description,
          name: prompt.name,
          serverId: server.serverId,
          serverName: server.name,
        }))
      : [],
  );
}

function mcpPromptTemplateArguments(prompt: ComposerMcpPrompt): Record<string, string> {
  const result: Record<string, string> = {};

  for (const argument of prompt.arguments ?? []) {
    const name = typeof argument.name === "string" && argument.name.trim()
      ? argument.name.trim()
      : "";

    if (name) {
      result[name] = `{${name}}`;
    }
  }

  return result;
}

function IconButton({
  children,
  className = "",
  disabled,
  inert = false,
  label,
  onClick,
  position = "relative",
  size = "regular",
  type = "button",
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  inert?: boolean;
  label: string;
  onClick?(): void;
  position?: "absolute" | "relative";
  size?: "compact" | "regular";
  type?: "button" | "submit";
}) {
  const sizeClass = size === "compact" ? "h-9 w-9" : "h-10 w-10";
  const positionClass = position === "absolute" ? "absolute" : "relative";

  return (
    <button
      aria-disabled={inert || undefined}
      aria-label={label}
      className={[
        "group/icon-button grid place-items-center rounded-sm text-primary transition hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-45",
        positionClass,
        sizeClass,
        className,
        inert ? "cursor-default" : "",
      ].join(" ")}
      disabled={disabled}
      onClick={(event) => {
        if (inert) {
          event.preventDefault();
          return;
        }

        onClick?.();
      }}
      title={label}
      type={type}
    >
      {children}
      <span className="pointer-events-none absolute bottom-[calc(100%+7px)] left-1/2 z-40 w-max max-w-44 -translate-x-1/2 translate-y-1 rounded-sm border border-outline-variant bg-surface px-2 py-1 text-xs font-medium text-on-surface opacity-0 shadow-[0_10px_24px_rgb(27_28_25/0.14)] transition group-hover/icon-button:translate-y-0 group-hover/icon-button:opacity-100 group-focus-visible/icon-button:translate-y-0 group-focus-visible/icon-button:opacity-100">
        {label}
      </span>
    </button>
  );
}

function LoadingSpinner({ size }: { size: "large" | "regular" }) {
  const sizeClass = size === "large" ? "h-6 w-6" : "h-5 w-5";

  return (
    <span
      aria-hidden="true"
      className={[
        "block animate-spin rounded-full border-2 border-primary/25 border-t-primary",
        sizeClass,
      ].join(" ")}
    />
  );
}

function McpToolButtonIcon({ mcp }: { mcp: McpDiscoverySummary | null }) {
  const connectingCount = mcp ? mcpConnectingServerCount(mcp) : 0;
  const failedCount = mcp ? mcpFailedServerCount(mcp) : 0;

  return (
    <span className="relative grid h-5 w-5 place-items-center">
      <McpLogo size={20} />
      {connectingCount > 0 ? (
        <span
          aria-hidden="true"
          className="truss-spinner absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-full border-[1.5px] border-outline-variant border-t-primary bg-surface"
        />
      ) : null}
      {failedCount > 0 ? (
        <span className="absolute -bottom-1.5 -right-1.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-error-container text-error">
          <MaterialIcon fill name="error" size={11} />
        </span>
      ) : null}
    </span>
  );
}

function McpLogo({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 180 180"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M18 84.8528L85.8822 16.9706C95.2548 7.598 110.451 7.598 119.823 16.9706C129.196 26.3431 129.196 41.5391 119.823 50.9117L68.5581 102.177"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="12"
      />
      <path
        d="M69.2652 101.47L119.823 50.9117C129.196 41.5391 144.392 41.5391 153.765 50.9117L154.118 51.2652C163.491 60.6378 163.491 75.8338 154.118 85.2063L92.7248 146.6C89.6006 149.724 89.6006 154.789 92.7248 157.913L105.331 170.52"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="12"
      />
      <path
        d="M102.853 33.9411L52.6482 84.1457C43.2756 93.5183 43.2756 108.714 52.6482 118.087C62.0208 127.459 77.2167 127.459 86.5893 118.087L136.794 67.8822"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="12"
      />
    </svg>
  );
}
