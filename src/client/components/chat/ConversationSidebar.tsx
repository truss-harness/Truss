import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, MouseEvent, ReactNode } from "react";
import type {
  AgentSessionSummary,
  ConversationScopeSummary,
  ScheduledTaskSessionSummary,
  WorkspaceSummary,
} from "../../../shared/protocol.ts";
import { MaterialIcon } from "../MaterialIcon.tsx";
import { Modal } from "../Modal.tsx";
import {
  errorMessage,
  formatCompactCount,
  formatConversationDate,
  formatLabeledCount,
} from "./chat-utils.ts";
import type { ConversationExportFormat } from "./types.ts";

interface SidebarContextMenuState {
  keepSearchActive: boolean;
  left: number;
  session: AgentSessionSummary;
  top: number;
}

type DeleteConversationTarget = Pick<AgentSessionSummary, "id" | "title">;

interface WorkspaceMenuState {
  left: number;
  top: number;
}

export function DesktopSidebar({
  activeSessionId,
  conversations,
  disabled,
  error,
  loading,
  mobileOpen = false,
  onAutoRename,
  onCopyToClipboard,
  onDelete,
  onDuplicate,
  onExport,
  onManualRename,
  onMobileClose,
  onNewChat,
  onNewWorkspace,
  onOpenConversation,
  onOpenWorkspace,
  onRefreshWorkspaces,
  onReturnToGlobalView,
  onSearchChange,
  onSearchFocusChange,
  onSettings,
  onDeleteWorkspace,
  scheduledTaskSessions,
  scheduledTaskSessionsError,
  scheduledTaskSessionsLoading,
  searchValue,
  scope,
  workspaceError,
  workspaceLoading,
  workspaceNavigationPending,
  workspaces,
}: {
  activeSessionId: string | null;
  conversations: AgentSessionSummary[];
  disabled: boolean;
  error: string | null;
  loading: boolean;
  mobileOpen?: boolean;
  onAutoRename(session: AgentSessionSummary): void;
  onCopyToClipboard(session: AgentSessionSummary): void;
  onDelete(session: AgentSessionSummary): void;
  onDeleteWorkspace(workspace: WorkspaceSummary): void;
  onDuplicate(session: AgentSessionSummary): void;
  onExport(session: AgentSessionSummary, format: ConversationExportFormat): void;
  onManualRename(session: AgentSessionSummary): void;
  onMobileClose?(): void;
  onNewChat(): void;
  onNewWorkspace(): void;
  onOpenConversation(sessionId: string): void;
  onOpenWorkspace(workspace: WorkspaceSummary): void;
  onRefreshWorkspaces(): void;
  onReturnToGlobalView(): void;
  onSearchChange(value: string): void;
  onSearchFocusChange(focused: boolean): void;
  onSettings(): void;
  scheduledTaskSessions: ScheduledTaskSessionSummary[];
  scheduledTaskSessionsError: string | null;
  scheduledTaskSessionsLoading: boolean;
  searchValue: string;
  scope: ConversationScopeSummary | null;
  workspaceError: string | null;
  workspaceLoading: boolean;
  workspaceNavigationPending: boolean;
  workspaces: WorkspaceSummary[];
}) {
  const [searchFocused, setSearchFocused] = useState(false);
  const [contextMenu, setContextMenu] = useState<SidebarContextMenuState | null>(null);
  const [workspaceMenu, setWorkspaceMenu] = useState<WorkspaceMenuState | null>(null);
  const searchBlurTimeoutRef = useRef<number | null>(null);
  const textSearchActive = searchFocused || searchValue.trim().length > 0;
  const searchActive = textSearchActive || contextMenu?.keepSearchActive === true;

  useEffect(() => {
    onSearchFocusChange(searchActive);
  }, [onSearchFocusChange, searchActive]);

  useEffect(() => {
    return () => onSearchFocusChange(false);
  }, [onSearchFocusChange]);

  useEffect(
    () => () => {
      clearSearchBlurTimeout();
    },
    [],
  );

  useEffect(() => {
    if (!contextMenu && !workspaceMenu) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;

      if (target instanceof Element && target.closest("[data-sidebar-context-menu]")) {
        return;
      }

      setContextMenu(null);
      setWorkspaceMenu(null);
    }

    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") {
        setContextMenu(null);
        setWorkspaceMenu(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu, workspaceMenu]);

  function clearSearchBlurTimeout(): void {
    if (searchBlurTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(searchBlurTimeoutRef.current);
    searchBlurTimeoutRef.current = null;
  }

  function handleSearchBlur(): void {
    clearSearchBlurTimeout();
    searchBlurTimeoutRef.current = window.setTimeout(() => {
      setSearchFocused(false);
      searchBlurTimeoutRef.current = null;
    }, 150);
  }

  function handleSearchFocus(): void {
    clearSearchBlurTimeout();
    setSearchFocused(true);
  }

  function openContextMenu(session: AgentSessionSummary, left: number, top: number): void {
    const menuWidth = 240;
    const submenuWidth = 192;
    const maxLeft = Math.max(12, window.innerWidth - menuWidth - submenuWidth - 16);
    const maxTop = Math.max(12, window.innerHeight - 392);

    setContextMenu({
      keepSearchActive: textSearchActive,
      left: Math.min(Math.max(12, left), maxLeft),
      session,
      top: Math.min(Math.max(12, top), maxTop),
    });
  }

  function closeContextMenu(): void {
    setContextMenu(null);
  }

  function openWorkspaceMenu(event: MouseEvent<HTMLButtonElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 344;
    const submenuWidth = 276;
    const maxLeft = Math.max(12, window.innerWidth - menuWidth - submenuWidth - 16);
    const maxTop = Math.max(12, window.innerHeight - 440);

    onRefreshWorkspaces();
    setContextMenu(null);
    setWorkspaceMenu({
      left: Math.min(Math.max(12, rect.right + 8), maxLeft),
      top: Math.min(Math.max(12, rect.top), maxTop),
    });
  }

  function closeWorkspaceMenu(): void {
    setWorkspaceMenu(null);
  }

  function renderSidebarPanel(mobile: boolean): ReactNode {
    return (
      <div
        className={
          mobile
            ? "relative flex h-full min-h-0 w-full flex-col border-r border-outline-variant bg-surface-container-low px-3 py-3 shadow-[24px_0_70px_rgb(27_28_25/0.18)]"
            : [
                "absolute inset-y-0 left-0 flex min-h-screen flex-col border-r border-outline-variant bg-surface-container-low/85 px-3 py-3 transition-[width,box-shadow] duration-300 ease-out",
                searchActive
                  ? "w-[50rem] shadow-[24px_0_70px_rgb(27_28_25/0.18)]"
                  : "w-80 shadow-none",
              ].join(" ")
        }
      >
        {mobile ? (
          <button
            aria-label="Close conversation sidebar"
            className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-sm text-on-surface-variant transition hover:bg-surface-container hover:text-primary focus-visible:bg-surface-container focus-visible:text-primary focus-visible:outline-none"
            onClick={onMobileClose}
            type="button"
          >
            <MaterialIcon name="close" size={20} />
          </button>
        ) : null}
        <BrandLockup />
        {scope?.mode === "workspace" ? (
          <ConversationScopeIndicator className="mt-3" scope={scope} />
        ) : null}
        <SidebarWorkspaceNavigation
          disabled={disabled || workspaceNavigationPending || !scope}
          menuOpen={Boolean(workspaceMenu)}
          onOpenMenu={openWorkspaceMenu}
          onReturnToGlobalView={onReturnToGlobalView}
          pending={workspaceNavigationPending}
          scope={scope}
        />

        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase text-on-surface">Recent Conversations</p>
            <a
              href="/history"
              className="text-[11px] text-primary hover:underline"
              title="Manage history"
            >
              History
            </a>
          </div>
          <label className="mt-3 flex h-10 items-center gap-2 rounded-sm border border-outline-variant/70 bg-surface-container px-3 text-on-surface-variant transition focus-within:border-outline focus-within:bg-surface">
            <MaterialIcon name="search" size={20} />
            <input
              aria-label="Search conversations"
              className="min-w-0 flex-1 border-0 bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant/50 focus:ring-0"
              onBlur={handleSearchBlur}
              onChange={(event) => onSearchChange(event.target.value)}
              onFocus={handleSearchFocus}
              placeholder="Search conversations..."
              type="search"
              value={searchValue}
            />
          </label>
          <nav
            aria-label="Past conversations"
            className="mt-2 grid min-h-0 flex-1 content-start gap-1 overflow-y-auto pr-1"
          >
            {error ? (
              <SidebarMessage>{error}</SidebarMessage>
            ) : loading ? (
              <SidebarMessage>Loading conversations...</SidebarMessage>
            ) : conversations.length === 0 ? (
              <SidebarMessage>
                {searchValue.trim() ? "No matching conversations" : "No conversations yet"}
              </SidebarMessage>
            ) : (
              conversations.map((conversation) => (
                <ConversationListItem
                  active={conversation.id === activeSessionId}
                  disabled={disabled}
                  key={conversation.id}
                  onClick={() => onOpenConversation(conversation.id)}
                  onOpenContextMenu={openContextMenu}
                  session={conversation}
                  showStats={searchActive}
                />
              ))
            )}
          </nav>
        </div>

        <div className="mt-3 grid shrink-0 gap-1.5 pt-1">
          <button
            className="inline-flex h-12 min-h-12 w-full shrink-0 items-center justify-center gap-2 rounded-sm border border-primary bg-primary px-4 text-sm font-semibold leading-none text-on-primary shadow-[0_10px_22px_rgb(27_28_25/0.12)] transition hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-45"
            disabled={disabled}
            onClick={onNewChat}
            type="button"
          >
            <MaterialIcon name="add" size={18} />
            <span className="whitespace-nowrap">New Chat</span>
          </button>
          <button
            className="inline-flex h-10 min-h-10 w-full shrink-0 items-center justify-center gap-2 rounded-sm border border-outline-variant bg-surface-container px-4 text-sm font-semibold leading-none text-on-surface-variant transition hover:border-outline hover:bg-surface hover:text-primary"
            onClick={onSettings}
            type="button"
          >
            <MaterialIcon name="settings" size={17} />
            <span className="whitespace-nowrap">Settings</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <aside className="relative z-40 hidden min-h-screen w-80 shrink-0 overflow-visible md:block">
        {renderSidebarPanel(false)}
      </aside>
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            aria-label="Close conversation sidebar"
            className="absolute inset-0 h-full w-full bg-inverse-surface/35 backdrop-blur-[2px]"
            onClick={onMobileClose}
            type="button"
          />
          <aside className="absolute inset-y-0 left-0 w-[min(22rem,calc(100vw-3rem))] max-w-full overflow-visible">
            {renderSidebarPanel(true)}
          </aside>
        </div>
      ) : null}
      <SidebarContextMenu
        disabled={disabled}
        menu={contextMenu}
        onAutoRename={onAutoRename}
        onClose={closeContextMenu}
        onCopyToClipboard={onCopyToClipboard}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        onExport={onExport}
        onManualRename={onManualRename}
      />
      <WorkspaceContextMenu
        disabled={disabled || workspaceNavigationPending}
        error={workspaceError}
        loading={workspaceLoading}
        menu={workspaceMenu}
        onClose={closeWorkspaceMenu}
        onDeleteWorkspace={onDeleteWorkspace}
        onNewWorkspace={onNewWorkspace}
        onOpenConversation={onOpenConversation}
        onOpenWorkspace={onOpenWorkspace}
        scheduledTaskSessions={scheduledTaskSessions}
        scheduledTaskSessionsError={scheduledTaskSessionsError}
        scheduledTaskSessionsLoading={scheduledTaskSessionsLoading}
        workspaces={workspaces}
      />
    </>
  );
}

