import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import type {
  ChatAttachment,
  CommandRunnerGuardAssessment,
  ChatSubAgentReference,
  ChatThinking,
  ChatToolCall,
  RichFeatureSettingsSummary,
} from "../../../shared/protocol.ts";
import { appendThinkingTextBlock } from "../../../shared/chat-thinking.ts";
import {
  toolResultImagePreview,
  toolResultImagePreviewFromData,
  type ToolResultImagePreview,
} from "../../../shared/tool-result-images.ts";
import {
  MarkdownView,
  highlightCode,
  markdownContainsWideContent,
  stripMarkdownFollowUps,
} from "../../markdown.tsx";
import {
  attachmentErrorFromMessage,
  attachmentErrorFromRejections,
  ComposerAttachmentImageConfirmationRequiredError,
  createChatAttachments,
  FileDropTextarea,
  selectComposerAttachments,
  SUPPORTED_ATTACHMENT_ACCEPT,
  type AttachmentErrorState,
  type ComposerAttachment,
} from "../FileDropTextarea.tsx";
import { MaterialIcon } from "../MaterialIcon.tsx";
import { Modal } from "../Modal.tsx";
import {
  LargeImageAttachmentConfirmation,
  type LargeImageAttachmentConfirmationState,
} from "./AttachmentImageConfirmation.tsx";
import { AttachmentPreviewModal } from "./AttachmentPreviewModal.tsx";
import {
  assistantMessageLabel,
  copyTextToClipboard,
  errorMessage,
  formatFileSize,
  formatMessageMarkdown,
  formatMessageTimestamp,
  formatThoughtDuration,
  formatWordCount,
  messageInformationRows,
  messageThinkingDurationMs,
} from "./chat-utils.ts";
import type { ChatUiMessage } from "./types.ts";

interface AttachmentPreviewTarget {
  attachment: ChatAttachment;
  onSaveAttachment(attachment: ChatAttachment): Promise<void> | void;
}

