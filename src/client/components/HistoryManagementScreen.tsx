import { useEffect, useState, useRef } from "react";
import { MaterialIcon } from "./MaterialIcon.tsx";
import { fetchAgentSessions, deleteAgentSession } from "../api.ts";
import type { AgentSessionSummary } from "../../shared/protocol.ts";
import { formatConversationDate } from "./chat/chat-utils.ts";

interface ToastState {
  id: string;
  message: string;
}

export const toastDismissDelayMs = 2400;

function ToastNotification({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  return (
    <div
      aria-live="polite"
      className="truss-toast fixed bottom-6 right-6 z-[170] max-w-sm rounded-sm border border-outline-variant bg-surface px-4 py-3 text-sm font-medium text-on-surface shadow-[0_18px_44px_rgb(27_28_25/0.18)]"
      key={toast.id}
      role="status"
    >
      {toast.message}
    </div>
  );
}

export function HistoryManagementScreen() {
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Time filter state
  const [timeFilter, setTimeFilter] = useState<"all" | "today" | "week" | "month">("all");

  // Selection state
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);

  function showToast(message: string): void {
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    setToast({ id: `toast-${Date.now()}`, message });
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, toastDismissDelayMs);
  }

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  async function loadSessions() {
    setLoading(true);
    try {
      const response = await fetchAgentSessions({
        search: searchValue || undefined,
        includeSubAgents: false,
        limit: 1000,
      });
      setSessions(response.sessions);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load conversations");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void loadSessions();
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [searchValue]);

  // Reset pagination on search, filter, or page size change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchValue, timeFilter, pageSize]);

  // Clear selections when filters or searches change
  useEffect(() => {
    setSelectedSessionIds(new Set());
    setLastClickedId(null);
  }, [searchValue, timeFilter]);

  // Filter sessions by date
  const filteredSessions = sessions.filter((session) => {
    if (timeFilter === "all") return true;
    const date = new Date(session.updatedAt);
    if (Number.isNaN(date.getTime())) return false;
    const now = new Date();
    if (timeFilter === "today") {
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return date >= startOfToday;
    }
    if (timeFilter === "week") {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return date >= sevenDaysAgo;
    }
    if (timeFilter === "month") {
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return date >= thirtyDaysAgo;
    }
    return true;
  });

  // Pagination calculations
  const totalSessions = filteredSessions.length;
  const totalPages = Math.ceil(totalSessions / pageSize) || 1;
  const activePage = Math.min(Math.max(1, currentPage), totalPages);

  const startIndex = (activePage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedSessions = filteredSessions.slice(startIndex, endIndex);

  // Page Numbers Builder for Pagination controls
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (activePage > 3) {
        pages.push("...");
      }
      const start = Math.max(2, activePage - 1);
      const end = Math.min(totalPages - 1, activePage + 1);
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      if (activePage < totalPages - 2) {
        pages.push("...");
      }
      pages.push(totalPages);
    }
    return pages;
  };

  function handleSelectAll() {
    const paginatedIds = paginatedSessions.map((s) => s.id);
    const allSelectedOnPage = paginatedIds.every((id) => selectedSessionIds.has(id));
    const next = new Set(selectedSessionIds);
    if (allSelectedOnPage) {
      paginatedIds.forEach((id) => next.delete(id));
    } else {
      paginatedIds.forEach((id) => next.add(id));
    }
    setSelectedSessionIds(next);
  }

  function handleSelectRow(id: string, isShift: boolean) {
    const next = new Set(selectedSessionIds);
    const isCurrentlySelected = selectedSessionIds.has(id);
    const targetChecked = !isCurrentlySelected;

    if (isShift && lastClickedId) {
      const lastIdx = paginatedSessions.findIndex((s) => s.id === lastClickedId);
      const currIdx = paginatedSessions.findIndex((s) => s.id === id);
      if (lastIdx !== -1 && currIdx !== -1) {
        const start = Math.min(lastIdx, currIdx);
        const end = Math.max(lastIdx, currIdx);
        for (let i = start; i <= end; i++) {
          const session = paginatedSessions[i];
          if (session) {
            if (targetChecked) {
              next.add(session.id);
            } else {
              next.delete(session.id);
            }
          }
        }
        setSelectedSessionIds(next);
        setLastClickedId(id);
        return;
      }
    }

    if (targetChecked) {
      next.add(id);
    } else {
      next.delete(id);
    }
    setSelectedSessionIds(next);
    setLastClickedId(id);
  }

  async function handleDeleteSelected() {
    const ids = Array.from(selectedSessionIds);
    if (ids.length === 0) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete ${ids.length} selected ${
        ids.length === 1 ? "conversation" : "conversations"
      }?`
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await Promise.all(ids.map((id) => deleteAgentSession(id)));
      showToast(`Successfully deleted ${ids.length} conversations.`);
      setSelectedSessionIds(new Set());
      await loadSessions();
    } catch (err: any) {
      showToast(err?.message || "An error occurred while deleting conversations.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleDeleteOne(session: AgentSessionSummary) {
    const title = session.title || "Untitled conversation";
    const confirmed = window.confirm(`Are you sure you want to delete "${title}"?`);
    if (!confirmed) return;

    setDeleting(true);
    try {
      await deleteAgentSession(session.id);
      showToast(`Successfully deleted conversation.`);
      const nextSelected = new Set(selectedSessionIds);
      nextSelected.delete(session.id);
      setSelectedSessionIds(nextSelected);
      await loadSessions();
    } catch (err: any) {
      showToast(err?.message || "An error occurred while deleting the conversation.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="relative h-screen overflow-hidden bg-surface text-on-surface flex flex-col">
      <div className="truss-grid pointer-events-none fixed inset-0 z-0" />
      <div className="relative z-10 mx-auto flex h-full w-full max-w-[1380px] flex-col px-5 py-6 sm:px-8 lg:px-10 overflow-hidden">
        <header className="mb-6 flex flex-none flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <a
              aria-label="Back to chat"
              className="grid h-10 w-10 place-items-center rounded-sm border border-outline-variant bg-surface-container-low text-on-surface-variant transition hover:bg-surface-container hover:text-primary focus:border-outline focus:bg-surface focus:outline-none"
              href="/"
            >
              <MaterialIcon name="arrow_back" size={20} />
            </a>
            <div className="min-w-0 flex-1 lg:grid lg:gap-1">
              <p className="text-xs font-semibold uppercase text-on-surface-variant">Truss</p>
              <h1 className="truncate text-2xl font-semibold text-primary">History Management</h1>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {/* Time Filter Select */}
            <div className="relative flex items-center gap-2 rounded-sm border border-outline-variant/70 bg-surface-container px-3 py-1.5 text-on-surface-variant focus-within:border-outline focus-within:bg-surface">
              <MaterialIcon name="today" size={18} />
              <select
                aria-label="Filter by time"
                className="border-0 bg-transparent text-sm text-on-surface outline-none focus:ring-0 cursor-pointer pr-8"
                onChange={(e) => setTimeFilter(e.target.value as any)}
                value={timeFilter}
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="week">Last 7 Days</option>
                <option value="month">Last 30 Days</option>
              </select>
            </div>

            {/* Search Input */}
            <div className="relative flex max-w-sm items-center gap-2 rounded-sm border border-outline-variant/70 bg-surface-container px-3 py-1.5 text-on-surface-variant focus-within:border-outline focus-within:bg-surface">
              <MaterialIcon name="search" size={18} />
              <input
                aria-label="Search conversations"
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant/50 focus:ring-0"
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder="Search conversations..."
                type="search"
                value={searchValue}
              />
            </div>
          </div>
        </header>

        {selectedSessionIds.size > 0 && (
          <div className="mb-4 flex flex-none items-center justify-between rounded-sm border border-outline-variant bg-surface-container px-4 py-3 shadow-sm animate-truss-toast-in">
            <span className="text-sm font-medium text-on-surface">
              {selectedSessionIds.size} {selectedSessionIds.size === 1 ? "conversation" : "conversations"} selected
            </span>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-sm bg-error px-4 text-sm font-semibold text-on-error hover:bg-error/90 transition disabled:opacity-45"
              disabled={deleting}
              onClick={handleDeleteSelected}
              type="button"
            >
              <MaterialIcon name="delete" size={18} />
              Bulk Delete
            </button>
          </div>
        )}

        <div className="flex-1 overflow-auto rounded-sm border border-outline-variant bg-surface-container-low min-h-0">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container-high/40 text-xs font-semibold uppercase text-on-surface-variant">
                <th className="p-4 w-12 text-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded-sm border-outline-variant text-primary focus:ring-primary cursor-pointer"
                    checked={paginatedSessions.length > 0 && paginatedSessions.every((s) => selectedSessionIds.has(s.id))}
                    onChange={handleSelectAll}
                  />
                </th>
                <th className="p-4 min-w-[200px]">Conversation</th>
                <th className="p-4 hidden md:table-cell">Model</th>
                <th className="p-4 text-center">Messages</th>
                <th className="p-4 text-center hidden sm:table-cell">Words</th>
                <th className="p-4 text-right">Last Updated</th>
                <th className="p-4 text-right w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && sessions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-on-surface-variant">
                    Loading conversations...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-error font-medium">
                    {error}
                  </td>
                </tr>
              ) : paginatedSessions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-on-surface-variant">
                    No conversations found.
                  </td>
                </tr>
              ) : (
                paginatedSessions.map((session) => {
                  const isSelected = selectedSessionIds.has(session.id);
                  return (
                    <tr
                      key={session.id}
                      className={`border-b border-outline-variant/50 transition ${
                        isSelected ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-surface-container/35"
                      }`}
                    >
                      <td className="p-4 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded-sm border-outline-variant text-primary focus:ring-primary cursor-pointer"
                          checked={isSelected}
                          onClick={(e) => handleSelectRow(session.id, e.shiftKey)}
                          onChange={() => {}}
                        />
                      </td>
                      <td className="p-4 font-medium text-on-surface">
                        <a
                          href={`/chat/${encodeURIComponent(session.id)}?context=${
                            session.workspacePath
                              ? "workspace&workspace=" + encodeURIComponent(session.workspacePath)
                              : "global"
                          }`}
                          className="text-primary hover:underline font-semibold block max-w-md truncate"
                        >
                          {session.title || "Untitled conversation"}
                        </a>
                        {session.workspaceDisplayName ? (
                          <span className="inline-flex mt-1 items-center gap-1 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            <MaterialIcon name="folder" size={12} />
                            {session.workspaceDisplayName}
                          </span>
                        ) : null}
                      </td>
                      <td className="p-4 text-on-surface-variant hidden md:table-cell truncate max-w-xs">
                        {session.modelId}
                      </td>
                      <td className="p-4 text-center text-on-surface-variant">{session.messageCount}</td>
                      <td className="p-4 text-center text-on-surface-variant hidden sm:table-cell">
                        {session.wordCount}
                      </td>
                      <td className="p-4 text-right text-on-surface-variant whitespace-nowrap">
                        {formatConversationDate(session.updatedAt)}
                      </td>
                      <td className="p-4 text-right">
                        <button
                          className="p-1.5 text-on-surface-variant hover:text-error transition rounded-sm hover:bg-error/10"
                          disabled={deleting}
                          onClick={() => void handleDeleteOne(session)}
                          title="Delete conversation"
                          type="button"
                        >
                          <MaterialIcon name="delete" size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <footer className="mt-4 flex flex-none flex-col items-center justify-between gap-4 border border-outline-variant bg-surface-container-low px-4 py-3 sm:flex-row rounded-sm">
            <div className="flex flex-wrap items-center gap-4 text-sm text-on-surface-variant">
              <div className="flex items-center gap-1.5">
                <span>Rows per page:</span>
                <select
                  className="h-8 rounded-sm border border-outline-variant bg-surface-container-low px-2 py-0.5 text-sm text-on-surface focus:border-outline focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  value={pageSize}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
              <span>
                Showing <span className="font-semibold text-on-surface">{startIndex + 1}</span> to{" "}
                <span className="font-semibold text-on-surface">
                  {Math.min(endIndex, totalSessions)}
                </span>{" "}
                of <span className="font-semibold text-on-surface">{totalSessions}</span> conversations
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-outline-variant bg-surface-container-low text-on-surface transition hover:bg-surface-container hover:text-primary disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-on-surface"
                disabled={activePage === 1}
                onClick={() => setCurrentPage(activePage - 1)}
                title="Previous page"
                type="button"
              >
                <MaterialIcon name="chevron_left" size={20} />
              </button>

              <div className="flex items-center gap-1">
                {getPageNumbers().map((pageNum, idx) => {
                  if (typeof pageNum === "string") {
                    return (
                      <span key={`dots-${idx}`} className="px-2 text-on-surface-variant text-sm font-medium">
                        {pageNum}
                      </span>
                    );
                  }
                  const isCurrent = pageNum === activePage;
                  return (
                    <button
                      key={pageNum}
                      className={`inline-flex h-8 min-w-[32px] items-center justify-center rounded-sm px-2 text-sm font-semibold transition focus:outline-none ${
                        isCurrent
                          ? "bg-primary text-on-primary"
                          : "border border-outline-variant bg-surface-container-low text-on-surface hover:bg-surface-container hover:text-primary"
                      }`}
                      onClick={() => setCurrentPage(pageNum)}
                      type="button"
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              <button
                className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-outline-variant bg-surface-container-low text-on-surface transition hover:bg-surface-container hover:text-primary disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-on-surface"
                disabled={activePage === totalPages}
                onClick={() => setCurrentPage(activePage + 1)}
                title="Next page"
                type="button"
              >
                <MaterialIcon name="chevron_right" size={20} />
              </button>
            </div>
          </footer>
        )}
      </div>
      <ToastNotification toast={toast} />
    </main>
  );
}