function SidebarWorkspaceNavigation({
  disabled,
  menuOpen,
  onOpenMenu,
  onReturnToGlobalView,
  pending,
  scope,
}: {
  disabled: boolean;
  menuOpen: boolean;
  onOpenMenu(event: MouseEvent<HTMLButtonElement>): void;
  onReturnToGlobalView(): void;
  pending: boolean;
  scope: ConversationScopeSummary | null;
}) {
  const scoped = scope?.mode === "workspace";

  return (
    <div className="mt-2">
      {scoped ? (
        <button
          className="flex h-9 w-full items-center gap-2 rounded-sm border border-outline-variant bg-surface-container px-3 text-left text-sm font-semibold text-on-surface-variant transition hover:border-outline hover:bg-surface hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
          disabled={disabled}
          onClick={onReturnToGlobalView}
          title="Global View"
          type="button"
        >
          <MaterialIcon className="shrink-0" name="keyboard_return" size={18} />
          <span className="min-w-0 flex-1 truncate">
            {pending ? "Opening Global View..." : "Global View"}
          </span>
        </button>
      ) : (
        <button
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="flex h-9 w-full items-center gap-2 rounded-sm border border-outline-variant bg-surface-container px-3 text-left text-sm font-semibold text-on-surface-variant transition hover:border-outline hover:bg-surface hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
          disabled={disabled}
          onClick={onOpenMenu}
          title="Workspaces"
          type="button"
        >
          <MaterialIcon className="shrink-0" name="workspaces" size={18} />
          <span className="min-w-0 flex-1 truncate">Workspaces</span>
          <MaterialIcon className="shrink-0" name="chevron_right" size={17} />
        </button>
      )}
    </div>
  );
}

