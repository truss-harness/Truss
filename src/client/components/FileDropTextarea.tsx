import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent, KeyboardEvent } from "react";
import type { ChatAttachment, ChatAttachmentKind } from "../../shared/protocol.ts";
import {
  attachmentFormatLabelForName,
  classifyAttachmentFile,
  unsupportedAttachmentMessage,
} from "../../shared/attachments.ts";
import {
  AttachmentImageConfirmationRequiredError,
  convertAttachmentFile,
  renderAttachmentFileAsImage,
} from "../api.ts";
import { AttachmentPreviewModal } from "./chat/AttachmentPreviewModal.tsx";
import { MaterialIcon } from "./MaterialIcon.tsx";

export interface ComposerAttachment {
  file: File;
  id: string;
  options: ComposerAttachmentOptions;
}

export interface ComposerAttachmentOptions {
  attachAsImage: boolean;
  attachAsText: boolean;
  imagePageRange: string;
  imagePageRangeEnabled: boolean;
}

export interface AttachmentRejection {
  message: string;
  name: string;
}

export interface AttachmentSelectionResult {
  attachments: ComposerAttachment[];
  rejections: AttachmentRejection[];
}

export interface AttachmentErrorState {
  id: string;
  message: string;
  title: string;
}

export interface ComposerMcpPrompt {
  arguments?: Record<string, unknown>[];
  description?: string;
  name: string;
  serverId: string;
  serverName: string;
}

export interface CreateChatAttachmentsOptions {
  confirmedImageAttachmentIds?: ReadonlySet<string>;
}

export class ComposerAttachmentImageConfirmationRequiredError extends Error {
  readonly attachmentId: string;
  readonly fileName: string;
  readonly pageCount: number;

  constructor({
    attachmentId,
    fileName,
    pageCount,
  }: {
    attachmentId: string;
    fileName: string;
    pageCount: number;
  }) {
    super(`${fileName} will render ${pageCount} page images. Confirm before attaching them.`);
    this.name = "ComposerAttachmentImageConfirmationRequiredError";
    this.attachmentId = attachmentId;
    this.fileName = fileName;
    this.pageCount = pageCount;
  }
}

export const SUPPORTED_ATTACHMENT_ACCEPT = "*/*";

const dockedMaxTextareaRows = 6;
const defaultMaxTextareaHeight = 300;

