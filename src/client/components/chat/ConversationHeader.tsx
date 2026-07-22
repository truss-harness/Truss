import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ModelSelector, type ModelSelectorOption, type SelectedModel } from "../ModelSelector.tsx";
import { MaterialIcon } from "../MaterialIcon.tsx";
import { ModeToggle } from "./ChatPromptCard.tsx";
import { ContextMenuButton, ContextMenuSubmenu } from "./ConversationSidebar.tsx";
import type { ComposerMode, ConversationExportFormat } from "./types.ts";

export function ConversationHeader({
  canEditTitle,
  hasMessages,
  loadingModels,
  mode,
  modelOptions,
  conversationActionsDisabled,
  onCopyAllToClipboard,
  onDelete,
  onDuplicate,
  onExport,
  onModelChange,
  onModeChange,
  onTitleSubmit,
  selectedModel,
  sessionStartedMode,
  title,
}: {
  canEditTitle: boolean;
  hasMessages: boolean;
  loadingModels: boolean;
  mode: ComposerMode;
  modelOptions: ModelSelectorOption[];
  conversationActionsDisabled: boolean;
  onCopyAllToClipboard(): void;
  onDelete(): void;
  onDuplicate(): void;
  onExport(format: ConversationExportFormat): void;
  onModelChange(selection: SelectedModel): void;
  onModeChange(mode: ComposerMode): void;
  onTitleSubmit(title: string): Promise<void>;
  selectedModel: SelectedModel | null;
  sessionStartedMode: ComposerMode | null;
  title: string | null;
}) {
  const [titleEditing, setTitleEditing] = useState(false);

  return (
    <header
      className={[
        "transition-all duration-500 ease-out",
        hasMessages
          ? "truss-chat-topbar relative z-50 shrink-0 border-b border-outline-variant bg-surface/92 px-5 py-2 shadow-[0_10px_28px_rgb(27_28_25/0.06)] backdrop-blur sm:px-8 lg:px-12"
          : "relative z-50",
      ].join(" ")}
    >
      <div
        className={[
          "flex min-w-0 flex-col gap-1.5 sm:flex-row",
          hasMessages ? "sm:justify-between" : "sm:justify-end",
          titleEditing ? "sm:items-stretch" : "sm:items-center",
          hasMessages ? "mx-auto max-w-[980px]" : "",
        ].join(" ")}
      >
        {hasMessages ? (
          <div className="min-w-0 flex-1 transition-all duration-300 ease-out">
            <EditableConversationTitle
              canEdit={canEditTitle}
              hasMessages={hasMessages}
              onEditingChange={setTitleEditing}
              onTitleSubmit={onTitleSubmit}
              title={title}
            />
          </div>
        ) : null}

        <div
          className={[
            "flex min-w-0 origin-right items-center gap-3 overflow-visible transition-all duration-300 ease-out",
            titleEditing
              ? "pointer-events-none max-h-0 max-w-0 -translate-y-1 scale-95 opacity-0 sm:max-h-10"
              : "max-h-16 max-w-[34rem] translate-y-0 scale-100 opacity-100",
          ].join(" ")}
        >
          {hasMessages ? (
            <ModeToggle
              compact
              disabled={titleEditing}
              mode={mode}
              onModeChange={onModeChange}
              sessionStartedMode={sessionStartedMode}
              tooltipPlacement="bottom"
            />
          ) : null}
          <ModelSelector
            disabled={titleEditing || (modelOptions.length === 0 && !selectedModel)}
            loading={loadingModels}
            onChange={onModelChange}
            options={modelOptions}
            selected={selectedModel}
          />
          {hasMessages ? (
            <HeaderActionsMenu
              disabled={titleEditing || conversationActionsDisabled}
              onCopyAllToClipboard={onCopyAllToClipboard}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              onExport={onExport}
            />
          ) : null}
        </div>
      </div>
    </header>
  );
}