function ConversationListItem({
  active,
  disabled,
  onClick,
  onOpenContextMenu,
  session,
  showStats,
}: {
  active: boolean;
  disabled: boolean;
  onClick(): void;
  onOpenContextMenu(session: AgentSessionSummary, left: number, top: number): void;
  session: AgentSessionSummary;
  showStats: boolean;
}) {
  const modeIcon = session.type === "agentic" ? "smart_toy" : "chat_bubble";
  const modeLabel = session.type === "agentic" ? "Agent" : "Conversation";
  const modeBadgeClass =
    session.type === "agentic"
      ? "bg-tertiary-container text-on-tertiary"
      : "bg-secondary-container text-on-secondary-container";

  function handleContextMenu(event: MouseEvent<HTMLElement>): void {
    if (disabled) {
      return;
    }

    event.preventDefault();
    onOpenContextMenu(session, event.clientX, event.clientY);
  }

  function handleMenuButtonClick(event: MouseEvent<HTMLButtonElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();

    event.stopPropagation();
    onOpenContextMenu(session, rect.right + 8, rect.top);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (disabled || (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();

    event.preventDefault();
    onOpenContextMenu(session, rect.right - 12, rect.top + 12);
  }

  return (
    <div
      className="group relative min-w-0"
      onContextMenu={handleContextMenu}
    >
      <button
        aria-current={active ? "page" : undefined}
        className={[
          "min-h-8 w-full min-w-0 rounded-sm border py-1 pl-2.5 pr-9 text-left transition disabled:cursor-not-allowed disabled:opacity-45",
          active
            ? "border-primary bg-surface text-primary shadow-[0_8px_20px_rgb(27_28_25/0.07)]"
            : "border-transparent text-on-surface-variant hover:border-outline-variant hover:bg-surface-container",
          showStats
            ? "grid grid-cols-[1.1rem_minmax(0,1fr)_3.75rem_5.75rem_5.25rem] items-center gap-2"
            : "flex items-center gap-1.5",
        ].join(" ")}
        disabled={disabled}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        type="button"
      >
        <span
          aria-label={modeLabel}
          className={[
            "inline-grid h-4 w-4 shrink-0 place-items-center rounded-sm",
            modeBadgeClass,
          ].join(" ")}
        >
          <MaterialIcon name={modeIcon} size={10} />
        </span>
        <span className={showStats ? "min-w-0" : "min-w-0 flex-1"}>
          <span className="block truncate text-xs font-semibold text-on-surface">
            {session.title ?? "Untitled conversation"}
          </span>
        </span>
        <span className="shrink-0 text-[11px] font-medium uppercase text-on-surface-variant">
          {formatConversationDate(session.updatedAt)}
        </span>
        {showStats ? (
          <>
            <span
              aria-label={formatLabeledCount(session.messageCount, "message")}
              className="shrink-0 text-right text-[11px] font-medium text-on-surface-variant"
            >
              {formatCompactCount(session.messageCount)} msgs
            </span>
            <span
              aria-label={formatLabeledCount(session.wordCount, "word")}
              className="shrink-0 text-right text-[11px] font-medium text-on-surface-variant"
            >
              {formatCompactCount(session.wordCount)} words
            </span>
          </>
        ) : null}
      </button>
      <button
        aria-label={`Open actions for ${session.title ?? "Untitled conversation"}`}
        aria-haspopup="menu"
        className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-sm text-on-surface-variant opacity-0 transition hover:bg-surface hover:text-primary focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
        disabled={disabled}
        onClick={handleMenuButtonClick}
        type="button"
      >
        <MaterialIcon name="more_horiz" size={16} />
      </button>
    </div>
  );
}

function SidebarContextMenu({
  disabled,
  menu,
  onAutoRename,
  onClose,
  onCopyToClipboard,
  onDelete,
  onDuplicate,
  onExport,
  onManualRename,
}: {
  disabled: boolean;
  menu: SidebarContextMenuState | null;
  onAutoRename(session: AgentSessionSummary): void;
  onClose(): void;
  onCopyToClipboard(session: AgentSessionSummary): void;
  onDelete(session: AgentSessionSummary): void;
  onDuplicate(session: AgentSessionSummary): void;
  onExport(session: AgentSessionSummary, format: ConversationExportFormat): void;
  onManualRename(session: AgentSessionSummary): void;
}) {
  if (!menu) {
    return null;
  }

  const activeMenu = menu;

  function runAction(action: (session: AgentSessionSummary) => void): void {
    onClose();
    action(activeMenu.session);
  }

  function runExport(format: ConversationExportFormat): void {
    onClose();
    onExport(activeMenu.session, format);
  }

  return (
    <div
      aria-label="Conversation actions"
      className="truss-sidebar-menu fixed z-[140] w-60 overflow-visible rounded-sm border border-outline-variant bg-surface py-1 text-on-surface shadow-[0_18px_44px_rgb(27_28_25/0.16)]"
      data-sidebar-context-menu
      role="menu"
      style={{ left: activeMenu.left, top: activeMenu.top }}
    >
      <ContextMenuSessionSummary session={activeMenu.session} />
      <div className="my-1 border-t border-outline-variant/70" />
      <ContextMenuButton
        disabled={disabled}
        icon="control_point_duplicate"
        label="Duplicate"
        onClick={() => runAction(onDuplicate)}
      />
      <ContextMenuButton
        disabled={disabled}
        icon="content_copy"
        label="Copy All to Clipboard"
        onClick={() => runAction(onCopyToClipboard)}
      />
      <ContextMenuSubmenu icon="ios_share" label="Export">
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
      <ContextMenuSubmenu icon="drive_file_rename_outline" label="Rename">
        <ContextMenuButton
          disabled={disabled}
          icon="auto_fix_high"
          label="Auto-rename"
          onClick={() => runAction(onAutoRename)}
        />
        <ContextMenuButton
          disabled={disabled}
          icon="edit"
          label="Manual rename"
          onClick={() => runAction(onManualRename)}
        />
      </ContextMenuSubmenu>
      <div className="my-1 border-t border-outline-variant/70" />
      <ContextMenuButton
        danger
        disabled={disabled}
        icon="delete"
        label="Delete"
        onClick={() => runAction(onDelete)}
      />
    </div>
  );
}

function WorkspaceContextMenu({
  disabled,
  error,
  loading,
  menu,
  onClose,
  onDeleteWorkspace,
  onNewWorkspace,
  onOpenConversation,
  onOpenWorkspace,
  scheduledTaskSessions,
  scheduledTaskSessionsError,
  scheduledTaskSessionsLoading,
  workspaces,
}: {
  disabled: boolean;
  error: string | null;
  loading: boolean;
  menu: WorkspaceMenuState | null;
  onClose(): void;
  onDeleteWorkspace(workspace: WorkspaceSummary): void;
  onNewWorkspace(): void;
  onOpenConversation(sessionId: string): void;
  onOpenWorkspace(workspace: WorkspaceSummary): void;
  scheduledTaskSessions: ScheduledTaskSessionSummary[];
  scheduledTaskSessionsError: string | null;
  scheduledTaskSessionsLoading: boolean;
  workspaces: WorkspaceSummary[];
}) {
  if (!menu) {
    return null;
  }

  function runNewWorkspace(): void {
    onClose();
    onNewWorkspace();
  }

  function runWorkspaceAction(
    workspace: WorkspaceSummary,
    action: (workspace: WorkspaceSummary) => void,
  ): void {
    onClose();
    action(workspace);
  }

  return (
    <div
      aria-label="Workspaces"
      className="truss-sidebar-menu fixed z-[140] w-[21.5rem] overflow-visible rounded-sm border border-outline-variant bg-surface py-1 text-on-surface shadow-[0_18px_44px_rgb(27_28_25/0.16)]"
      data-sidebar-context-menu
      role="menu"
      style={{ left: menu.left, top: menu.top }}
    >
      <ContextMenuButton
        disabled={disabled}
        icon="create_new_folder"
        label="New Workspace"
        onClick={runNewWorkspace}
      />
      <ScheduledTasksMenuBranch
        disabled={disabled}
        error={scheduledTaskSessionsError}
        loading={scheduledTaskSessionsLoading}
        onClose={onClose}
        onOpenConversation={onOpenConversation}
        sessions={scheduledTaskSessions}
      />
      <div className="my-1 border-t border-outline-variant/70" />
      {error ? (
        <WorkspaceMenuMessage>{error}</WorkspaceMenuMessage>
      ) : loading ? (
        <WorkspaceMenuMessage>Loading workspaces...</WorkspaceMenuMessage>
      ) : workspaces.length === 0 ? (
        <WorkspaceMenuMessage>No workspace conversations yet</WorkspaceMenuMessage>
      ) : (
        workspaces.map((workspace) => (
          <WorkspaceMenuBranch
            disabled={disabled}
            key={workspace.workspacePath}
            onDelete={() => runWorkspaceAction(workspace, onDeleteWorkspace)}
            onOpen={() => runWorkspaceAction(workspace, onOpenWorkspace)}
            workspace={workspace}
          />
        ))
      )}
    </div>
  );
}

function WorkspaceMenuBranch({
  disabled,
  onDelete,
  onOpen,
  workspace,
}: {
  disabled: boolean;
  onDelete(): void;
  onOpen(): void;
  workspace: WorkspaceSummary;
}) {
  const conversationCount = formatLabeledCount(workspace.sessionCount, "conversation");
  const dateRange = formatWorkspaceDateRange(workspace.firstCreatedAt, workspace.lastCreatedAt);

  return (
    <div className="truss-sidebar-menu-branch relative" role="none">
      <button
        aria-haspopup="menu"
        className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left text-sm text-on-surface-variant transition hover:bg-surface-container hover:text-primary focus-visible:bg-surface-container focus-visible:text-primary disabled:cursor-not-allowed disabled:opacity-45"
        disabled={disabled}
        role="menuitem"
        title={workspace.workspacePath}
        type="button"
      >
        <MaterialIcon className="shrink-0" name="folder_open" size={19} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate font-semibold text-on-surface">{workspace.displayName}</span>
          <span className="truncate text-[11px] font-medium text-on-surface-variant">
            {conversationCount}
            {dateRange ? ` | ${dateRange}` : ""}
          </span>
        </span>
        <MaterialIcon className="shrink-0" name="chevron_right" size={18} />
      </button>
      <div
        className="truss-sidebar-submenu absolute left-[calc(100%-2px)] top-0 z-[1] w-72 rounded-sm border border-outline-variant bg-surface py-1 shadow-[0_18px_44px_rgb(27_28_25/0.16)]"
        role="menu"
      >
        <ContextMenuButton
          disabled={disabled}
          icon="folder_open"
          label="Open Workspace"
          onClick={onOpen}
        />
        <div className="my-1 border-t border-outline-variant/70" />
        <ContextMenuButton
          danger
          disabled={disabled}
          icon="delete_forever"
          label="Delete Workspace with All Sessions"
          onClick={onDelete}
          wrap
        />
      </div>
    </div>
  );
}

function ScheduledTasksMenuBranch({
  disabled,
  error,
  loading,
  onClose,
  onOpenConversation,
  sessions,
}: {
  disabled: boolean;
  error: string | null;
  loading: boolean;
  onClose(): void;
  onOpenConversation(sessionId: string): void;
  sessions: ScheduledTaskSessionSummary[];
}) {
  function openManage(): void {
    onClose();
    window.location.href = "/scheduled-tasks";
  }

  function openSession(sessionId: string): void {
    onClose();
    onOpenConversation(sessionId);
  }

  return (
    <ContextMenuSubmenu icon="schedule" label="Scheduled Tasks" wide>
      <ContextMenuButton
        disabled={disabled}
        icon="schedule"
        label="Manage scheduled tasks"
        onClick={openManage}
      />
      <div className="my-1 border-t border-outline-variant/70" />
      {error ? (
        <WorkspaceMenuMessage>{error}</WorkspaceMenuMessage>
      ) : loading ? (
        <WorkspaceMenuMessage>Loading scheduled tasks...</WorkspaceMenuMessage>
      ) : sessions.length === 0 ? (
        <WorkspaceMenuMessage>No scheduled task sessions yet</WorkspaceMenuMessage>
      ) : (
        sessions.map((session) => (
          <ScheduledTaskSessionItem
            disabled={disabled}
            key={session.id}
            onClick={() => openSession(session.id)}
            session={session}
          />
        ))
      )}
    </ContextMenuSubmenu>
  );
}

function ScheduledTaskSessionItem({
  disabled,
  onClick,
  session,
}: {
  disabled: boolean;
  onClick(): void;
  session: ScheduledTaskSessionSummary;
}) {
  const runStartedAt = formatScheduledTaskRunStartedAt(session.runStartedAt);
  const label = runStartedAt ? `${session.taskName} ${runStartedAt}` : session.taskName;

  return (
    <ContextMenuButton disabled={disabled} icon="smart_toy" label={label} onClick={onClick} />
  );
}

function formatScheduledTaskRunStartedAt(startedAt: string): string {
  const date = new Date(startedAt);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function WorkspaceMenuMessage({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 py-3 text-sm leading-5 text-on-surface-variant" role="none">
      {children}
    </p>
  );
}

function formatWorkspaceDateRange(firstCreatedAt: string, lastCreatedAt: string): string {
  const first = formatWorkspaceMonthYear(firstCreatedAt);
  const last = formatWorkspaceMonthYear(lastCreatedAt);

  if (!first || !last) {
    return first || last;
  }

  return first === last ? first : `${first} - ${last}`;
}

function formatWorkspaceMonthYear(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

function ContextMenuSessionSummary({ session }: { session: AgentSessionSummary }) {
  const modeLabel = session.type === "agentic" ? "Agent" : "Conversation";
  const modeBadgeClass =
    session.type === "agentic"
      ? "bg-tertiary-container text-on-tertiary"
      : "bg-secondary-container text-on-secondary-container";

  return (
    <div className="px-3 pb-2 pt-2 text-xs leading-5 text-on-surface-variant" role="none">
      <div className="grid min-w-0 gap-1">
        <span className="min-w-0 truncate font-semibold text-on-surface">
          {session.title ?? "Untitled conversation"}
        </span>
        <span
          className={`w-fit rounded-sm px-2 py-0.5 text-[11px] font-medium uppercase ${modeBadgeClass}`}
        >
          {modeLabel}
        </span>
      </div>
      <div className="mt-2 grid gap-1">
        <ContextMenuInfoRow label="Last model" value={session.modelId} />
        <ContextMenuInfoRow
          label="Messages"
          value={formatLabeledCount(session.messageCount, "message")}
        />
        <ContextMenuInfoRow
          label="Words"
          value={formatLabeledCount(session.wordCount, "word")}
        />
      </div>
    </div>
  );
}

function ContextMenuInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-2" role="none">
      <span>{label}</span>
      <span className="min-w-0 truncate font-medium text-on-surface">{value}</span>
    </div>
  );
}

export function ContextMenuSubmenu({
  align = "right",
  children,
  className = "",
  icon,
  label,
  wide = false,
}: {
  align?: "left" | "right";
  children: ReactNode;
  className?: string;
  icon: string;
  label: string;
  wide?: boolean;
}) {
  const submenuPosition =
    align === "left" ? "right-[calc(100%-2px)]" : "left-[calc(100%-2px)]";

  return (
    <div className={["truss-sidebar-menu-branch relative", className].join(" ")} role="none">
      <button
        aria-haspopup="menu"
        className="flex h-9 w-full items-center gap-3 px-3 text-left text-sm font-medium text-on-surface-variant transition hover:bg-surface-container hover:text-primary focus-visible:bg-surface-container focus-visible:text-primary"
        role="menuitem"
        type="button"
      >
        <MaterialIcon className="shrink-0" name={icon} size={18} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <MaterialIcon className="shrink-0" name="chevron_right" size={18} />
      </button>
      <div
        className={[
          "truss-sidebar-submenu absolute top-0 z-[1] rounded-sm border border-outline-variant bg-surface py-1 shadow-[0_18px_44px_rgb(27_28_25/0.16)]",
          wide ? "w-80" : "w-48",
          submenuPosition,
        ].join(" ")}
        role="menu"
      >
        {children}
      </div>
    </div>
  );
}

export function ContextMenuButton({
  danger = false,
  disabled,
  icon,
  label,
  onClick,
  wrap = false,
}: {
  danger?: boolean;
  disabled: boolean;
  icon: string;
  label: string;
  onClick(): void;
  wrap?: boolean;
}) {
  return (
    <button
      className={[
        "flex w-full items-center gap-3 px-3 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-45",
        wrap ? "min-h-9 py-2" : "h-9",
        danger
          ? "text-error hover:bg-error-container/35 focus-visible:bg-error-container/35"
          : "text-on-surface-variant hover:bg-surface-container hover:text-primary focus-visible:bg-surface-container focus-visible:text-primary",
      ].join(" ")}
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <MaterialIcon className="shrink-0" name={icon} size={18} />
      <span className={wrap ? "min-w-0 flex-1 leading-5" : "min-w-0 flex-1 truncate"}>
        {label}
      </span>
    </button>
  );
}

function SidebarMessage({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-sm border border-outline-variant/50 bg-surface-container px-3 py-3 text-sm text-on-surface-variant">
      {children}
    </p>
  );
}

export function ConversationScopeIndicator({
  className = "",
  scope,
}: {
  className?: string;
  scope: ConversationScopeSummary;
}) {
  const scoped = scope.mode === "workspace";
  const folderName = workspaceFolderName(scope.workspacePath);
  const label = scoped ? "Workspace View" : "Global View";
  const detail = scoped ? compactWorkspacePath(scope.workspacePath) : "All projects";
  const tooltip = scoped ? `Workspace: ${folderName}` : "Global View";

  return (
    <div
      aria-label={tooltip}
      className={[
        "flex min-w-0 max-w-full items-center gap-3 rounded-sm border border-outline-variant bg-secondary-container/55 px-3 py-2 text-secondary shadow-[0_8px_18px_rgb(27_28_25/0.06)]",
        className,
      ].join(" ")}
      title={tooltip}
    >
      <MaterialIcon className="shrink-0" name={scoped ? "folder_open" : "public"} size={18} />
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate text-xs font-semibold">{label}</span>
        <span className="truncate text-[11px] font-medium text-secondary/75">{detail}</span>
      </span>
    </div>
  );
}

function compactWorkspacePath(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);

  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : path;
}

function workspaceFolderName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]+/).filter(Boolean).at(-1) ?? path;
}