export function ChatTranscript({
  banner,
  disabled,
  initialTopScrollKey,
  messageAnchorId,
  messages,
  onMessageAnchorMissing,
  onMessageAnchorResolved,
  onCopySuccess,
  onDeleteMessage,
  onEditMessage,
  onRetryMessage,
  onOpenSubAgent,
  onOpenSubAgentId,
  onUpdateAttachment,
  onTerminateCommand,
  readOnly = false,
  renderMarkdown = true,
  richFeatures,
}: {
  banner?: ReactNode;
  disabled: boolean;
  initialTopScrollKey?: string | null;
  messageAnchorId?: string | null;
  messages: ChatUiMessage[];
  onMessageAnchorMissing?(messageId: string): void;
  onMessageAnchorResolved?(messageId: string): void;
  onCopySuccess(message: string): void;
  onDeleteMessage(messageId: string): Promise<void>;
  onEditMessage(
    messageId: string,
    content: string,
    attachments: ChatAttachment[] | undefined,
  ): Promise<void>;
  onOpenSubAgent?(subAgent: ChatSubAgentReference): void;
  onOpenSubAgentId?(subSessionId: string): void;
  onTerminateCommand?(toolCall: ChatToolCall): Promise<void>;
  onRetryMessage(messageId: string): Promise<void>;
  onUpdateAttachment(messageId: string, attachment: ChatAttachment): Promise<void>;
  readOnly?: boolean;
  renderMarkdown?: boolean;
  richFeatures: RichFeatureSettingsSummary;
}) {
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const skipNextAutoScrollRef = useRef(false);
  const lastInitialTopScrollKeyRef = useRef<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<AttachmentPreviewTarget | null>(null);

  useLayoutEffect(() => {
    if (!messageAnchorId || messages.length === 0) {
      return;
    }

    const target = Array.from(
      transcriptRef.current?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [],
    ).find((element) => element.dataset.messageId === messageAnchorId);

    if (!target) {
      onMessageAnchorMissing?.(messageAnchorId);
      return;
    }

    target.scrollIntoView({ block: "center" });
    skipNextAutoScrollRef.current = true;
    onMessageAnchorResolved?.(messageAnchorId);
  }, [messageAnchorId, messages, onMessageAnchorMissing, onMessageAnchorResolved]);

  useEffect(() => {
    if (messageAnchorId) {
      return;
    }

    if (skipNextAutoScrollRef.current) {
      skipNextAutoScrollRef.current = false;
      return;
    }

    if (
      initialTopScrollKey &&
      lastInitialTopScrollKeyRef.current !== initialTopScrollKey
    ) {
      lastInitialTopScrollKeyRef.current = initialTopScrollKey;
      transcriptRef.current?.scrollTo({ top: 0 });
      return;
    }

    if (!initialTopScrollKey && lastInitialTopScrollKeyRef.current) {
      lastInitialTopScrollKeyRef.current = null;
      return;
    }

    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [initialTopScrollKey, messageAnchorId, messages]);

  return (
    <>
      <section
        className="truss-message-scrollbar mx-auto min-h-0 w-full max-w-[980px] flex-1 space-y-4 overflow-y-auto px-5 py-6 sm:px-8 lg:px-12"
        ref={transcriptRef}
      >
        {banner}
        {messages.map((message, index) => (
          <ChatBubble
            compactTopSpacing={shouldCollapseMessageTopSpacing(messages, index)}
            disabled={disabled}
            key={message.id}
            message={message}
            showFooter={shouldShowMessageFooter(messages, index)}
            showHeader={shouldShowMessageHeader(messages, index)}
            onCopySuccess={onCopySuccess}
            onDeleteMessage={onDeleteMessage}
            onEditMessage={onEditMessage}
            onOpenSubAgent={onOpenSubAgent}
            onOpenSubAgentId={onOpenSubAgentId}
            onPreviewAttachment={setPreviewTarget}
            onRetryMessage={onRetryMessage}
            onTerminateCommand={onTerminateCommand}
            onUpdateAttachment={onUpdateAttachment}
            readOnly={readOnly}
            renderMarkdown={renderMarkdown}
            richFeatures={richFeatures}
            rawLlmOutput={
              isRepeatedToolUseResponseFailure(message)
                ? rawLlmOutputSinceLastUser(messages, index)
                : null
            }
          />
        ))}
      </section>
      <AttachmentPreviewModal
        attachment={previewTarget?.attachment ?? null}
        onClose={() => setPreviewTarget(null)}
        onCopySuccess={onCopySuccess}
        onSaveAttachment={async (updatedAttachment) => {
          await previewTarget?.onSaveAttachment(updatedAttachment);
          setPreviewTarget((current) =>
            current ? { ...current, attachment: updatedAttachment } : current,
          );
        }}
      />
    </>
  );
}

function ChatBubble({
  compactTopSpacing,
  disabled,
  message,
  onCopySuccess,
  onDeleteMessage,
  onEditMessage,
  onOpenSubAgent,
  onOpenSubAgentId,
  onPreviewAttachment,
  onRetryMessage,
  onTerminateCommand,
  onUpdateAttachment,
  readOnly,
  rawLlmOutput,
  renderMarkdown,
  richFeatures,
  showFooter,
  showHeader,
}: {
  compactTopSpacing: boolean;
  disabled: boolean;
  message: ChatUiMessage;
  onCopySuccess(message: string): void;
  onDeleteMessage(messageId: string): Promise<void>;
  onEditMessage(
    messageId: string,
    content: string,
    attachments: ChatAttachment[] | undefined,
  ): Promise<void>;
  onOpenSubAgent?(subAgent: ChatSubAgentReference): void;
  onOpenSubAgentId?(subSessionId: string): void;
  onPreviewAttachment(target: AttachmentPreviewTarget): void;
  onRetryMessage(messageId: string): Promise<void>;
  onTerminateCommand?(toolCall: ChatToolCall): Promise<void>;
  onUpdateAttachment(messageId: string, attachment: ChatAttachment): Promise<void>;
  readOnly: boolean;
  rawLlmOutput: string | null;
  renderMarkdown: boolean;
  richFeatures: RichFeatureSettingsSummary;
  showFooter: boolean;
  showHeader: boolean;
}) {
  const isUser = message.role === "user";
  const systemEvent = systemEventMessage(message);
  const speakerLabel = isUser ? "You" : assistantMessageLabel(message);
  const visibleContent = isUser
    ? message.content
    : stripMarkdownFollowUps(message.content, richFeatures);
  const renderMessageMarkdown = renderMarkdown && message.generated?.kind !== "sub_agent_completion";
  const [actionPending, setActionPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const mutationDisabled = readOnly || disabled || actionPending || message.status === "thinking";
  const hasAttachments = Boolean(message.attachments?.length);
  const hasBody = Boolean(visibleContent || hasAttachments || message.status === "error");
  const hasWideContent =
    renderMessageMarkdown && !isUser && markdownContainsWideContent(visibleContent, richFeatures);
  const hasThinking = !isUser && hasVisibleThinking(message.thinking);
  const hideSubAgentCompletion =
    renderMarkdown && message.generated?.kind === "sub_agent_completion";
  const hasMessageBody = isUser || editing || hasBody;
  const showArticle = hasMessageBody || hasThinking;
  const showThinkingSpinner =
    !isUser && message.status === "thinking" && !message.thinking && !message.content;
  const thinkingDisclosure = hasThinking && message.thinking ? (
    <ThinkingDisclosure
      active={message.status === "thinking"}
      disabled={mutationDisabled}
      message={message}
      onCopyThinking={() => void handleCopyThinking()}
      onDelete={() => void handleDelete()}
      onEdit={() => setEditing(true)}
      onOpenSubAgent={onOpenSubAgent}
      onRetry={() => void handleRetry()}
      onTerminateCommand={onTerminateCommand}
      readOnly={readOnly}
      renderMarkdown={renderMessageMarkdown}
      richFeatures={richFeatures}
      thinking={message.thinking}
    />
  ) : null;

  async function handleDelete(): Promise<void> {
    setActionPending(true);

    try {
      await onDeleteMessage(message.id);
    } catch {
      // The parent restores the message and reports the API error.
    } finally {
      setActionPending(false);
    }
  }

  async function handleRetry(): Promise<void> {
    setActionPending(true);

    try {
      await onRetryMessage(message.id);
    } catch {
      // Retry failures are rendered as assistant error messages.
    } finally {
      setActionPending(false);
    }
  }

  async function handleCopyMarkdown(): Promise<void> {
    await copyTextToClipboard(formatMessageMarkdown(message));
    onCopySuccess("Message copied to clipboard.");
  }

  async function handleCopyThinking(): Promise<void> {
    await copyTextToClipboard(message.thinking?.content ?? "");
    onCopySuccess("Thinking copied to clipboard.");
  }

  if (hideSubAgentCompletion) {
    return null;
  }

  if (systemEvent) {
    return (
      <SystemEventLine
        createdAt={message.createdAt}
        messageId={message.id}
        showTimestamp={systemEvent.showTimestamp}
        text={systemEvent.text}
        tone={systemEvent.tone}
      />
    );
  }

  if (!isUser && isAssistantCompletionError(message) && !editing) {
    return (
      <div
        className={[
          "truss-message-pop mr-auto grid w-full max-w-[44rem] gap-1 text-sm leading-6",
          compactTopSpacing ? "!mt-0" : "",
        ].join(" ")}
        data-message-id={message.id}
      >
        <AssistantCompletionErrorCard
          disabled={mutationDisabled}
          message={message}
          onCopy={() => void handleCopyMarkdown()}
          onDelete={() => void handleDelete()}
          onEdit={() => setEditing(true)}
          onRetry={() => void handleRetry()}
          readOnly={readOnly}
          renderMarkdown={renderMessageMarkdown}
          richFeatures={richFeatures}
          showHeader={showHeader}
          speakerLabel={speakerLabel}
          thinkingDisclosure={thinkingDisclosure}
          rawLlmOutput={rawLlmOutput}
        />
      </div>
    );
  }

  return (
    <div
      className={[
        "truss-message-pop grid gap-1 text-sm leading-6",
        compactTopSpacing ? "!mt-0" : "",
        isUser
          ? "ml-auto max-w-[86%]"
          : hasWideContent
            ? "truss-assistant-response mr-auto w-full max-w-full"
            : "truss-assistant-response mr-auto max-w-[86%]",
      ].join(" ")}
      data-message-id={message.id}
    >
      {showThinkingSpinner ? <ThinkingSpinner /> : null}
      {showArticle ? (
        <article
          className={[
            "group/message rounded-sm px-4 py-3",
            !isUser && !showHeader ? "pt-0" : "",
            !isUser && !showFooter ? "pb-0" : "",
            isUser
              ? "border border-secondary-container bg-secondary-container/55"
              : "bg-transparent",
            isUser && message.status === "error" ? "border-error-container bg-error-container/30" : "",
          ].join(" ")}
        >
          {showHeader ? (
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="truncate text-[11px] font-medium uppercase text-on-surface-variant">
                {speakerLabel}
              </span>
              <time
                className="shrink-0 text-[11px] font-medium text-on-surface-variant/75"
                dateTime={message.createdAt}
              >
                {formatMessageTimestamp(message.createdAt)}
              </time>
            </div>
          ) : null}
          {thinkingDisclosure ? (
            <div className={hasMessageBody ? "mb-3" : ""}>{thinkingDisclosure}</div>
          ) : null}
          {editing ? (
            <MessageEditForm
              allowAttachmentEdits={isUser}
              disabled={actionPending}
              message={message}
              onCancel={() => setEditing(false)}
              onPreviewAttachment={onPreviewAttachment}
              onSave={(content, attachments) => onEditMessage(message.id, content, attachments)}
            />
          ) : (
            <>
              {message.generated ? (
                <GeneratedMessagePrefix
                  generated={message.generated}
                  onOpenSubAgentId={onOpenSubAgentId}
                />
              ) : null}
              {visibleContent ? (
                <RenderedMessageText
                  renderMarkdown={renderMessageMarkdown}
                  richFeatures={richFeatures}
                  source={visibleContent}
                />
              ) : null}
              {message.attachments?.length ? (
                <ChatAttachmentList
                  attachments={message.attachments}
                  onOpenAttachment={(attachment) =>
                    onPreviewAttachment({
                      attachment,
                      onSaveAttachment: (updatedAttachment) =>
                        onUpdateAttachment(message.id, updatedAttachment),
                    })
                  }
                />
              ) : null}
            </>
          )}
          {hasMessageBody && showFooter ? (
            <div
              className={[
                "mt-2 flex items-center gap-0.5 overflow-visible border-t pt-1 text-on-surface-variant",
                isUser
                  ? "justify-end border-outline-variant/50"
                  : "justify-start border-transparent",
              ].join(" ")}
            >
              <MessageActionButton
                icon="content_copy"
                label="Copy as markdown"
                onClick={() => void handleCopyMarkdown()}
              />
              {!readOnly ? (
                <>
                  <MessageActionButton
                    disabled={mutationDisabled}
                    icon="edit"
                    label="Edit"
                    onClick={() => setEditing(true)}
                  />
                  <MessageActionButton
                    disabled={mutationDisabled}
                    icon="delete"
                    label="Delete"
                    onClick={() => void handleDelete()}
                  />
                  {!isUser ? (
                    <MessageActionButton
                      disabled={mutationDisabled}
                      icon="refresh"
                      label="Retry"
                      onClick={() => void handleRetry()}
                    />
                  ) : null}
                </>
              ) : null}
              <MessageInformationButton message={message} />
            </div>
          ) : null}
        </article>
      ) : null}
    </div>
  );
}

const TRUSS_ERROR_IMAGE_SRC = "/truss-error.webp";
const ASSISTANT_COMPLETION_ERROR_PREFIXES = [
  "I couldn't complete the requested tool use because the model's tool-use response kept failing.",
  "I couldn't complete the requested tool use because one or more tool calls failed.",
  "I stopped tool use because the reasoning budget was exhausted.",
  "The tool calls completed, but I couldn't finish the final model response.",
];
const REPEATED_TOOL_USE_RESPONSE_FAILURE_PREFIX =
  "I couldn't complete the requested tool use because the model's tool-use response kept failing.";

function isAssistantCompletionError(message: ChatUiMessage): boolean {
  if (message.status === "error") {
    return true;
  }

  const content = message.content.trimStart();

  return ASSISTANT_COMPLETION_ERROR_PREFIXES.some((prefix) => content.startsWith(prefix));
}

function isRepeatedToolUseResponseFailure(message: ChatUiMessage): boolean {
  return message.content.trimStart().startsWith(REPEATED_TOOL_USE_RESPONSE_FAILURE_PREFIX);
}

function rawLlmOutputSinceLastUser(messages: ChatUiMessage[], messageIndex: number): string {
  const activeTurnStart = messages
    .slice(0, messageIndex)
    .map((message) => message.role)
    .lastIndexOf("user");
  const assistantMessages = messages
    .slice(activeTurnStart + 1, messageIndex)
    .filter((message) => message.role === "assistant")
    .map((message) => ({
      content: message.content,
      ...(message.thinking ? { thinking: message.thinking } : {}),
    }));
  const failedMessageThinking = messages[messageIndex]?.thinking;

  if (failedMessageThinking) {
    assistantMessages.push({ content: "", thinking: failedMessageThinking });
  }

  return JSON.stringify({ messages: assistantMessages }, null, 2);
}

function AssistantCompletionErrorCard({
  disabled,
  message,
  onCopy,
  onDelete,
  onEdit,
  onRetry,
  readOnly,
  renderMarkdown,
  richFeatures,
  showHeader,
  speakerLabel,
  thinkingDisclosure,
  rawLlmOutput,
}: {
  disabled: boolean;
  message: ChatUiMessage;
  onCopy(): void;
  onDelete(): void;
  onEdit(): void;
  onRetry(): void;
  readOnly: boolean;
  renderMarkdown: boolean;
  richFeatures: RichFeatureSettingsSummary;
  showHeader: boolean;
  speakerLabel: string;
  thinkingDisclosure: ReactNode;
  rawLlmOutput: string | null;
}) {
  const messageText =
    message.content.trim() || "The completion failed before Truss received an error message.";

  return (
    <article
      className="overflow-hidden rounded-sm border border-[#d18a00] bg-surface-container-low text-on-surface shadow-[0_18px_44px_rgb(27_28_25/0.12)]"
      role="alert"
    >
      <img
        alt=""
        aria-hidden="true"
        className="h-8 object-cover mt-2 ml-2"
        draggable={false}
        src={TRUSS_ERROR_IMAGE_SRC}
      />
      <div className="grid gap-4 px-4 py-4 pt-0 sm:px-5">
        {showHeader ? (
          <div className="flex min-w-0 items-center justify-between gap-3 text-[11px] font-medium uppercase text-on-surface-variant">
            <span className="truncate">{speakerLabel}</span>
            <time
              className="shrink-0 text-on-surface-variant/75"
              dateTime={message.createdAt}
            >
              {formatMessageTimestamp(message.createdAt)}
            </time>
          </div>
        ) : null}
        {thinkingDisclosure ? <div>{thinkingDisclosure}</div> : null}
        <div className="grid gap-2">
          <div className="flex min-w-0 items-center gap-2 text-[#8a5a00]">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-[#fff3cf] text-[#8a5a00]">
              <MaterialIcon fill name="error" size={18} />
            </span>
            <h3 className="min-w-0 text-sm font-semibold">Completion error</h3>
          </div>
          <div className="min-w-0 rounded-sm border border-[#d18a00]/60 bg-surface-container-lowest/70 px-3 py-3 text-sm leading-6 text-on-surface">
            <RenderedMessageText
              renderMarkdown={renderMarkdown}
              richFeatures={richFeatures}
              source={messageText}
            />
          </div>
          {rawLlmOutput ? (
            <details className="truss-disclosure rounded-sm border border-[#d18a00]/60 bg-surface-container-lowest/50 px-3 py-2">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-on-surface marker:hidden">
                <span>Raw LLM output</span>
                <span className="truss-disclosure-icon text-lg leading-none text-on-surface-variant">
                  +
                </span>
              </summary>
              <pre className="mt-3 max-h-96 overflow-auto rounded-sm bg-inverse-surface p-3 text-xs leading-5 text-inverse-on-surface">
                <code className="language-json">{highlightCode(rawLlmOutput, "json")}</code>
              </pre>
            </details>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#d18a00]/60 pt-3">
          <button
            className="inline-flex h-9 items-center gap-2 rounded-sm border border-[#8a5a00] bg-[#d18a00] px-3 text-sm font-semibold text-primary transition hover:bg-[#e1a20c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a5a00] disabled:cursor-not-allowed disabled:opacity-45"
            disabled={disabled}
            onClick={onRetry}
            type="button"
          >
            <MaterialIcon name="refresh" size={17} />
            <span>Try again</span>
          </button>
          <div className="flex items-center gap-0.5 text-on-surface-variant">
            <MessageActionButton
              icon="content_copy"
              label="Copy as markdown"
              onClick={onCopy}
            />
            {!readOnly ? (
              <>
                <MessageActionButton
                  disabled={disabled}
                  icon="edit"
                  label="Edit"
                  onClick={onEdit}
                />
                <MessageActionButton
                  disabled={disabled}
                  icon="delete"
                  label="Delete"
                  onClick={onDelete}
                />
              </>
            ) : null}
            <MessageInformationButton message={message} />
          </div>
        </div>
      </div>
    </article>
  );
}

function RenderedMessageText({
  renderMarkdown,
  richFeatures,
  source,
}: {
  renderMarkdown: boolean;
  richFeatures: RichFeatureSettingsSummary;
  source: string;
}) {
  if (renderMarkdown) {
    return <MarkdownView richFeatures={richFeatures} source={source} />;
  }

  return (
    <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {source}
    </div>
  );
}

const TRUSS_SYSTEM_EVENT_PREFIX = "[Truss system event]:";

interface SystemEventPresentation {
  showTimestamp: boolean;
  text: string;
  tone: "default" | "timer";
}

function hasVisibleThinking(thinking: ChatThinking | null | undefined): boolean {
  return Boolean(thinking?.content.trim() || thinking?.toolCalls?.length);
}

function shouldShowMessageHeader(messages: ChatUiMessage[], index: number): boolean {
  const message = messages[index];

  if (!message || !isGroupedAssistantMessage(message)) {
    return true;
  }

  return !isGroupedAssistantMessage(messages[index - 1]);
}

function shouldCollapseMessageTopSpacing(messages: ChatUiMessage[], index: number): boolean {
  const message = messages[index];

  return Boolean(message && isGroupedAssistantMessage(message) && isGroupedAssistantMessage(messages[index - 1]));
}

function shouldShowMessageFooter(messages: ChatUiMessage[], index: number): boolean {
  const message = messages[index];

  if (!message || !isGroupedAssistantMessage(message)) {
    return true;
  }

  return !isGroupedAssistantMessage(messages[index + 1]);
}

function isGroupedAssistantMessage(message: ChatUiMessage | undefined): boolean {
  return Boolean(
    message &&
      message.role === "assistant" &&
      message.generated?.kind !== "sub_agent_completion" &&
      !systemEventMessage(message),
  );
}

function systemEventMessage(message: ChatUiMessage): SystemEventPresentation | null {
  if (
    message.generated?.kind !== "timer" &&
    !message.content.startsWith(TRUSS_SYSTEM_EVENT_PREFIX)
  ) {
    return null;
  }

  const text = message.content.startsWith(TRUSS_SYSTEM_EVENT_PREFIX)
    ? message.content.slice(TRUSS_SYSTEM_EVENT_PREFIX.length).trim()
    : message.content.trim();

  const displayText = text || "Truss system event";
  const timerEvent =
    message.generated?.kind === "timer" || displayText.startsWith("Timer set for ");

  return {
    showTimestamp:
      !timerEvent,
    text: displayText,
    tone: timerEvent ? "timer" : "default",
  };
}

function SystemEventLine({
  createdAt,
  messageId,
  showTimestamp,
  text,
  tone,
}: {
  createdAt: string;
  messageId: string;
  showTimestamp: boolean;
  text: string;
  tone: "default" | "timer";
}) {
  const timestamp = formatMessageTimestamp(createdAt);

  return (
    <div
      className={[
        "truss-message-pop mx-auto flex max-w-[86%] flex-wrap items-baseline justify-center gap-x-2 gap-y-1 text-center text-xs leading-5 text-on-surface-variant",
        tone === "timer" ? "truss-timer-event-pop" : "",
      ].join(" ")}
      data-message-id={messageId}
    >
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{text}</span>
      {showTimestamp && timestamp ? (
        <time
          className="shrink-0 text-[11px] text-on-surface-variant/70"
          dateTime={createdAt}
        >
          {timestamp}
        </time>
      ) : null}
    </div>
  );
}

function GeneratedMessagePrefix({
  generated,
  onOpenSubAgentId,
}: {
  generated: NonNullable<ChatUiMessage["generated"]>;
  onOpenSubAgentId?(subSessionId: string): void;
}) {
  if (generated.kind === "timer") {
    return (
      <div className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-sm bg-tertiary-container/60 px-2 py-1 text-xs font-medium text-tertiary">
        <MaterialIcon name="timer" size={15} />
        <span className="truncate">
          {generated.label ? `[Timer: ${generated.label}]` : "[Timer]"}
        </span>
      </div>
    );
  }

  return (
    <div className="mb-2 flex max-w-full flex-wrap items-center gap-2 text-xs font-medium text-primary">
      <span className="inline-flex min-w-0 items-center gap-1.5 rounded-sm bg-primary-container/70 px-2 py-1">
        <MaterialIcon name="smart_toy" size={15} />
        <span className="truncate">Sub-agent complete</span>
      </span>
      {onOpenSubAgentId ? (
        <button
          className="inline-flex items-center gap-1 rounded-sm border border-outline-variant px-2 py-1 text-on-surface-variant transition hover:border-outline hover:text-on-surface focus-visible:border-outline focus-visible:outline-none"
          onClick={() => onOpenSubAgentId(generated.subSessionId)}
          type="button"
        >
          <MaterialIcon name="open_in_full" size={14} />
          Open sub-agent
        </button>
      ) : null}
    </div>
  );
}

function MessageEditForm({
  allowAttachmentEdits,
  disabled,
  message,
  onCancel,
  onPreviewAttachment,
  onSave,
}: {
  allowAttachmentEdits: boolean;
  disabled: boolean;
  message: ChatUiMessage;
  onCancel(): void;
  onPreviewAttachment(target: AttachmentPreviewTarget): void;
  onSave(content: string, attachments: ChatAttachment[] | undefined): Promise<void>;
}) {
  const [draft, setDraft] = useState(message.content);
  const [existingAttachments, setExistingAttachments] = useState<ChatAttachment[]>(
    message.attachments ?? [],
  );
  const [newAttachments, setNewAttachments] = useState<ComposerAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<AttachmentErrorState | null>(null);
  const [imageConfirmation, setImageConfirmation] =
    useState<LargeImageAttachmentConfirmationState | null>(null);
  const [confirmedImageAttachmentIds, setConfirmedImageAttachmentIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [pending, setPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasChanges =
    draft !== message.content ||
    (allowAttachmentEdits &&
      !chatAttachmentsEqual(existingAttachments, message.attachments ?? [])) ||
    newAttachments.length > 0;
  const hasAnyResultingContent =
    draft.trim().length > 0 || existingAttachments.length > 0 || newAttachments.length > 0;
  const saveDisabled = disabled || pending || !hasChanges || !hasAnyResultingContent;

  function handleNewAttachmentsChange(nextAttachments: ComposerAttachment[]): void {
    setNewAttachments(nextAttachments);
    setImageConfirmation(null);
    setConfirmedImageAttachmentIds(new Set());
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const files = event.target.files;

    if (!files || disabled || pending || !allowAttachmentEdits) {
      return;
    }

    const result = selectComposerAttachments(files);

    if (result.rejections.length > 0) {
      setAttachmentError(attachmentErrorFromRejections(result.rejections));
    } else {
      setAttachmentError(null);
    }

    if (result.attachments.length > 0) {
      setNewAttachments((current) => [...current, ...result.attachments]);
      setImageConfirmation(null);
      setConfirmedImageAttachmentIds(new Set());
    }

    event.target.value = "";
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await saveEdit();
  }

  async function saveEdit(
    confirmedImageIds: ReadonlySet<string> = confirmedImageAttachmentIds,
  ): Promise<void> {
    if (saveDisabled) {
      return;
    }

    setPending(true);

    try {
      const addedAttachments = await createChatAttachments(newAttachments, {
        confirmedImageAttachmentIds: confirmedImageIds,
      });
      const nextAttachments = [...existingAttachments, ...addedAttachments];

      await onSave(draft, nextAttachments.length > 0 ? nextAttachments : undefined);
      onCancel();
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
      setPending(false);
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
    void saveEdit(nextConfirmedImageAttachmentIds);
  }

  return (
    <form className="grid gap-3" onSubmit={(event) => void submitEdit(event)}>
      <FileDropTextarea
        allowAttachments={allowAttachmentEdits}
        attachments={newAttachments}
        attachmentError={attachmentError}
        compact
        disabled={disabled || pending}
        label="Edit message"
        onAttachmentError={setAttachmentError}
        onAttachmentErrorDismiss={() => setAttachmentError(null)}
        onAttachmentsChange={handleNewAttachmentsChange}
        onChange={setDraft}
        onSubmitRequested={() => void saveEdit()}
        placeholder="Edit message"
        rows={3}
        value={draft}
      />

      {allowAttachmentEdits && existingAttachments.length > 0 ? (
        <div className="grid gap-2 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-medium uppercase text-on-surface-variant">
              Current attachments
            </span>
            <span className="text-xs text-on-surface-variant">
              {existingAttachments.length}
            </span>
          </div>
          <div className="grid gap-2">
            {existingAttachments.map((attachment) => (
              <EditableAttachmentChip
                attachment={attachment}
                disabled={disabled || pending}
                key={attachment.id}
                onOpen={() =>
                  onPreviewAttachment({
                    attachment,
                    onSaveAttachment: (updatedAttachment) => {
                      setExistingAttachments((current) =>
                        current.map((item) =>
                          item.id === updatedAttachment.id ? updatedAttachment : item,
                        ),
                      );
                    },
                  })
                }
                onRemove={() =>
                  setExistingAttachments((current) =>
                    current.filter((item) => item.id !== attachment.id),
                  )
                }
              />
            ))}
          </div>
        </div>
      ) : null}

      {imageConfirmation ? (
        <LargeImageAttachmentConfirmation
          confirmation={imageConfirmation}
          disabled={pending}
          onCancel={() => setImageConfirmation(null)}
          onConfirm={confirmLargeImageAttachment}
        />
      ) : null}

      <div className="flex flex-col gap-2 border-t border-outline-variant/60 pt-2 sm:flex-row sm:items-center sm:justify-between">
        {allowAttachmentEdits ? (
          <>
            <input
              accept={SUPPORTED_ATTACHMENT_ACCEPT}
              className="hidden"
              multiple
              onChange={handleFileInputChange}
              ref={fileInputRef}
              type="file"
            />
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-sm border border-outline-variant bg-surface px-3 text-xs font-semibold text-on-surface-variant transition hover:border-outline hover:bg-surface-container-low hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
              disabled={disabled || pending}
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              <MaterialIcon name="attach_file" size={17} />
              Attach files
            </button>
          </>
        ) : (
          <span />
        )}
        <div className="flex justify-end gap-1">
          <MessageActionButton
            disabled={disabled || pending}
            icon="close"
            label="Cancel edit"
            onClick={onCancel}
          />
          <MessageActionButton
            disabled={saveDisabled}
            icon={pending ? "hourglass_top" : "check"}
            label={pending ? "Saving edit" : "Save edit"}
            type="submit"
          />
        </div>
      </div>
    </form>
  );
}

function EditableAttachmentChip({
  attachment,
  disabled,
  onOpen,
  onRemove,
}: {
  attachment: ChatAttachment;
  disabled: boolean;
  onOpen(): void;
  onRemove(): void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-sm border border-outline-variant bg-surface px-2 py-2 text-xs text-on-surface">
      <button
        className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1 py-1 text-left transition hover:bg-surface-container-low hover:text-primary"
        disabled={disabled}
        onClick={onOpen}
        type="button"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-sm bg-surface-container-high text-on-surface-variant">
          <MaterialIcon name={iconForChatAttachment(attachment)} size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{attachment.name}</span>
          <span className="block truncate text-on-surface-variant">
            {attachment.mimeType || "File"} / {formatFileSize(attachment.size)}
          </span>
        </span>
      </button>
      <button
        aria-label={`Remove ${attachment.name}`}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-on-surface-variant transition hover:bg-surface-container-high hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
        disabled={disabled}
        onClick={onRemove}
        type="button"
      >
        <MaterialIcon name="close" size={17} />
      </button>
    </div>
  );
}

function MessageActionButton({
  disabled,
  icon,
  label,
  onClick,
  size = "compact",
  type = "button",
}: {
  disabled?: boolean;
  icon: string;
  label: string;
  onClick?(): void;
  size?: "compact" | "regular";
  type?: "button" | "submit";
}) {
  const sizeClass = size === "regular" ? "h-8 w-8" : "h-7 w-7";
  const iconSize = size === "regular" ? 18 : 16;

  return (
    <button
      aria-label={label}
      className={[
        "group/message-action relative grid place-items-center rounded-sm transition hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-40",
        sizeClass,
      ].join(" ")}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type={type}
    >
      <MaterialIcon name={icon} size={iconSize} />
      <span className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-40 w-max max-w-44 -translate-x-1/2 translate-y-1 rounded-sm border border-outline-variant bg-surface px-2 py-1 text-xs font-medium text-on-surface opacity-0 shadow-[0_10px_24px_rgb(27_28_25/0.14)] transition group-hover/message-action:translate-y-0 group-hover/message-action:opacity-100 group-focus-visible/message-action:translate-y-0 group-focus-visible/message-action:opacity-100">
        {label}
      </span>
    </button>
  );
}

function MessageInformationButton({
  message,
  size = "compact",
}: {
  message: ChatUiMessage;
  size?: "compact" | "regular";
}) {
  const rows = messageInformationRows(message);
  const sizeClass = size === "regular" ? "h-8 w-8" : "h-7 w-7";
  const iconSize = size === "regular" ? 18 : 16;
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  function updatePanelPosition(): void {
    const button = buttonRef.current;

    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const panelWidth = panelRef.current?.offsetWidth ?? 288;
    const panelHeight = panelRef.current?.offsetHeight ?? 180;
    const gap = 8;
    const margin = 12;
    const maxLeft = Math.max(margin, window.innerWidth - panelWidth - margin);
    const left = Math.min(Math.max(margin, rect.right - panelWidth), maxLeft);
    const topAbove = rect.top - panelHeight - gap;
    const topBelow = rect.bottom + gap;
    const maxTop = Math.max(margin, window.innerHeight - panelHeight - margin);
    const top = topAbove >= margin ? topAbove : Math.min(Math.max(margin, topBelow), maxTop);

    setPosition({ left, top });
  }

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    updatePanelPosition();
  }, [open, rows.length]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target as Node | null;

      if (!target) {
        return;
      }

      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }

      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        aria-label="Message information"
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        className={[
          "truss-message-info-summary group/message-info-trigger relative grid cursor-pointer list-none place-items-center rounded-sm transition hover:bg-surface-container",
          sizeClass,
        ].join(" ")}
        onClick={() => setOpen((current) => !current)}
        ref={buttonRef}
        title="Message information"
        type="button"
      >
        <MaterialIcon name="info" size={iconSize} />
        <span className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-40 w-max max-w-44 -translate-x-1/2 translate-y-1 rounded-sm border border-outline-variant bg-surface px-2 py-1 text-xs font-medium text-on-surface opacity-0 shadow-[0_10px_24px_rgb(27_28_25/0.14)] transition group-hover/message-info-trigger:translate-y-0 group-hover/message-info-trigger:opacity-100 group-focus-visible/message-info-trigger:translate-y-0 group-focus-visible/message-info-trigger:opacity-100">
          Message information
        </span>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-label="Message information"
              className="fixed z-[220] grid w-72 max-w-[calc(100vw-3rem)] gap-2 rounded-sm border border-outline-variant bg-surface px-3 py-3 text-xs leading-5 text-on-surface shadow-[0_16px_38px_rgb(27_28_25/0.14)]"
              id={panelId}
              ref={panelRef}
              role="dialog"
              style={
                position
                  ? { left: `${position.left}px`, top: `${position.top}px` }
                  : { left: 0, top: 0, visibility: "hidden" }
              }
            >
              {rows.map((row) => (
                <div className="grid grid-cols-[7rem_1fr] gap-3" key={row.label}>
                  <span className="text-on-surface-variant">{row.label}</span>
                  <span className="min-w-0 break-words font-medium text-on-surface">
                    {row.value}
                  </span>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function ThinkingSpinner() {
  return (
    <div className="flex items-center gap-3 text-on-surface-variant">
      <span className="truss-spinner h-4 w-4 rounded-full border-2 border-outline-variant border-t-primary" />
      <span>Thinking...</span>
    </div>
  );
}

function ThinkingDisclosure({
  active,
  disabled,
  message,
  onCopyThinking,
  onDelete,
  onEdit,
  onOpenSubAgent,
  onRetry,
  onTerminateCommand,
  readOnly,
  renderMarkdown,
  richFeatures,
  thinking,
}: {
  active: boolean;
  disabled: boolean;
  message: ChatUiMessage;
  onCopyThinking(): void;
  onDelete(): void;
  onEdit(): void;
  onOpenSubAgent?(subAgent: ChatSubAgentReference): void;
  onRetry(): void;
  onTerminateCommand?(toolCall: ChatToolCall): Promise<void>;
  readOnly: boolean;
  renderMarkdown: boolean;
  richFeatures: RichFeatureSettingsSummary;
  thinking: ChatThinking;
}) {
  const [selectedToolCall, setSelectedToolCall] = useState<ChatToolCall | null>(null);
  const toolCalls = thinking.toolCalls ?? [];
  const toolTurnGroups = groupToolCallsByTurn(toolCalls);
  const hasThinkingContent = thinking.content.trim().length > 0;
  const hasSegmentedToolThinking = toolCalls.some(hasToolCallThinking);
  const standaloneThinkingBlocks = hasSegmentedToolThinking
    ? standaloneThinkingBlocksForToolCalls(thinking.content, toolTurnGroups)
    : [];
  const summaryProgressToolCall = visibleToolProgressCall(toolCalls);

  useEffect(() => {
    if (!selectedToolCall) {
      return;
    }

    const updatedToolCall = toolCalls.find((toolCall) => toolCall.id === selectedToolCall.id);

    if (updatedToolCall && updatedToolCall !== selectedToolCall) {
      setSelectedToolCall(updatedToolCall);
    }
  }, [selectedToolCall, toolCalls]);

  return (
    <>
      <details className="truss-disclosure truss-thinking-panel rounded-sm border border-transparent bg-transparent py-2 pl-0 pr-3 transition-[background-color,border-color,padding-left] hover:pl-3 hover:border-outline-variant hover:bg-surface-container-low/65 focus-within:pl-3 focus-within:border-outline-variant focus-within:bg-surface-container-low/65">
        <summary className="grid cursor-pointer list-none gap-2 text-xs font-medium text-on-surface-variant">
          <span className="flex min-w-0 items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              {active ? (
                <span className="truss-spinner h-3 w-3 shrink-0 rounded-full border-2 border-outline-variant border-t-primary" />
              ) : null}
              <span className="min-w-0 truncate">
                {thinkingSummaryLabel({
                  active,
                  durationMs: messageThinkingDurationMs(message),
                  thinking,
                  toolCalls,
                })}
              </span>
            </span>
            <MaterialIcon className="truss-disclosure-icon shrink-0" name="add" size={17} />
          </span>
          {summaryProgressToolCall ? (
            <ToolCallProgressLine compact toolCall={summaryProgressToolCall} />
          ) : null}
        </summary>

        {toolTurnGroups.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {toolTurnGroups.map((group) => {
              const thinkingAfter = group.thinkingAfter;

              return (
                <div className="grid gap-2" key={group.key}>
                  <div className="grid gap-1.5">
                    {group.toolCalls.map((toolCall) =>
                      toolCall.subAgent ? (
                        <SubAgentChip
                          key={toolCall.id}
                          onOpen={() => onOpenSubAgent?.(toolCall.subAgent!)}
                          subAgent={toolCall.subAgent}
                        />
                      ) : (
                        <ToolCallRowButton
                          key={toolCall.id}
                          onOpen={() => setSelectedToolCall(toolCall)}
                          onTerminateCommand={onTerminateCommand}
                          toolCall={toolCall}
                        />
                      ),
                    )}
                  </div>
                  {thinkingAfter ? (
                    <ToolThinkingTextBlock
                      renderMarkdown={renderMarkdown}
                      richFeatures={richFeatures}
                      value={thinkingAfter}
                    />
                  ) : null}
                </div>
              );
            })}
            {standaloneThinkingBlocks.map((block, index) => (
              <ToolThinkingTextBlock
                key={`standalone-${index}`}
                renderMarkdown={renderMarkdown}
                richFeatures={richFeatures}
                value={block}
              />
            ))}
          </div>
        ) : null}

        {hasThinkingContent && !hasSegmentedToolThinking ? (
          <div className="truss-disclosure-panel truss-reasoning-markdown mt-3 min-w-0 rounded-sm bg-transparent py-1 text-on-surface-variant">
            <RenderedMessageText
              renderMarkdown={renderMarkdown}
              richFeatures={richFeatures}
              source={thinking.content}
            />
            {thinking.cutOff ? (
              <p className="mt-2 text-xs italic opacity-60">
                Thinking phase cut off due to reaching the reasoning limit.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="truss-thinking-actions mt-0 flex items-center justify-start gap-0.5 overflow-visible border-t border-transparent pt-0 text-on-surface-variant">
          <MessageActionButton
            icon="content_copy"
            label="Copy thinking"
            onClick={onCopyThinking}
          />
          {!readOnly ? (
            <>
              <MessageActionButton
                disabled={disabled}
                icon="edit"
                label="Edit"
                onClick={onEdit}
              />
              <MessageActionButton
                disabled={disabled}
                icon="delete"
                label="Delete"
                onClick={onDelete}
              />
              <MessageActionButton
                disabled={disabled}
                icon="refresh"
                label="Retry"
                onClick={onRetry}
              />
            </>
          ) : null}
          <MessageInformationButton message={message} />
        </div>
      </details>
      <ToolCallDetailModal
        onClose={() => setSelectedToolCall(null)}
        onTerminateCommand={onTerminateCommand}
        renderMarkdown={renderMarkdown}
        richFeatures={richFeatures}
        toolCall={selectedToolCall}
      />
    </>
  );
}

function ToolThinkingTextBlock({
  renderMarkdown,
  richFeatures,
  value,
}: {
  renderMarkdown: boolean;
  richFeatures: RichFeatureSettingsSummary;
  value: string;
}) {
  return (
    <div className="grid">
      <div className="truss-reasoning-markdown min-w-0 text-on-surface-variant">
        <RenderedMessageText
          renderMarkdown={renderMarkdown}
          richFeatures={richFeatures}
          source={value}
        />
      </div>
    </div>
  );
}

function SubAgentChip({
  onOpen,
  subAgent,
}: {
  onOpen(): void;
  subAgent: ChatSubAgentReference;
}) {
  return (
    <button
      className={[
        "grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-sm border px-3 py-1.5 text-left text-xs transition focus-visible:outline-none",
        subAgent.status === "error"
          ? "border-error-container bg-error-container/25 text-on-error-container hover:border-error/60 hover:bg-error-container/35 focus-visible:border-error/70"
          : "border-outline-variant bg-surface-container-lowest text-on-surface hover:border-outline hover:bg-surface-container-low focus-visible:border-outline",
      ].join(" ")}
      onClick={onOpen}
      title={subAgent.task}
      type="button"
    >
      <MaterialIcon
        className={subAgent.status === "error" ? "shrink-0 text-error" : "shrink-0 text-primary"}
        name="smart_toy"
        size={17}
      />
      <span className="min-w-0 truncate font-semibold">{subAgent.task}</span>
      <span
        className={[
          "inline-flex h-5 items-center gap-1 rounded-sm px-2 text-[10px] font-semibold uppercase leading-none",
          subAgent.status === "running"
            ? "bg-primary-container text-primary"
            : subAgent.status === "error"
              ? "bg-error-container text-error"
              : "bg-tertiary-container text-tertiary",
        ].join(" ")}
      >
        {subAgent.status === "running" ? (
          <span className="truss-spinner h-2.5 w-2.5 rounded-full border-2 border-primary/30 border-t-primary" />
        ) : null}
        {subAgent.status}
      </span>
      <MaterialIcon
        className={subAgent.status === "error" ? "text-error" : "text-on-surface-variant"}
        name="open_in_full"
        size={16}
      />
    </button>
  );
}

function ToolCallRowButton({
  onOpen,
  onTerminateCommand,
  toolCall,
}: {
  onOpen(): void;
  onTerminateCommand?(toolCall: ChatToolCall): Promise<void>;
  toolCall: ChatToolCall;
}) {
  const [terminatePending, setTerminatePending] = useState(false);
  const canTerminate = canTerminateCommand(toolCall, onTerminateCommand);

  async function handleTerminate(): Promise<void> {
    if (!canTerminate || !onTerminateCommand) {
      return;
    }

    setTerminatePending(true);
    try {
      await onTerminateCommand(toolCall);
    } finally {
      setTerminatePending(false);
    }
  }

  return (
    <div className={toolCallRowClass(toolCall.status)} title={toolCall.title}>
      <button
        className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-left focus-visible:outline-none"
        onClick={onOpen}
        type="button"
      >
        <ToolCallRowIcon toolCall={toolCall} />
        <span className="grid min-w-0 gap-1">
          <span className="block min-w-0 truncate font-semibold">{toolCall.title}</span>
          <ToolCallProgressLine toolCall={toolCall} />
        </span>
        <ToolCallTimingBadge toolCall={toolCall} />
      </button>
      {canTerminate ? (
        <button
          aria-label={`Terminate ${toolCall.title}`}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-sm border border-error-container bg-error-container/20 text-error transition hover:bg-error-container/60 focus-visible:bg-error-container/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55"
          disabled={terminatePending}
          onClick={() => void handleTerminate()}
          title="Terminate command"
          type="button"
        >
          {terminatePending ? (
            <span className="truss-spinner h-3.5 w-3.5 rounded-full border-2 border-current/30 border-t-current" />
          ) : (
            <MaterialIcon name="stop" size={16} />
          )}
        </button>
      ) : (
        <MaterialIcon
          className={toolCallOpenIconClass(toolCall.status)}
          name="open_in_full"
          size={16}
        />
      )}
    </div>
  );
}

function ToolCallProgressLine({
  compact = false,
  toolCall,
}: {
  compact?: boolean;
  toolCall: ChatToolCall;
}) {
  const progress = toolCall.progress;
  const percent = clampToolProgressPercent(progress?.percent);
  const hasProgress = Boolean(progress);
  const progressDismissKey = progress
    ? `${toolCall.id}:${toolCall.status}:${percent}:${progress.message ?? ""}`
    : null;
  const shouldDismissProgress = toolCall.status === "error" || percent >= 100;
  const dismissedProgressKeyRef = useRef<string | null>(null);
  const [phase, setPhase] = useState<"visible" | "fading" | "hidden">(
    progress ? "visible" : "hidden",
  );

  useEffect(() => {
    if (!hasProgress || !progressDismissKey) {
      setPhase("hidden");
      return undefined;
    }

    if (shouldDismissProgress && dismissedProgressKeyRef.current === progressDismissKey) {
      setPhase("hidden");
      return undefined;
    }

    setPhase("visible");

    if (!shouldDismissProgress) {
      return undefined;
    }

    const fadeTimer = window.setTimeout(() => setPhase("fading"), 3000);
    const hideTimer = window.setTimeout(() => {
      dismissedProgressKeyRef.current = progressDismissKey;
      setPhase("hidden");
    }, 3300);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(hideTimer);
    };
  }, [hasProgress, progressDismissKey, shouldDismissProgress]);

  if (!progress || phase === "hidden") {
    return null;
  }

  const message = progress.message || toolCallStatusLabel(toolCall);

  return (
    <span
      aria-label={`${message} ${percent}%`}
      className={[
        "grid min-w-0 gap-1 overflow-hidden transition-[max-height,opacity,transform] duration-300",
        compact ? "max-h-9" : "max-h-10",
        phase === "fading" ? "translate-y-0.5 opacity-0" : "translate-y-0 opacity-100",
      ].join(" ")}
    >
      <span className="flex min-w-0 items-center justify-between gap-2 text-[10px] font-medium leading-none text-on-surface-variant">
        <span className="min-w-0 truncate">{message}</span>
        <span className="shrink-0 tabular-nums">{percent}%</span>
      </span>
      <span className="block h-1 w-full overflow-hidden rounded-full bg-outline-variant/50">
        <span
          className="block h-full rounded-full bg-[#22c55e] transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </span>
    </span>
  );
}

function ToolCallRowIcon({ toolCall }: { toolCall: ChatToolCall }) {
  if (toolCall.status === "running") {
    return (
      <span className="grid h-[17px] w-[17px] shrink-0 place-items-center" title="Running">
        <span className="truss-spinner h-3.5 w-3.5 rounded-full border-2 border-primary/30 border-t-primary" />
      </span>
    );
  }

  return (
    <MaterialIcon
      className={["shrink-0", toolCallIconClass(toolCall.status)].join(" ")}
      name={toolCallIcon(toolCall.status)}
      size={17}
    />
  );
}

function ToolCallTimingBadge({ toolCall }: { toolCall: ChatToolCall }) {
  if (toolCall.status === "running") {
    return (
      <span className="grid h-5 w-5 place-items-center" title="Running">
        <span className="truss-spinner h-3 w-3 rounded-full border-2 border-primary/30 border-t-primary" />
      </span>
    );
  }

  return (
    <span
      className={[
        "inline-flex h-5 max-w-20 items-center justify-center rounded-sm px-2 text-[10px] font-semibold leading-none",
        toolCallStatusTextClass(toolCall.status),
      ].join(" ")}
      title={toolCallStatusLabel(toolCall)}
    >
      {toolCallDurationSeconds(toolCall) ?? (toolCall.status === "error" ? "Failed" : "Done")}
    </span>
  );
}

function ToolCallDetailModal({
  onClose,
  onTerminateCommand,
  renderMarkdown,
  richFeatures,
  toolCall,
}: {
  onClose(): void;
  onTerminateCommand?(toolCall: ChatToolCall): Promise<void>;
  renderMarkdown: boolean;
  richFeatures: RichFeatureSettingsSummary;
  toolCall: ChatToolCall | null;
}) {
  const [terminatePending, setTerminatePending] = useState(false);
  const statusLabel = toolCall ? toolCallStatusDetailLabel(toolCall) : undefined;
  const thinkingBefore = trimThinkingSegment(toolCall?.thinkingBefore);
  const resultImage =
    toolResultImagePreviewFromData(toolCall?.imageResult) ??
    (toolCall?.result ? toolResultImagePreview(toolCall.result) : null);
  const canTerminate = toolCall ? canTerminateCommand(toolCall, onTerminateCommand) : false;

  useEffect(() => {
    if (toolCall?.status !== "running") {
      setTerminatePending(false);
    }
  }, [toolCall?.id, toolCall?.status]);

  async function handleTerminate(): Promise<void> {
    if (!toolCall || !canTerminate || !onTerminateCommand) {
      return;
    }

    setTerminatePending(true);
    try {
      await onTerminateCommand(toolCall);
    } finally {
      setTerminatePending(false);
    }
  }

  return (
    <Modal
      bodyClassName="overflow-x-hidden"
      description={statusLabel}
      icon={toolCall ? toolCallIcon(toolCall.status) : "construction"}
      onClose={onClose}
      open={Boolean(toolCall)}
      size="lg"
      title={toolCall?.title ?? "Tool call"}
    >
      {toolCall ? (
        <div className="grid min-w-0 gap-4 text-sm">
          <div className="grid gap-3 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-3 text-xs sm:grid-cols-2">
            <div className="grid gap-2">
              <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                <span className="text-on-surface-variant">Tool</span>
                <span className="min-w-0 break-words font-medium text-on-surface [overflow-wrap:anywhere]">
                  {toolCall.toolId}
                </span>
              </div>
              <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                <span className="text-on-surface-variant">Status</span>
                <span className={toolCallStatusValueClass(toolCall.status)}>
                  {statusLabel}
                </span>
              </div>
            </div>
            <div className="grid gap-2">
              <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                <span className="text-on-surface-variant">Started</span>
                <span className="min-w-0 font-medium text-on-surface">
                  {formatMessageTimestamp(toolCall.startedAt) || "Unavailable"}
                </span>
              </div>
              {toolCall.completedAt ? (
                <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                  <span className="text-on-surface-variant">Completed</span>
                  <span className="min-w-0 font-medium text-on-surface">
                    {formatMessageTimestamp(toolCall.completedAt) || "Unavailable"}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
          {canTerminate ? (
            <div className="flex justify-end">
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-sm border border-error-container bg-error-container/20 px-3 text-xs font-semibold text-error transition hover:bg-error-container/60 focus-visible:bg-error-container/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55"
                disabled={terminatePending}
                onClick={() => void handleTerminate()}
                type="button"
              >
                {terminatePending ? (
                  <span className="truss-spinner h-3.5 w-3.5 rounded-full border-2 border-current/30 border-t-current" />
                ) : (
                  <MaterialIcon name="stop" size={16} />
                )}
                {terminatePending ? "Terminating" : "Terminate command"}
              </button>
            </div>
          ) : null}

          {toolCall.error ? <ToolCallErrorSummary error={toolCall.error} /> : null}
          <ToolCallSecurityBlock toolCall={toolCall} />

          {thinkingBefore ? (
            <ToolCallReasoningBlock
              label="Thinking before call"
              renderMarkdown={renderMarkdown}
              richFeatures={richFeatures}
              value={thinkingBefore}
            />
          ) : null}
          <ToolCallCodeBlock
            label="Arguments"
            language="json"
            value={JSON.stringify(toolCall.args, null, 2)}
          />
          {resultImage ? <ToolCallImageResultPreview image={resultImage} /> : null}
          {toolCall.result ? (
            <ToolCallCodeBlock label="Result" language="json" value={toolCall.result} />
          ) : null}
          {toolCall.error ? (
            <ToolCallCodeBlock label="Error" tone="error" value={toolCall.error} />
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

export function ToolCallSecurityBlock({ toolCall }: { toolCall: ChatToolCall }) {
  const security = toolCall.security?.commandRunner;
  const assessments = [
    { assessment: security?.preExecution, label: "Pre-execution guard" },
    { assessment: security?.postExecution, label: "Post-execution output guard" },
  ].filter((item): item is { assessment: CommandRunnerGuardAssessment; label: string } =>
    Boolean(item.assessment)
  );

  if (assessments.length === 0) {
    return null;
  }

  return (
    <section className="grid min-w-0 gap-2">
      <h3 className="text-xs font-semibold uppercase text-on-surface-variant">Security</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {assessments.map(({ assessment, label }) => (
          <ToolCallGuardAssessmentCard
            assessment={assessment}
            key={label}
            label={label}
          />
        ))}
      </div>
    </section>
  );
}

function ToolCallGuardAssessmentCard({
  assessment,
  label,
}: {
  assessment: CommandRunnerGuardAssessment;
  label: string;
}) {
  const verdict = assessment.verdict;
  const details = verdict?.safetyReasoning || assessment.skippedReason || "";
  const summary = verdict?.tldr || guardAssessmentStatusText(assessment);
  const model = assessment.model
    ? `${assessment.model.providerLabel} / ${assessment.model.modelId}`
    : null;

  return (
    <div className="grid min-w-0 gap-2 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-3 text-xs">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="grid min-w-0 gap-1">
          <span className="font-semibold text-on-surface">{label}</span>
          {model ? (
            <span className="min-w-0 break-words text-on-surface-variant [overflow-wrap:anywhere]">
              {model}
            </span>
          ) : null}
        </div>
        <span className={guardAssessmentBadgeClass(assessment)}>
          {guardAssessmentBadgeLabel(assessment)}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {verdict?.denyOutput ? (
          <span className="inline-flex items-center gap-1 rounded-sm bg-error-container px-1.5 py-0.5 text-[10px] font-semibold uppercase text-error">
            <MaterialIcon name="block" size={12} />
            Output denied
          </span>
        ) : null}
        {verdict?.accessesOutsideWhitelist ? (
          <span className="inline-flex items-center gap-1 rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
            <MaterialIcon name="folder_off" size={12} />
            Outside whitelist
          </span>
        ) : null}
      </div>
      {summary ? (
        <p className="min-w-0 break-words font-semibold leading-5 text-on-surface [overflow-wrap:anywhere]">
          {summary}
        </p>
      ) : null}
      {details ? (
        <p className="min-w-0 break-words leading-5 text-on-surface-variant [overflow-wrap:anywhere]">
          {details}
        </p>
      ) : null}
    </div>
  );
}

function guardAssessmentStatusText(assessment: CommandRunnerGuardAssessment): string {
  if (assessment.verdict) {
    return "Assessed by guard model.";
  }

  if (!assessment.enabled) {
    return "Guard disabled.";
  }

  return "Guard skipped.";
}

function guardAssessmentBadgeLabel(assessment: CommandRunnerGuardAssessment): string {
  if (assessment.verdict) {
    return assessment.verdict.safetyLevel;
  }

  return assessment.enabled ? "skipped" : "disabled";
}

function guardAssessmentBadgeClass(assessment: CommandRunnerGuardAssessment): string {
  const base = "shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase";
  const verdict = assessment.verdict;

  if (!verdict) {
    return assessment.enabled
      ? `${base} bg-surface-container-high text-on-surface-variant`
      : `${base} bg-outline-variant/50 text-on-surface-variant`;
  }

  if (verdict.safetyLevel === "dangerous") {
    return `${base} bg-error-container text-error`;
  }

  if (verdict.safetyLevel === "risky") {
    return `${base} bg-amber-100 text-amber-800`;
  }

  return `${base} bg-emerald-100 text-emerald-700`;
}

function ToolCallImageResultPreview({ image }: { image: ToolResultImagePreview }) {
  return (
    <section className="grid min-w-0 gap-2">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase text-on-surface-variant">Result image</h3>
        <span className="truncate text-xs text-on-surface-variant">{image.contentType}</span>
      </div>
      <div className="min-w-0 overflow-hidden rounded-sm border border-outline-variant bg-surface-container-lowest p-2">
        <img
          alt="Tool result"
          className="max-h-[65vh] w-full rounded-sm object-contain"
          src={image.src}
        />
      </div>
    </section>
  );
}

function ToolCallErrorSummary({ error }: { error: string }) {
  return (
    <section className="flex min-w-0 items-start gap-3 rounded-sm border border-error-container bg-error-container/25 px-3 py-3 text-on-error-container">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-error-container text-error">
        <MaterialIcon name="error" size={18} />
      </span>
      <div className="grid min-w-0 gap-1">
        <h3 className="text-sm font-semibold text-error">Tool call failed</h3>
        <p className="break-words text-sm leading-5 [overflow-wrap:anywhere]">
          {toolCallErrorPreview(error, 700)}
        </p>
      </div>
    </section>
  );
}

function ToolCallReasoningBlock({
  label,
  renderMarkdown,
  richFeatures,
  value,
}: {
  label: string;
  renderMarkdown: boolean;
  richFeatures: RichFeatureSettingsSummary;
  value: string;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "done" | "error">("idle");
  const copyLabel =
    copyStatus === "done"
      ? `${label} copied`
      : copyStatus === "error"
        ? "Copy failed"
        : `Copy ${label.toLowerCase()}`;

  async function handleCopy(): Promise<void> {
    try {
      await copyTextToClipboard(value);
      setCopyStatus("done");
    } catch {
      setCopyStatus("error");
    } finally {
      window.setTimeout(() => setCopyStatus("idle"), 1800);
    }
  }

  return (
    <section className="grid min-w-0 gap-2">
      <h3 className="text-xs font-semibold uppercase text-on-surface-variant">{label}</h3>
      <div className="relative min-w-0">
        <button
          aria-label={copyLabel}
          className="absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-sm border border-outline-variant bg-surface-container-lowest text-on-surface-variant transition hover:bg-surface-container-low hover:text-on-surface focus-visible:bg-surface-container-low focus-visible:text-on-surface focus-visible:outline-none"
          onClick={() => void handleCopy()}
          title={copyLabel}
          type="button"
        >
          <MaterialIcon name={copyStatus === "done" ? "check" : "content_copy"} size={16} />
        </button>
        <div className="truss-reasoning-markdown min-w-0 overflow-x-hidden rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-3 pr-12 text-on-surface-variant">
          <RenderedMessageText
            renderMarkdown={renderMarkdown}
            richFeatures={richFeatures}
            source={value}
          />
        </div>
      </div>
    </section>
  );
}

function ToolCallCodeBlock({
  label,
  language,
  tone = "default",
  value,
}: {
  label: string;
  language?: string;
  tone?: "default" | "error";
  value: string;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "done" | "error">("idle");
  const highlighted = language ? highlightCode(value, language) : value;
  const copyLabel =
    copyStatus === "done"
      ? `${label} copied`
      : copyStatus === "error"
        ? "Copy failed"
        : `Copy ${label.toLowerCase()}`;

  async function handleCopy(): Promise<void> {
    try {
      await copyTextToClipboard(value);
      setCopyStatus("done");
    } catch {
      setCopyStatus("error");
    } finally {
      window.setTimeout(() => setCopyStatus("idle"), 1800);
    }
  }

  return (
    <section className="grid min-w-0 gap-2">
      <h3 className="text-xs font-semibold uppercase text-on-surface-variant">{label}</h3>
      <div className="relative min-w-0">
        <button
          aria-label={copyLabel}
          className={[
            "absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-sm border transition focus-visible:outline-none",
            language
              ? "border-inverse-on-surface/15 bg-inverse-surface/90 text-inverse-on-surface/75 hover:bg-inverse-on-surface/10 hover:text-inverse-on-surface focus-visible:bg-inverse-on-surface/10 focus-visible:text-inverse-on-surface"
              : tone === "error"
                ? "border-error-container bg-error-container text-error hover:bg-error-container/70 focus-visible:bg-error-container/70"
                : "border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface focus-visible:bg-surface-container-low focus-visible:text-on-surface",
          ].join(" ")}
          onClick={() => void handleCopy()}
          title={copyLabel}
          type="button"
        >
          <MaterialIcon name={copyStatus === "done" ? "check" : "content_copy"} size={16} />
        </button>
        <pre
          className={[
            "truss-message-scrollbar max-h-80 min-w-0 max-w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded-sm border px-3 py-3 pr-12 text-xs leading-5 [overflow-wrap:anywhere]",
            language
              ? "border-inverse-surface bg-inverse-surface text-inverse-on-surface"
              : tone === "error"
                ? "border-error-container bg-error-container/20 text-error"
                : "border-outline-variant bg-surface-container-lowest text-on-surface",
          ].join(" ")}
        >
          <code
            className={[
              "block min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
              language ? `language-${language}` : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {highlighted}
          </code>
        </pre>
      </div>
    </section>
  );
}

function toolCallStatusDetailLabel(toolCall: ChatToolCall): string {
  const duration = toolCallDurationSeconds(toolCall);

  if (toolCall.status === "running") {
    return "running";
  }

  if (toolCall.status === "error") {
    return duration ? `failed (${duration})` : "failed";
  }

  return duration ? `completed (${duration})` : "completed";
}

function canTerminateCommand(
  toolCall: ChatToolCall,
  onTerminateCommand: ((toolCall: ChatToolCall) => Promise<void>) | undefined,
): boolean {
  return Boolean(
    onTerminateCommand &&
      toolCall.status === "running" &&
      toolCall.toolId === "run_command" &&
      toolCall.commandExecution?.status === "running",
  );
}

function hasToolCallThinking(toolCall: ChatToolCall): boolean {
  return Boolean(
    trimThinkingSegment(toolCall.thinkingBefore) || trimThinkingSegment(toolCall.thinkingAfter),
  );
}

function visibleToolProgressCall(toolCalls: ChatToolCall[]): ChatToolCall | null {
  for (const toolCall of [...toolCalls].reverse()) {
    if (!toolCall.progress) {
      continue;
    }

    if (toolCall.status === "running" || toolCall.progress.percent >= 100) {
      return toolCall;
    }
  }

  return null;
}

function trimThinkingSegment(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

interface ToolCallTurnGroup {
  key: string;
  thinkingAfter?: string;
  thinkingBefore?: string;
  toolCalls: ChatToolCall[];
  turn: number | null;
}

function groupToolCallsByTurn(toolCalls: ChatToolCall[]): ToolCallTurnGroup[] {
  const groups: ToolCallTurnGroup[] = [];

  for (const toolCall of toolCalls) {
    const turn = normalizedToolTurn(toolCall);
    const thinkingBefore = trimThinkingSegment(toolCall.thinkingBefore);
    const thinkingAfter = trimThinkingSegment(toolCall.thinkingAfter);
    const previous = groups.at(-1);

    if (previous && belongsToToolTurnGroup(previous, turn, thinkingBefore, thinkingAfter)) {
      appendToolCallToTurnGroup(previous, toolCall, thinkingBefore, thinkingAfter);
      continue;
    }

    groups.push({
      key: `${turn ?? "legacy"}-${toolCall.id}-${groups.length}`,
      ...(thinkingAfter ? { thinkingAfter } : {}),
      ...(thinkingBefore ? { thinkingBefore } : {}),
      toolCalls: [toolCall],
      turn,
    });
  }

  return groups;
}

function belongsToToolTurnGroup(
  group: ToolCallTurnGroup,
  turn: number | null,
  thinkingBefore: string,
  thinkingAfter: string,
): boolean {
  if (turn !== null) {
    return group.turn === turn;
  }

  return (
    group.turn === null &&
    (group.thinkingBefore ?? "") === thinkingBefore &&
    (group.thinkingAfter ?? "") === thinkingAfter
  );
}

function appendToolCallToTurnGroup(
  group: ToolCallTurnGroup,
  toolCall: ChatToolCall,
  thinkingBefore: string,
  thinkingAfter: string,
): void {
  group.toolCalls.push(toolCall);

  const mergedThinkingBefore = appendThinkingTextBlock(group.thinkingBefore, thinkingBefore);
  const mergedThinkingAfter = appendThinkingTextBlock(group.thinkingAfter, thinkingAfter);

  if (mergedThinkingBefore) {
    group.thinkingBefore = mergedThinkingBefore;
  }

  if (mergedThinkingAfter) {
    group.thinkingAfter = mergedThinkingAfter;
  }
}

function normalizedToolTurn(toolCall: ChatToolCall): number | null {
  const turn = toolCall.turn;

  return typeof turn === "number" && Number.isInteger(turn) && turn > 0 ? turn : null;
}

function toolCallDurationSeconds(toolCall: ChatToolCall): string | null {
  if (!toolCall.completedAt) {
    return null;
  }

  const startedAt = new Date(toolCall.startedAt).getTime();
  const completedAt = new Date(toolCall.completedAt).getTime();

  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) {
    return null;
  }

  const seconds = (completedAt - startedAt) / 1000;
  const rounded = seconds < 10 ? Math.round(seconds * 10) / 10 : Math.round(seconds);
  const formatted = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);

  return `${formatted}s`;
}

function clampToolProgressPercent(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : 0;
}

function thinkingSummaryLabel({
  active,
  durationMs,
  thinking,
  toolCalls,
}: {
  active: boolean;
  durationMs: number;
  thinking: ChatThinking;
  toolCalls: ChatToolCall[];
}): string {
  const runningToolCalls = toolCalls.filter((toolCall) => toolCall.status === "running");
  const finishedToolCalls = toolCalls.filter((toolCall) => toolCall.status !== "running");
  const toolSummary = formatToolCallSummary(toolCalls);
  const reasoningPhaseCount = countReasoningPhases(thinking, toolCalls);

  if (active && runningToolCalls.length > 0) {
    const finishedSummary =
      finishedToolCalls.length > 0
        ? ` (${formatFinishedToolCallSummary(finishedToolCalls)})`
        : "";
    const progressMessage = latestToolProgressMessage(runningToolCalls);

    if (progressMessage) {
      return `${progressMessage}${finishedSummary}`;
    }

    return `${formatRunningToolCallSummary(runningToolCalls)}${finishedSummary}`;
  }

  if (active && thinking.wordCount > 0) {
    const phaseSuffix =
      reasoningPhaseCount > 1 ? `, ${formatReasoningPhaseSummary(reasoningPhaseCount)}` : "";

    return `Thinking (${formatWordCount(thinking.wordCount)}${phaseSuffix})`;
  }

  if (toolCalls.length > 0 && thinking.wordCount === 0) {
    return `Used ${toolSummary}`;
  }

  const detailParts = [formatWordCount(thinking.wordCount)];

  if (reasoningPhaseCount > 1) {
    detailParts.push(formatReasoningPhaseSummary(reasoningPhaseCount));
  }

  if (toolCalls.length > 0) {
    detailParts.push(toolSummary);
  }

  return `Thought for ${formatThoughtDuration(durationMs)} (${detailParts.join(", ")})`;
}

function latestToolProgressMessage(toolCalls: ChatToolCall[]): string | null {
  for (const toolCall of [...toolCalls].reverse()) {
    const message = toolCall.progress?.message?.trim();

    if (message) {
      return message;
    }
  }

  return null;
}

function countReasoningPhases(thinking: ChatThinking, toolCalls: ChatToolCall[]): number {
  if (toolCalls.length === 0) {
    return thinking.content.trim() ? 1 : 0;
  }

  let count = 0;
  const groups = groupToolCallsByTurn(toolCalls);
  const standaloneBlocks = standaloneThinkingBlocksForToolCalls(thinking.content, groups);

  for (const group of groups) {
    if (group.thinkingAfter) {
      count += 1;
    }
  }

  count += standaloneBlocks.length;

  return count || (thinking.content.trim() ? 1 : 0);
}

function standaloneThinkingBlocksForToolCalls(
  content: string,
  groups: ToolCallTurnGroup[],
): string[] {
  let remaining = content.trim();

  for (const group of groups) {
    remaining = removeThinkingSegment(remaining, group.thinkingBefore);
    remaining = removeThinkingSegment(remaining, group.thinkingAfter);
  }

  return remaining
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function removeThinkingSegment(content: string, segment: string | undefined): string {
  const trimmedContent = content.trim();
  const trimmedSegment = trimThinkingSegment(segment);

  if (!trimmedContent || !trimmedSegment) {
    return trimmedContent;
  }

  const segmentIndex = trimmedContent.indexOf(trimmedSegment);

  if (segmentIndex < 0) {
    return trimmedContent;
  }

  const before = trimmedContent.slice(0, segmentIndex).trim();
  const after = trimmedContent.slice(segmentIndex + trimmedSegment.length).trim();

  return [before, after].filter(Boolean).join("\n\n");
}

function formatReasoningPhaseSummary(count: number): string {
  return `${count} reasoning ${count === 1 ? "phase" : "phases"}`;
}

function formatLabeledToolCount(count: number): string {
  return `${count} ${count === 1 ? "tool" : "tools"}`;
}

function formatLabeledToolTurnCount(count: number): string {
  return `${count} tool ${count === 1 ? "turn" : "turns"}`;
}

function formatRunningToolCallSummary(toolCalls: ChatToolCall[]): string {
  const names = uniqueToolCallDisplayNames(toolCalls);

  if (names.length === 1) {
    const countPrefix = toolCalls.length > 1 ? `${toolCalls.length} ` : "";

    return `Using ${countPrefix}'${names[0]}' ${toolCalls.length === 1 ? "tool" : "tools"}.`;
  }

  return `Using ${formatQuotedToolNameList(names)} tools.`;
}

function formatFinishedToolCallSummary(toolCalls: ChatToolCall[]): string {
  return `Finished using ${formatToolCallSummary(toolCalls)}`;
}

function formatToolCallSummary(toolCalls: ChatToolCall[]): string {
  const failedToolCount = toolCalls.filter((toolCall) => toolCall.status === "error").length;
  const base = formatLabeledToolCount(toolCalls.length);
  const toolTurnCount = groupToolCallsByTurn(toolCalls).length;
  const turnSuffix =
    toolTurnCount > 1 ? ` across ${formatLabeledToolTurnCount(toolTurnCount)}` : "";
  const failureSuffix = failedToolCount > 0 ? `, ${failedToolCount} failed` : "";

  return `${base}${turnSuffix}${failureSuffix}`;
}

function uniqueToolCallDisplayNames(toolCalls: ChatToolCall[]): string[] {
  return Array.from(new Set(toolCalls.map(toolCallDisplayName)));
}

function toolCallDisplayName(toolCall: ChatToolCall): string {
  const title = toolCall.title.trim() || toolCall.toolId.trim() || "Tool";
  const detailSeparatorIndex = title.indexOf(":");
  const label =
    detailSeparatorIndex > 0 ? title.slice(0, detailSeparatorIndex).trim() : title;

  return (label || title).replace(/\s+/g, " ");
}

function formatQuotedToolNameList(names: string[]): string {
  const visibleNames = names.map((name) => `'${name}'`);

  if (visibleNames.length === 2) {
    return `${visibleNames[0]} and ${visibleNames[1]}`;
  }

  if (visibleNames.length > 2) {
    const lastName = visibleNames[visibleNames.length - 1];
    const leadingNames = visibleNames.slice(0, -1).join(", ");

    return `${leadingNames}, and ${lastName}`;
  }

  return visibleNames[0] ?? "'Tool'";
}

function toolCallStatusLabel(toolCall: ChatToolCall): string {
  if (toolCall.status === "running") {
    return "Running";
  }

  if (toolCall.status === "error") {
    const duration = toolCallDurationSeconds(toolCall);

    return duration ? `Failed after ${duration}` : "Failed";
  }

  const duration = toolCallDurationSeconds(toolCall);

  return duration ? `Completed in ${duration}` : "Completed";
}

function toolCallErrorPreview(value: string, maxLength = 220): string {
  const compact = value.replace(/\s+/g, " ").trim();

  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 3)}...`;
}

function toolCallIcon(status: ChatToolCall["status"]): string {
  if (status === "running") {
    return "hourglass_top";
  }

  if (status === "error") {
    return "error";
  }

  return "check_circle";
}

function toolCallRowClass(status: ChatToolCall["status"]): string {
  const base =
    "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-sm border px-3 py-1.5 text-left text-xs text-on-surface transition";

  if (status === "error") {
    return [
      base,
      "border-error-container bg-error-container/25 hover:border-error/60 hover:bg-error-container/35 focus-visible:border-error/70",
    ].join(" ");
  }

  return [
    base,
    "border-outline-variant bg-surface-container-lowest hover:border-outline hover:bg-surface-container-low focus-visible:border-outline",
  ].join(" ");
}

function toolCallStatusTextClass(status: ChatToolCall["status"]): string {
  return [
    "shrink-0 truncate",
    status === "error" ? "font-medium text-error" : "text-on-surface-variant",
  ].join(" ");
}

function toolCallStatusValueClass(status: ChatToolCall["status"]): string {
  return [
    "min-w-0 break-words font-medium [overflow-wrap:anywhere]",
    status === "error" ? "text-error" : "text-on-surface",
  ].join(" ");
}

function toolCallOpenIconClass(status: ChatToolCall["status"]): string {
  return status === "error" ? "text-error" : "text-on-surface-variant";
}

function toolCallIconClass(status: ChatToolCall["status"]): string {
  if (status === "running") {
    return "text-primary";
  }

  if (status === "error") {
    return "text-error";
  }

  return "text-tertiary";
}

function ChatAttachmentList({
  attachments,
  onOpenAttachment,
}: {
  attachments: ChatAttachment[];
  onOpenAttachment(attachment: ChatAttachment): void;
}) {
  return (
    <div className="mt-3 grid gap-2">
      {attachments.map((attachment) =>
        attachment.kind === "image" ? (
          <button
            className="block max-w-full bg-transparent p-0 text-left transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            key={attachment.id}
            onClick={() => onOpenAttachment(attachment)}
            title={`Open ${attachment.name}`}
            type="button"
          >
            <img
              alt={attachment.name}
              className="max-h-72 max-w-full object-contain"
              src={attachment.dataUrl}
            />
          </button>
        ) : (
          <button
            className="flex items-center gap-3 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-left text-on-surface transition hover:border-outline hover:bg-surface-container-low"
            key={attachment.id}
            onClick={() => onOpenAttachment(attachment)}
            type="button"
          >
            <MaterialIcon
              className="shrink-0 text-on-surface-variant"
              name={iconForChatAttachment(attachment)}
              size={20}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{attachment.name}</span>
              <span className="block text-xs text-on-surface-variant">
                {attachment.mimeType || "File"} / {formatFileSize(attachment.size)}
              </span>
            </span>
            <MaterialIcon
              className="shrink-0 text-on-surface-variant"
              name="open_in_full"
              size={18}
            />
          </button>
        ),
      )}
    </div>
  );
}

function iconForChatAttachment(attachment: ChatAttachment): string {
  if (attachment.kind === "image") {
    return "image";
  }

  if (attachment.kind === "text") {
    return "article";
  }

  return "description";
}

function chatAttachmentsEqual(left: ChatAttachment[], right: ChatAttachment[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