function HeaderActionsMenu({
  disabled,
  onCopyAllToClipboard,
  onDelete,
  onDuplicate,
  onExport,
}: {
  disabled: boolean;
  onCopyAllToClipboard(): void;
  onDelete(): void;
  onDuplicate(): void;
  onExport(format: ConversationExportFormat): void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;

      if (target instanceof Node && rootRef.current?.contains(target)) {
        return;
      }

      setOpen(false);
    }

    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function runAction(action: () => void): void {
    setOpen(false);
    action();
  }

  function runExport(format: ConversationExportFormat): void {
    setOpen(false);
    onExport(format);
  }

  return (
    <div className="relative z-[115] shrink-0" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Conversation actions"
        className="grid h-10 w-10 place-items-center rounded-sm border border-outline-variant bg-surface-container-low text-on-surface-variant transition hover:bg-surface-container hover:text-primary focus:border-outline focus:bg-surface focus:outline-none disabled:cursor-not-allowed disabled:opacity-45"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <MaterialIcon name="more_horiz" size={20} />
      </button>

      {open ? (
        <div
          aria-label="Conversation actions"
          className="truss-sidebar-menu absolute right-0 top-[calc(100%+0.5rem)] z-[140] w-60 overflow-visible rounded-sm border border-outline-variant bg-surface py-1 text-on-surface shadow-[0_18px_44px_rgb(27_28_25/0.16)]"
          role="menu"
        >
          <ContextMenuButton
            disabled={disabled}
            icon="control_point_duplicate"
            label="Duplicate"
            onClick={() => runAction(onDuplicate)}
          />
          <ContextMenuSubmenu align="left" icon="ios_share" label="Export">
            <ContextMenuButton
              disabled={disabled}
              icon="html"
              label="HTML"
              onClick={() => runExport("html")}
            />
            <ContextMenuButton
              disabled={disabled}
              icon="article"
              label="Markdown"
              onClick={() => runExport("markdown")}
            />
            <ContextMenuButton
              disabled={disabled}
              icon="data_object"
              label="JSON"
              onClick={() => runExport("json")}
            />
            <ContextMenuButton
              disabled={disabled}
              icon="account_tree"
              label="ATIF"
              onClick={() => runExport("atif")}
            />
            <ContextMenuButton
              disabled={disabled}
              icon="description"
              label="Word (.docx)"
              onClick={() => runExport("docx")}
            />
          </ContextMenuSubmenu>
          <ContextMenuButton
            disabled={disabled}
            icon="content_copy"
            label="Copy All to Clipboard"
            onClick={() => runAction(onCopyAllToClipboard)}
          />
          <div className="my-1 border-t border-outline-variant/70" />
          <ContextMenuButton
            danger
            disabled={disabled}
            icon="delete"
            label="Delete"
            onClick={() => runAction(onDelete)}
          />
        </div>
      ) : null}
    </div>
  );
}