export function ManualRenameDialog({
  onClose,
  onRename,
  session,
}: {
  onClose(): void;
  onRename(session: AgentSessionSummary, title: string): Promise<void>;
  session: AgentSessionSummary | null;
}) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(session?.title ?? "");
    setError(null);
    setBusy(false);
  }, [session]);

  if (!session) {
    return null;
  }

  const activeSession = session;
  const formId = "rename-conversation-form";

  async function submitRename(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (busy || !draft.trim()) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await onRename(activeSession, draft.trim());
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <Modal
      closeLabel="Close rename dialog"
      description={activeSession.title ?? "Untitled conversation"}
      icon="edit"
      onClose={busy ? () => undefined : onClose}
      open
      size="sm"
      title="Rename conversation"
      footer={
        <>
          <button
            className="h-10 rounded-sm border border-outline-variant px-4 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-45"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="h-10 rounded-sm border border-primary bg-primary px-4 text-sm font-semibold text-on-primary transition hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-45"
            disabled={busy || !draft.trim()}
            form={formId}
            type="submit"
          >
            Rename
          </button>
        </>
      }
    >
      <form
        className="grid gap-4"
        id={formId}
        onSubmit={(event) => void submitRename(event)}
      >
        <label className="grid gap-2 text-xs font-medium uppercase text-on-surface-variant">
          Title
          <input
            className="h-11 w-full rounded-sm border border-outline-variant bg-surface-container-low px-3 text-sm normal-case text-on-surface outline-none transition focus:border-outline focus:bg-surface"
            data-autofocus="true"
            maxLength={240}
            onChange={(event) => setDraft(event.target.value)}
            value={draft}
          />
        </label>

        {error ? (
          <p className="mt-3 rounded-sm border border-error-container bg-error-container/25 px-3 py-2 text-sm text-error">
            {error}
          </p>
        ) : null}

      </form>
    </Modal>
  );
}