export function FileDropTextarea({
  allowAttachments = true,
  attachments,
  compact = false,
  disabled = false,
  docked = false,
  label,
  attachmentError,
  onAttachmentError,
  onAttachmentErrorDismiss,
  onAttachmentsChange,
  onChange,
  onMcpPromptResolve,
  onSubmitRequested,
  placeholder,
  mcpPrompts = [],
  rows,
  value,
}: {
  allowAttachments?: boolean;
  attachments: ComposerAttachment[];
  compact?: boolean;
  disabled?: boolean;
  docked?: boolean;
  label: string;
  attachmentError?: AttachmentErrorState | null;
  onAttachmentError?(error: AttachmentErrorState): void;
  onAttachmentErrorDismiss?(): void;
  onAttachmentsChange(attachments: ComposerAttachment[]): void;
  onChange(value: string): void;
  onMcpPromptResolve?(prompt: ComposerMcpPrompt): Promise<string>;
  onSubmitRequested?(): void;
  placeholder: string;
  mcpPrompts?: ComposerMcpPrompt[];
  rows?: number;
  value: string;
}) {
  const [dragDepth, setDragDepth] = useState(0);
  const [imageEditorAttachment, setImageEditorAttachment] = useState<ComposerAttachment | null>(
    null,
  );
  const [imageEditorDataUrl, setImageEditorDataUrl] = useState<string | null>(null);
  const [promptMenu, setPromptMenu] = useState<McpPromptMenuState | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [resolvingPromptKey, setResolvingPromptKey] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelectionRef = useRef<TextSelectionRange | null>(null);
  const isDraggingFiles = dragDepth > 0;
  const mcpPromptOptions = useMemo(
    () => mcpPromptMenuOptions(mcpPrompts, promptMenu?.query ?? ""),
    [mcpPrompts, promptMenu?.query],
  );
  const activePromptIndex =
    promptMenu && mcpPromptOptions.length > 0
      ? Math.min(promptMenu.activeIndex, mcpPromptOptions.length - 1)
      : 0;
  const imageEditorChatAttachment =
    imageEditorAttachment && imageEditorDataUrl
      ? composerImageAttachmentToChatAttachment(imageEditorAttachment, imageEditorDataUrl)
      : null;

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    const maxHeight = getTextareaMaxHeight(textarea, docked);

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [docked, value]);

  useEffect(() => {
    if (!promptMenu || mcpPromptOptions.length > 0 || promptError) {
      return;
    }

    setPromptMenu(null);
  }, [mcpPromptOptions.length, promptError, promptMenu]);

  useEffect(() => {
    const pendingSelection = pendingSelectionRef.current;
    const textarea = textareaRef.current;

    if (!pendingSelection || !textarea) {
      return;
    }

    pendingSelectionRef.current = null;
    textarea.focus();
    textarea.setSelectionRange(pendingSelection.start, pendingSelection.end);
  }, [value]);

  function addFiles(fileList: FileList | File[]): void {
    if (disabled || !allowAttachments) {
      return;
    }

    const result = selectComposerAttachments(fileList);

    if (result.rejections.length > 0) {
      onAttachmentError?.(attachmentErrorFromRejections(result.rejections));
    }

    if (result.attachments.length === 0) {
      return;
    }

    onAttachmentsChange([...attachments, ...result.attachments]);
  }

  function removeAttachment(id: string): void {
    if (disabled) {
      return;
    }

    onAttachmentsChange(attachments.filter((attachment) => attachment.id !== id));
  }

  function updateAttachmentOptions(id: string, options: ComposerAttachmentOptions): void {
    if (disabled) {
      return;
    }

    if (!options.attachAsImage && !options.attachAsText) {
      return;
    }

    onAttachmentsChange(
      attachments.map((attachment) =>
        attachment.id === id ? { ...attachment, options } : attachment,
      ),
    );
  }

  async function openImageEditor(attachment: ComposerAttachment): Promise<void> {
    if (disabled || classifyAttachmentFile(attachment.file) !== "image") {
      return;
    }

    try {
      setImageEditorAttachment(attachment);
      setImageEditorDataUrl(await readFileAsDataUrl(attachment.file));
    } catch (caught) {
      setImageEditorAttachment(null);
      setImageEditorDataUrl(null);
      onAttachmentError?.({
        id: createAttachmentNoticeId(),
        message: caught instanceof Error ? caught.message : "Could not read the image file.",
        title: "Image not opened",
      });
    }
  }

  async function saveEditedImageAttachment(updatedAttachment: ChatAttachment): Promise<void> {
    if (!imageEditorAttachment) {
      return;
    }

    const nextFile = await fileFromDataUrl(
      updatedAttachment.dataUrl,
      imageEditorAttachment.file.name,
      updatedAttachment.mimeType || imageEditorAttachment.file.type || "image/png",
    );
    const nextAttachment = {
      ...imageEditorAttachment,
      file: nextFile,
    };

    onAttachmentsChange(
      attachments.map((attachment) =>
        attachment.id === imageEditorAttachment.id ? nextAttachment : attachment,
      ),
    );
    setImageEditorAttachment(nextAttachment);
    setImageEditorDataUrl(updatedAttachment.dataUrl);
  }

  function closeImageEditor(): void {
    setImageEditorAttachment(null);
    setImageEditorDataUrl(null);
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>): void {
    if (disabled || !allowAttachments) {
      return;
    }

    if (!eventHasFiles(event)) {
      return;
    }

    event.preventDefault();
    setDragDepth((current) => current + 1);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    if (disabled || !allowAttachments) {
      return;
    }

    if (!eventHasFiles(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>): void {
    if (disabled || !allowAttachments) {
      return;
    }

    if (!eventHasFiles(event)) {
      return;
    }

    event.preventDefault();
    setDragDepth((current) => Math.max(0, current - 1));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    if (disabled || !allowAttachments) {
      return;
    }

    if (!eventHasFiles(event)) {
      return;
    }

    event.preventDefault();
    setDragDepth(0);
    addFiles(event.dataTransfer.files);
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    if (disabled || !allowAttachments) {
      return;
    }

    const files = imageFilesFromClipboard(event.clipboardData);

    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    addFiles(files);
  }

  function handleTextareaChange(nextValue: string, selectionStart: number | null): void {
    onChange(nextValue);
    updatePromptMenu(nextValue, selectionStart ?? nextValue.length);
  }

  function updatePromptMenu(nextValue: string, cursor: number): void {
    if (disabled || !onMcpPromptResolve || mcpPrompts.length === 0) {
      setPromptMenu(null);
      return;
    }

    const trigger = findMcpPromptTrigger(nextValue, cursor);

    if (!trigger) {
      setPromptMenu(null);
      setPromptError(null);
      return;
    }

    setPromptError(null);
    setPromptMenu((current) => ({
      activeIndex: current?.slashIndex === trigger.slashIndex ? current.activeIndex : 0,
      cursor,
      query: trigger.query,
      slashIndex: trigger.slashIndex,
    }));
  }

  async function selectMcpPrompt(prompt: ComposerMcpPrompt | undefined): Promise<void> {
    const textarea = textareaRef.current;
    const trigger = promptMenu;

    if (!prompt || !textarea || !trigger || disabled || !onMcpPromptResolve) {
      return;
    }

    const promptKey = mcpPromptKey(prompt);

    setResolvingPromptKey(promptKey);
    setPromptError(null);

    try {
      const resolvedPrompt = await onMcpPromptResolve(prompt);
      const insertText = resolvedPrompt.trim() || mcpPromptFallbackTemplate(prompt);

      if (!insertText) {
        setPromptError("Prompt did not return text.");
        return;
      }

      const selectionEnd = textarea.selectionStart ?? trigger.cursor;
      const nextValue = `${value.slice(0, trigger.slashIndex)}${insertText}${value.slice(
        selectionEnd,
      )}`;
      const placeholderRange = firstTemplatePlaceholderRange(insertText);
      const selection = placeholderRange
        ? {
            end: trigger.slashIndex + placeholderRange.end,
            start: trigger.slashIndex + placeholderRange.start,
          }
        : {
            end: trigger.slashIndex + insertText.length,
            start: trigger.slashIndex + insertText.length,
          };

      pendingSelectionRef.current = selection;
      setPromptMenu(null);
      setPromptError(null);
      onChange(nextValue);
    } catch (caught) {
      setPromptError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setResolvingPromptKey((current) => (current === promptKey ? null : current));
    }
  }

  return (
    <div
      className="relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <textarea
        aria-label={label}
        className={[
          "w-full resize-none border-0 bg-transparent text-on-surface outline-none placeholder:text-on-surface-variant/50 focus:ring-0",
          disabled ? "cursor-not-allowed opacity-70" : "",
          docked
            ? "min-h-12 px-2 py-3 text-base leading-6"
            : compact
              ? "min-h-24 px-5 py-4 text-base leading-6"
              : "min-h-44 px-8 py-8 text-[22px] leading-8",
        ].join(" ")}
        onChange={(event) =>
          handleTextareaChange(event.target.value, event.target.selectionStart)
        }
        onClick={(event) =>
          updatePromptMenu(event.currentTarget.value, event.currentTarget.selectionStart)
        }
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (disabled) {
            return;
          }

          if (promptMenu && event.key === "Escape") {
            event.preventDefault();
            setPromptMenu(null);
            setPromptError(null);
            return;
          }

          if (promptMenu && mcpPromptOptions.length > 0) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setPromptMenu({
                ...promptMenu,
                activeIndex: (activePromptIndex + 1) % mcpPromptOptions.length,
              });
              return;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              setPromptMenu({
                ...promptMenu,
                activeIndex:
                  (activePromptIndex - 1 + mcpPromptOptions.length) % mcpPromptOptions.length,
              });
              return;
            }

            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              void selectMcpPrompt(mcpPromptOptions[activePromptIndex]?.prompt);
              return;
            }
          }

          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSubmitRequested?.();
          }
        }}
        onKeyUp={(event) => {
          if (["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"].includes(event.key)) {
            return;
          }

          updatePromptMenu(event.currentTarget.value, event.currentTarget.selectionStart);
        }}
        onPaste={handlePaste}
        onSelect={(event) =>
          updatePromptMenu(event.currentTarget.value, event.currentTarget.selectionStart)
        }
        disabled={disabled}
        placeholder={placeholder}
        ref={textareaRef}
        rows={rows ?? (docked ? 1 : compact ? 3 : 4)}
        value={value}
      />

      {promptMenu && (mcpPromptOptions.length > 0 || promptError) ? (
        <div
          className={[
            "absolute z-50 max-h-72 overflow-hidden rounded-sm border border-outline-variant bg-surface-container-lowest shadow-[0_18px_48px_rgb(27_28_25/0.18)]",
            docked ? "bottom-full left-0 right-0 mb-2" : "left-3 right-3 top-full mt-2",
          ].join(" ")}
        >
          <div className="max-h-72 overflow-auto py-1">
            {promptError ? (
              <p className="px-3 py-2 text-xs leading-5 text-error">{promptError}</p>
            ) : null}
            {mcpPromptOptions.map((option, index) => {
              const promptKey = mcpPromptKey(option.prompt);
              const resolving = resolvingPromptKey === promptKey;
              const active = index === activePromptIndex;

              return (
                <button
                  className={[
                    "grid w-full min-w-0 gap-1 px-3 py-2 text-left transition",
                    active ? "bg-primary-container/45" : "hover:bg-surface-container-low",
                    resolving ? "cursor-progress opacity-80" : "",
                  ].join(" ")}
                  disabled={Boolean(resolvingPromptKey)}
                  key={promptKey}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    void selectMcpPrompt(option.prompt);
                  }}
                  type="button"
                >
                  <span className="flex min-w-0 items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-semibold text-on-surface">
                      {option.prompt.name}
                    </span>
                    <span className="shrink-0 truncate text-[0.68rem] font-medium text-on-surface-variant">
                      {option.prompt.serverName}
                    </span>
                  </span>
                  {option.prompt.description ? (
                    <span className="line-clamp-2 text-xs leading-5 text-on-surface-variant">
                      {option.prompt.description}
                    </span>
                  ) : null}
                  {option.argumentLabels.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {option.argumentLabels.map((argument) => (
                        <span
                          className="rounded-sm border border-outline-variant bg-surface px-1.5 py-0.5 font-mono text-[0.66rem] text-on-surface-variant"
                          key={argument}
                        >
                          {argument}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {resolving ? (
                    <span className="text-xs font-medium text-on-surface-variant">
                      Loading prompt
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {isDraggingFiles ? (
        <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-sm border border-dashed border-outline bg-surface-container-low/95 text-center shadow-[inset_0_0_0_1px_rgb(255_255_255/0.7)]">
          <div className="grid place-items-center gap-2 text-on-surface">
            <span className="grid h-10 w-10 place-items-center rounded-sm bg-secondary-container text-secondary">
              <MaterialIcon name="upload_file" size={23} />
            </span>
            <span className="text-sm font-medium">Drop files to attach</span>
          </div>
        </div>
      ) : null}

      {attachmentError ? (
        <AttachmentErrorPanel error={attachmentError} onDismiss={onAttachmentErrorDismiss} />
      ) : null}

      {allowAttachments && attachments.length > 0 ? (
        <div className="border-t border-outline-variant/60 px-6 py-3">
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <AttachmentChip
                attachment={attachment}
                disabled={disabled}
                docked={docked}
                key={attachment.id}
                onEditImage={() => void openImageEditor(attachment)}
                onOptionsChange={(options) => updateAttachmentOptions(attachment.id, options)}
                onRemove={() => removeAttachment(attachment.id)}
              />
            ))}
          </div>
        </div>
      ) : null}

      <AttachmentPreviewModal
        attachment={imageEditorChatAttachment}
        onClose={closeImageEditor}
        onSaveAttachment={saveEditedImageAttachment}
      />
    </div>
  );
}

export function createComposerAttachments(fileList: FileList | File[]): ComposerAttachment[] {
  return selectComposerAttachments(fileList).attachments;
}

export function selectComposerAttachments(fileList: FileList | File[]): AttachmentSelectionResult {
  const attachments: ComposerAttachment[] = [];
  const rejections: AttachmentRejection[] = [];

  for (const file of Array.from(fileList)) {
    if (classifyAttachmentFile(file) === "unsupported") {
      rejections.push({
        message: unsupportedAttachmentMessage(file.name),
        name: file.name,
      });
      continue;
    }

    attachments.push({
      file,
      id: createAttachmentId(file),
      options: defaultAttachmentOptions(file),
    });
  }

  return { attachments, rejections };
}

export async function createChatAttachments(
  attachments: ComposerAttachment[],
  options: CreateChatAttachmentsOptions = {},
): Promise<ChatAttachment[]> {
  const chatAttachments: ChatAttachment[] = [];
  const confirmedImageAttachmentIds = options.confirmedImageAttachmentIds ?? new Set<string>();

  for (const attachment of attachments) {
    const { file } = attachment;
    const kind = kindForFile(file);

    if (classifyAttachmentFile(file) === "convertible-document") {
      if (attachment.options.attachAsText) {
        const response = await convertAttachmentFile(file);

        if (!response.attachment) {
          throw new Error(`${file.name} did not return a converted text attachment.`);
        }

        chatAttachments.push({
          ...response.attachment,
          id: `${attachment.id}-text`,
        });
      }

      if (attachment.options.attachAsImage) {
        const pageRange = normalizedImagePageRange(attachment.options);

        if (attachment.options.imagePageRangeEnabled && !pageRange) {
          throw new Error(`Enter a page range for ${file.name}, like 1-3 or 1,3,5.`);
        }

        try {
          const response = await renderAttachmentFileAsImage(file, {
            confirmLargeBatch: confirmedImageAttachmentIds.has(attachment.id),
            pageRange,
          });
          const renderedAttachments =
            response.attachments ?? (response.attachment ? [response.attachment] : []);

          if (renderedAttachments.length === 0) {
            throw new Error(`${file.name} did not return a rendered image attachment.`);
          }

          renderedAttachments.forEach((renderedAttachment, index) => {
            chatAttachments.push({
              ...renderedAttachment,
              id: `${attachment.id}-image-${index + 1}`,
            });
          });
        } catch (caught) {
          if (caught instanceof AttachmentImageConfirmationRequiredError) {
            throw new ComposerAttachmentImageConfirmationRequiredError({
              attachmentId: attachment.id,
              fileName: caught.fileName || file.name,
              pageCount: caught.pageCount,
            });
          }

          throw caught;
        }
      }

      continue;
    }

    if (kind === "document") {
      throw new Error(unsupportedAttachmentMessage(file.name));
    }

    const text = kind === "text" ? await file.text() : undefined;

    chatAttachments.push({
      dataUrl: await readFileAsDataUrl(file),
      id: attachment.id,
      kind,
      mimeType: file.type || mimeTypeForName(file.name),
      name: file.name,
      size: file.size,
      text,
    });
  }

  return chatAttachments;
}

export function attachmentErrorFromRejections(
  rejections: AttachmentRejection[],
): AttachmentErrorState {
  const [firstRejection] = rejections;

  if (rejections.length === 1 && firstRejection) {
    return {
      id: createAttachmentNoticeId(),
      message: firstRejection.message,
      title: "File not attached",
    };
  }

  return {
    id: createAttachmentNoticeId(),
    message: `${rejections.length} files were not attached because Truss can only attach text, code, images, and documents it can convert to Markdown.`,
    title: "Some files were not attached",
  };
}

export function attachmentErrorFromMessage(message: string): AttachmentErrorState {
  return {
    id: createAttachmentNoticeId(),
    message,
    title: "File not attached",
  };
}

function AttachmentChip({
  attachment,
  disabled,
  docked,
  onEditImage,
  onOptionsChange,
  onRemove,
}: {
  attachment: ComposerAttachment;
  disabled: boolean;
  docked: boolean;
  onEditImage(): void;
  onOptionsChange(options: ComposerAttachmentOptions): void;
  onRemove(): void;
}) {
  const { file } = attachment;
  const isConvertibleDocument = classifyAttachmentFile(file) === "convertible-document";
  const isImage = classifyAttachmentFile(file) === "image";
  const formatLabel = attachmentFormatLabelForName(file.name, file.type);
  const textOnlySelected = attachment.options.attachAsText && !attachment.options.attachAsImage;
  const imageOnlySelected = attachment.options.attachAsImage && !attachment.options.attachAsText;
  const pageRangeEnabled = attachment.options.imagePageRangeEnabled;
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) {
      setImagePreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(file);

    setImagePreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [file, isImage]);

  function setBooleanOption(option: "attachAsImage" | "attachAsText", checked: boolean): void {
    const nextOptions = {
      ...attachment.options,
      [option]: checked,
    };

    if (option === "attachAsImage" && !checked) {
      nextOptions.imagePageRange = "";
      nextOptions.imagePageRangeEnabled = false;
    }

    onOptionsChange(nextOptions);
  }

  function setPageRangeEnabled(checked: boolean): void {
    onOptionsChange({
      ...attachment.options,
      attachAsImage: checked ? true : attachment.options.attachAsImage,
      imagePageRange: checked ? attachment.options.imagePageRange : "",
      imagePageRangeEnabled: checked,
    });
  }

  function setPageRange(value: string): void {
    onOptionsChange({
      ...attachment.options,
      imagePageRange: value,
    });
  }

  const expandedPanel = isConvertibleDocument ? (
    <div
      className={[
        "pointer-events-none max-h-0 overflow-hidden opacity-0 transition-[max-height,opacity] duration-150 ease-out group-hover/attachment-chip:pointer-events-auto group-hover/attachment-chip:max-h-72 group-hover/attachment-chip:opacity-100 group-focus-within/attachment-chip:pointer-events-auto group-focus-within/attachment-chip:max-h-72 group-focus-within/attachment-chip:opacity-100",
        docked ? "border-b border-outline-variant/70" : "border-t border-outline-variant/70",
      ].join(" ")}
    >
      <div className={["grid gap-3 px-3", docked ? "pb-2 pt-3" : "pb-3 pt-2"].join(" ")}>
        <p className="text-[11px] leading-4 text-on-surface-variant">
          This file cannot be natively read by the AI model. Truss can convert it to text
          and/or render it as an image.
        </p>
        <div className="grid gap-2">
          <label className="flex items-center gap-2 text-[11px] font-medium text-on-surface">
            <input
              checked={attachment.options.attachAsText}
              className="h-4 w-4 shrink-0 accent-primary"
              disabled={disabled || textOnlySelected}
              onChange={(event) => setBooleanOption("attachAsText", event.target.checked)}
              type="checkbox"
            />
            <span className="min-w-0">Attach as text file (default)</span>
          </label>
          <label className="flex items-center gap-2 text-[11px] font-medium text-on-surface">
            <input
              checked={attachment.options.attachAsImage}
              className="h-4 w-4 shrink-0 accent-primary"
              disabled={disabled || imageOnlySelected}
              onChange={(event) => setBooleanOption("attachAsImage", event.target.checked)}
              type="checkbox"
            />
            <span className="min-w-0">Attach as image file</span>
          </label>
          <label className="grid gap-1 text-[11px] font-medium text-on-surface">
            <span className="flex items-center gap-2">
              <input
                checked={pageRangeEnabled}
                className="h-4 w-4 shrink-0 accent-primary"
                disabled={disabled}
                onChange={(event) => setPageRangeEnabled(event.target.checked)}
                type="checkbox"
              />
              <span className="min-w-0">Select page range to render</span>
            </span>
            <input
              aria-label={`Page range for ${file.name}`}
              className="h-8 min-w-0 rounded-sm border border-outline-variant bg-surface px-2 text-[11px] text-on-surface outline-none transition placeholder:text-on-surface-variant/60 focus:border-primary disabled:cursor-not-allowed disabled:bg-surface-container-low disabled:text-on-surface-variant"
              disabled={disabled || !pageRangeEnabled}
              onChange={(event) => setPageRange(event.target.value)}
              placeholder="e.g. 1-3, 5"
              value={attachment.options.imagePageRange}
            />
          </label>
        </div>
      </div>
    </div>
  ) : isImage ? (
    <div
      className={[
        "pointer-events-none max-h-0 overflow-hidden opacity-0 transition-[max-height,opacity] duration-150 ease-out group-hover/attachment-chip:pointer-events-auto group-hover/attachment-chip:max-h-72 group-hover/attachment-chip:opacity-100 group-focus-within/attachment-chip:pointer-events-auto group-focus-within/attachment-chip:max-h-72 group-focus-within/attachment-chip:opacity-100",
        docked ? "border-b border-outline-variant/70" : "border-t border-outline-variant/70",
      ].join(" ")}
    >
      <div className={["p-2", docked ? "pb-2 pt-3" : "pb-3 pt-2"].join(" ")}>
        <div className="grid h-48 place-items-center overflow-hidden rounded-sm border border-outline-variant/70 bg-surface-container-lowest">
          {imagePreviewUrl ? (
            <img
              alt={file.name}
              className="h-full w-full object-contain"
              draggable={false}
              src={imagePreviewUrl}
            />
          ) : (
            <span className="truss-spinner h-4 w-4 rounded-full border-2 border-outline-variant border-t-primary" />
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="group/attachment-chip relative z-0 h-14 w-[min(22rem,100%)] max-w-full text-xs focus-within:z-50 hover:z-50">
      <div
        className={[
          "absolute left-0 z-20 w-full rounded-sm border border-outline-variant bg-surface-container-low text-on-surface shadow-[0_1px_2px_rgb(27_28_25/0.04)] transition-shadow duration-150 group-hover/attachment-chip:shadow-[0_12px_26px_rgb(27_28_25/0.16)] group-focus-within/attachment-chip:shadow-[0_12px_26px_rgb(27_28_25/0.16)]",
          disabled ? "opacity-70" : "",
          docked ? "bottom-0 flex flex-col-reverse" : "top-0",
        ].join(" ")}
      >
        <div className="flex min-h-14 items-center gap-2 px-3 py-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-sm bg-surface-container-high text-on-surface-variant">
            <MaterialIcon name={iconForAttachment(attachment)} size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{file.name}</span>
            <span className="block truncate text-on-surface-variant">
              {labelForAttachment(attachment)} / {formatFileSize(file.size)}
            </span>
          </span>
          {isConvertibleDocument ? (
            <span
              aria-label={`${formatLabel} attachment options`}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-on-surface-variant transition group-hover/attachment-chip:bg-surface-container-high group-hover/attachment-chip:text-primary group-focus-within/attachment-chip:bg-surface-container-high group-focus-within/attachment-chip:text-primary"
              title="Attachment options"
            >
              <MaterialIcon
                className="transition-transform duration-150 group-hover/attachment-chip:rotate-180 group-focus-within/attachment-chip:rotate-180"
                name="expand_more"
                size={18}
              />
            </span>
          ) : null}
          {isImage ? (
            <button
              aria-label={`Edit ${file.name}`}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-on-surface-variant transition hover:bg-surface-container-high hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
              disabled={disabled}
              onClick={onEditImage}
              title="Edit image"
              type="button"
            >
              <MaterialIcon name="crop" size={17} />
            </button>
          ) : null}
          <button
            aria-label={`Remove ${file.name}`}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-on-surface-variant transition hover:bg-surface-container-high hover:text-primary"
            disabled={disabled}
            onClick={onRemove}
            type="button"
          >
            <MaterialIcon name="close" size={17} />
          </button>
        </div>
        {expandedPanel}
      </div>
    </div>
  );
}

function AttachmentErrorPanel({
  error,
  onDismiss,
}: {
  error: AttachmentErrorState;
  onDismiss?(): void;
}) {
  return (
    <div
      className="border-t border-error-container bg-error-container/30 px-6 py-3 text-on-error-container"
      key={error.id}
    >
      <div className="flex items-start gap-3 rounded-sm border border-error-container bg-surface/75 px-3 py-3 shadow-[0_8px_22px_rgb(147_0_10/0.08)]">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-error-container text-error">
          <MaterialIcon name="error" size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{error.title}</span>
          <span className="mt-1 block text-xs leading-5 text-on-surface-variant">
            {error.message}
          </span>
        </span>
        {onDismiss ? (
          <button
            aria-label="Dismiss attachment error"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-sm text-on-surface-variant transition hover:bg-error-container/60 hover:text-error"
            onClick={onDismiss}
            type="button"
          >
            <MaterialIcon name="close" size={18} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function eventHasFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export function imageFilesFromClipboard(dataTransfer: DataTransfer): File[] {
  const files = Array.from(dataTransfer.files).filter(isImageFile);
  const imageFiles =
    files.length > 0
      ? files
      : Array.from(dataTransfer.items)
          .filter((item) => item.kind === "file" && item.type.toLowerCase().startsWith("image/"))
          .map((item) => item.getAsFile())
          .filter((file): file is File => Boolean(file));

  return imageFiles.map((file, index) => withClipboardImageName(file, index));
}

function isImageFile(file: File): boolean {
  return file.type.toLowerCase().startsWith("image/");
}

function withClipboardImageName(file: File, index: number): File {
  const name = typeof file.name === "string" ? file.name.trim() : "";

  if (name) {
    return file;
  }

  const suffix = index === 0 ? "" : `-${index + 1}`;

  return new File([file], `clipboard-image${suffix}.${extensionForImageMimeType(file.type)}`, {
    lastModified: file.lastModified,
    type: file.type || "image/png",
  });
}

function extensionForImageMimeType(mimeType: string): string {
  const normalizedMimeType = mimeType.toLowerCase().split(";")[0]?.trim();

  switch (normalizedMimeType) {
    case "image/bmp":
      return "bmp";
    case "image/gif":
      return "gif";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/svg+xml":
      return "svg";
    case "image/tiff":
      return "tif";
    case "image/webp":
      return "webp";
    default:
      return "png";
  }
}

function createAttachmentId(file: File): string {
  const randomValue =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  return `${file.name}-${file.size}-${file.lastModified}-${randomValue}`;
}

function createAttachmentNoticeId(): string {
  const randomValue =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  return `attachment-error-${randomValue}`;
}

function defaultAttachmentOptions(file: File): ComposerAttachmentOptions {
  const category = classifyAttachmentFile(file);

  return {
    attachAsImage: category === "image",
    attachAsText: category !== "image",
    imagePageRange: "",
    imagePageRangeEnabled: false,
  };
}

function iconForAttachment(attachment: ComposerAttachment): string {
  const { file } = attachment;

  if (classifyAttachmentFile(file) === "convertible-document") {
    if (attachment.options.attachAsImage) {
      return "image";
    }

    return formatIconForFile(file);
  }

  return iconForFile(file);
}

function formatIconForFile(file: File): string {
  switch (attachmentFormatLabelForName(file.name, file.type)) {
    case "PDF":
      return "picture_as_pdf";
    case "PowerPoint":
      return "slideshow";
    case "Excel":
      return "table_chart";
    case "Word":
      return "article";
    default:
      return "description";
  }
}

function iconForFile(file: File): string {
  if (file.type.startsWith("image/")) {
    return "image";
  }

  if (/\.(markdown|md)$/i.test(file.name) || classifyAttachmentFile(file) === "text") {
    return "article";
  }

  return "description";
}

function kindForFile(file: File): ChatAttachmentKind {
  if (file.type.startsWith("image/")) {
    return "image";
  }

  if (isTextLikeFile(file)) {
    return "text";
  }

  return "document";
}

function labelForAttachment(attachment: ComposerAttachment): string {
  const { file } = attachment;

  if (classifyAttachmentFile(file) !== "convertible-document") {
    return labelForFile(file);
  }

  const pageRange = normalizedImagePageRange(attachment.options);
  const imageLabel = pageRange ? `image pages ${pageRange}` : "image";
  const outputLabel =
    attachment.options.attachAsText && attachment.options.attachAsImage
      ? `text + ${imageLabel}`
      : attachment.options.attachAsImage
        ? imageLabel
        : "text";

  return `${attachmentFormatLabelForName(file.name, file.type)} to ${outputLabel}`;
}

function normalizedImagePageRange(options: ComposerAttachmentOptions): string | undefined {
  if (!options.attachAsImage || !options.imagePageRangeEnabled) {
    return undefined;
  }

  const pageRange = options.imagePageRange.trim();

  return pageRange || undefined;
}

function labelForFile(file: File): string {
  if (file.type.startsWith("image/")) {
    return "Image";
  }

  if (classifyAttachmentFile(file) === "convertible-document") {
    return "Converts to Markdown";
  }

  if (/\.(markdown|md)$/i.test(file.name)) {
    return "Markdown";
  }

  if (file.type.startsWith("text/") || /\.txt$/i.test(file.name)) {
    return "Text";
  }

  return "Document";
}

function isTextLikeFile(file: File): boolean {
  return classifyAttachmentFile(file) === "text";
}

function mimeTypeForName(name: string): string {
  if (/\.md$/i.test(name) || /\.markdown$/i.test(name)) {
    return "text/markdown";
  }

  if (/\.txt$/i.test(name)) {
    return "text/plain";
  }

  if (/\.rtf$/i.test(name)) {
    return "application/rtf";
  }

  return "application/octet-stream";
}

function composerImageAttachmentToChatAttachment(
  attachment: ComposerAttachment,
  dataUrl: string,
): ChatAttachment {
  return {
    dataUrl,
    id: attachment.id,
    kind: "image",
    mimeType: attachment.file.type || "image/png",
    name: attachment.file.name,
    size: attachment.file.size,
  };
}

async function fileFromDataUrl(dataUrl: string, name: string, mimeType: string): Promise<File> {
  const response = await fetch(dataUrl);

  if (!response.ok) {
    throw new Error("Could not prepare the edited image.");
  }

  const blob = await response.blob();

  return new File([blob], name, {
    lastModified: Date.now(),
    type: blob.type || mimeType,
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Could not read file."));
        return;
      }

      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getTextareaMaxHeight(textarea: HTMLTextAreaElement, docked: boolean): number {
  if (!docked) {
    return defaultMaxTextareaHeight;
  }

  const styles = window.getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(styles.lineHeight);
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
  const resolvedLineHeight = Number.isFinite(lineHeight) ? lineHeight : 24;

  return resolvedLineHeight * dockedMaxTextareaRows + paddingTop + paddingBottom;
}

interface McpPromptMenuState {
  activeIndex: number;
  cursor: number;
  query: string;
  slashIndex: number;
}

interface TextSelectionRange {
  end: number;
  start: number;
}

function findMcpPromptTrigger(
  value: string,
  cursor: number,
): { query: string; slashIndex: number } | null {
  const beforeCursor = value.slice(0, cursor);
  const slashIndex = beforeCursor.lastIndexOf("/");

  if (slashIndex <= 0) {
    return null;
  }

  if (!/\s/.test(value[slashIndex - 1] ?? "")) {
    return null;
  }

  const query = beforeCursor.slice(slashIndex + 1);

  if (/\s/.test(query)) {
    return null;
  }

  return {
    query,
    slashIndex,
  };
}

function mcpPromptMenuOptions(prompts: ComposerMcpPrompt[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  return prompts
    .filter((prompt) => {
      if (!normalizedQuery) {
        return true;
      }

      return [
        prompt.name,
        prompt.description ?? "",
        prompt.serverName,
        ...((prompt.arguments ?? []).map((argument) => promptArgumentName(argument)) ?? []),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    })
    .slice(0, 8)
    .map((prompt) => ({
      argumentLabels: (prompt.arguments ?? []).map(promptArgumentName).filter(Boolean),
      prompt,
    }));
}

function mcpPromptKey(prompt: ComposerMcpPrompt): string {
  return `${prompt.serverId}:${prompt.name}`;
}

function mcpPromptFallbackTemplate(prompt: ComposerMcpPrompt): string {
  const argumentNames = (prompt.arguments ?? []).map(promptArgumentName).filter(Boolean);

  return argumentNames.map((name) => `{${name}}`).join(" ");
}

function promptArgumentName(argument: Record<string, unknown>): string {
  return typeof argument.name === "string" && argument.name.trim()
    ? argument.name.trim()
    : "";
}

function firstTemplatePlaceholderRange(text: string): TextSelectionRange | null {
  const match = /\{[A-Za-z][A-Za-z0-9_-]*\}/.exec(text);

  if (!match || match.index === undefined) {
    return null;
  }

  return {
    end: match.index + match[0].length,
    start: match.index,
  };
}