function EditableConversationTitle({
  canEdit,
  hasMessages,
  onEditingChange,
  onTitleSubmit,
  title,
}: {
  canEdit: boolean;
  hasMessages: boolean;
  onEditingChange(editing: boolean): void;
  onTitleSubmit(title: string): Promise<void>;
  title: string | null;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const displayTitle = title ?? "Generating title...";

  useEffect(() => {
    if (!editing) {
      setDraft(title ?? "");
    }
  }, [editing, title]);

  useEffect(() => {
    if (editing) {
      window.setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [editing]);

  useEffect(() => {
    onEditingChange(editing);
  }, [editing, onEditingChange]);

  useEffect(() => () => onEditingChange(false), [onEditingChange]);

  async function submitTitle(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (saving) {
      return;
    }

    const trimmed = draft.trim();

    if (trimmed && trimmed === (title ?? "")) {
      setEditing(false);
      return;
    }

    setSaving(true);

    try {
      await onTitleSubmit(trimmed);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit(): void {
    setDraft(title ?? "");
    setEditing(false);
  }

  if (editing) {
    return (
      <form
        className="flex w-full min-w-0 items-center gap-2"
        onSubmit={(event) => void submitTitle(event)}
      >
        <input
          aria-label="Conversation title"
          className="h-9 min-w-0 flex-1 rounded-sm border border-outline bg-surface-container-low px-3 text-base font-semibold leading-6 text-primary outline-none transition focus:bg-surface sm:text-lg"
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancelEdit();
            }
          }}
          placeholder="Leave blank to auto-generate"
          ref={inputRef}
          value={draft}
        />
        <TitleIconButton disabled={saving} icon="check" label="Save title" type="submit" />
        <TitleIconButton
          disabled={saving}
          icon="close"
          label="Cancel title edit"
          onClick={cancelEdit}
        />
      </form>
    );
  }

  return (
    <button
      className={[
        "group/title relative flex max-w-full items-center gap-2 rounded-sm border border-transparent px-2 py-0.5 text-left transition",
        canEdit
          ? "hover:border-outline-variant hover:bg-surface-container-low focus-visible:border-outline focus-visible:bg-surface-container-low focus-visible:outline-none"
          : "cursor-default",
      ].join(" ")}
      disabled={!canEdit}
      onClick={() => {
        if (canEdit) {
          setEditing(true);
        }
      }}
      type="button"
    >
      <h2
        className={[
          "min-w-0 truncate font-semibold leading-6 text-primary transition-all duration-500",
          hasMessages ? "text-base sm:text-lg" : "text-xl sm:text-2xl",
        ].join(" ")}
      >
        {displayTitle}
      </h2>
      {canEdit ? (
        <>
          <MaterialIcon
            className="shrink-0 text-on-surface-variant opacity-0 transition group-hover/title:text-primary group-hover/title:opacity-100 group-focus-visible/title:text-primary group-focus-visible/title:opacity-100"
            name="edit"
            size={16}
          />
          <span className="pointer-events-none absolute left-0 top-[calc(100%+8px)] z-[120] w-64 translate-y-[-0.25rem] rounded-sm border border-outline-variant bg-surface px-3 py-2 text-left text-[11px] font-medium normal-case leading-4 text-on-surface opacity-0 shadow-[0_12px_28px_rgb(27_28_25/0.14)] transition-[opacity,transform] duration-[180ms] ease-in group-hover/title:translate-y-0 group-hover/title:opacity-100 group-hover/title:duration-200 group-hover/title:ease-out group-focus-visible/title:translate-y-0 group-focus-visible/title:opacity-100 group-focus-visible/title:duration-200 group-focus-visible/title:ease-out">
            Click to rename this conversation. Save an empty title to auto-generate one.
          </span>
        </>
      ) : null}
    </button>
  );
}

function TitleIconButton({
  disabled,
  icon,
  label,
  onClick,
  type = "button",
}: {
  disabled?: boolean;
  icon: string;
  label: string;
  onClick?(): void;
  type?: "button" | "submit";
}) {
  return (
    <button
      aria-label={label}
      className="group/title-action relative grid h-8 w-8 shrink-0 place-items-center rounded-sm text-on-surface-variant transition hover:bg-surface-container hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      <MaterialIcon name={icon} size={18} />
      <span className="pointer-events-none absolute top-[calc(100%+7px)] left-1/2 z-[120] w-max max-w-44 -translate-x-1/2 translate-y-[-0.25rem] rounded-sm border border-outline-variant bg-surface px-2 py-1 text-xs font-medium text-on-surface opacity-0 shadow-[0_10px_24px_rgb(27_28_25/0.14)] transition group-hover/title-action:translate-y-0 group-hover/title-action:opacity-100 group-focus-visible/title-action:translate-y-0 group-focus-visible/title-action:opacity-100">
        {label}
      </span>
    </button>
  );
}