export function DeleteConversationDialog({
  onClose,
  onDelete,
  session,
}: {
  onClose(): void;
  onDelete(session: DeleteConversationTarget): Promise<void>;
  session: DeleteConversationTarget | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setBusy(false);
  }, [session]);

  if (!session) {
    return null;
  }

  const activeSession = session;
  const formId = "delete-conversation-form";

  async function submitDelete(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await onDelete(activeSession);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <Modal
      closeLabel="Close delete dialog"
      description="This removes the conversation and its messages from Truss."
      icon="delete"
      onClose={busy ? () => undefined : onClose}
      open
      role="alertdialog"
      size="sm"
      title="Delete conversation?"
      footer={
        <>
          <button
            className="h-10 rounded-sm border border-outline-variant px-4 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-45"
            data-autofocus="true"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-sm border border-error bg-error px-4 text-sm font-semibold text-on-primary transition hover:bg-on-error-container disabled:cursor-not-allowed disabled:opacity-45"
            disabled={busy}
            form={formId}
            type="submit"
          >
            <MaterialIcon name="delete" size={18} />
            Delete
          </button>
        </>
      }
    >
      <form
        className="grid gap-3"
        id={formId}
        onSubmit={(event) => void submitDelete(event)}
      >
        <p className="text-sm leading-6 text-on-surface-variant">
          This removes the conversation and its messages from Truss.
        </p>
        <p className="truncate rounded-sm border border-outline-variant/70 bg-surface-container-low px-3 py-2 text-sm font-medium text-on-surface">
          {activeSession.title ?? "Untitled conversation"}
        </p>

        {error ? (
          <p className="rounded-sm border border-error-container bg-error-container/25 px-3 py-2 text-sm text-error">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

export function DeleteWorkspaceDialog({
  onClose,
  onDelete,
  workspace,
}: {
  onClose(): void;
  onDelete(workspace: WorkspaceSummary): Promise<void>;
  workspace: WorkspaceSummary | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setBusy(false);
  }, [workspace]);

  if (!workspace) {
    return null;
  }

  const activeWorkspace = workspace;
  const formId = "delete-workspace-form";
  const sessionCount = formatLabeledCount(activeWorkspace.sessionCount, "conversation");

  async function submitDelete(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await onDelete(activeWorkspace);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <Modal
      closeLabel="Close workspace delete dialog"
      description="This permanently removes every conversation in the workspace."
      icon="delete_forever"
      onClose={busy ? () => undefined : onClose}
      open
      role="alertdialog"
      size="sm"
      title="Delete workspace sessions?"
      footer={
        <>
          <button
            className="h-10 rounded-sm border border-outline-variant px-4 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-45"
            data-autofocus="true"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-sm border border-error bg-error px-4 text-sm font-semibold text-on-primary transition hover:bg-on-error-container disabled:cursor-not-allowed disabled:opacity-45"
            disabled={busy}
            form={formId}
            type="submit"
          >
            <MaterialIcon name="delete_forever" size={18} />
            Delete All
          </button>
        </>
      }
    >
      <form className="grid gap-3" id={formId} onSubmit={(event) => void submitDelete(event)}>
        <p className="text-sm leading-6 text-on-surface-variant">
          Truss will permanently delete {sessionCount} for this workspace, including associated
          sub-agent sessions and messages. This action cannot be undone.
        </p>
        <div className="grid gap-1 rounded-sm border border-outline-variant/70 bg-surface-container-low px-3 py-2 text-sm">
          <span className="font-semibold text-on-surface">{activeWorkspace.displayName}</span>
          <span className="break-all font-medium text-on-surface-variant">
            {activeWorkspace.workspacePath}
          </span>
        </div>

        {error ? (
          <p className="rounded-sm border border-error-container bg-error-container/25 px-3 py-2 text-sm text-error">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function BrandLockup() {
  return (
    <div className="flex h-12 items-center">
      <img
        alt="Truss"
        className="h-12 w-auto max-w-[11rem] shrink-0 object-contain"
        decoding="async"
        draggable={false}
        src="/logo.webp"
      />
    </div>
  );
}
