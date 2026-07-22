import { useEffect, useRef, useState } from "react";
import {
  autoRenameAgentSession,
  cancelOrchestrationTimer,
  deleteWorkspaceSessions,
  deleteAgentSession,
  deleteAgentSessionMessage,
  duplicateAgentSession,
  extendOrchestrationTimer,
  fetchAgentSession,
  fetchAgentSessions,
  fetchFileAccessSettings,
  fetchScheduledTaskSessions,
  fetchOrchestrationTimers,
  fetchRichFeatureSettings,
  fetchWorkspaces,
  fireOrchestrationTimer,
  killCommandExecution,
  killCommandTerminal,
  launchWorkspaceConversation,
  listCommandTerminals,
  pickWorkspaceDirectory,
  renameAgentSession,
  reloadMcpServers,
  resolveChatUserChoice,
  streamChatMessage,
  updateFileAccessSettings,
  updateAgentSessionMessage,
} from "../api.ts";
import {
  notifySessionFinished,
  notifyUserChoiceRequest,
  requestBrowserNotificationPermission,
} from "../browser-notifications.ts";
import type {
  AgentSessionSummary,
  AgentSessionTitleEvent,
  AgentDeltaEvent,
  AgentDoneEvent,
  AgentMessageEvent,
  ChatAttachment,
  ChatCommandExecutionReference,
  ChatSubAgentReference,
  ChatCommandTerminalReference,
  ChatStreamEvent,
  ChatThinking,
  ChatToolCall,
  ChatUserChoiceRequest,
  ChatUserChoiceResolutionRequest,
  CommandTerminalSummary,
  CommandTerminalUpdatedEvent,
  ConversationScopeSummary,
  FileAccessDirectorySummary,
  FileAccessDirectoryUpdate,
  McpCapabilitiesEvent,
  RichFeatureSettingsSummary,
  ScheduledTaskSessionSummary,
  SessionInfo,
  StoredChatMessage,
  SubAgentSpawnedEvent,
  SubAgentStatusEvent,
  SystemReadyEvent,
  WorkspaceSummary,
} from "../../shared/protocol.ts";
import { defaultChatToolSettings } from "../../shared/protocol.ts";
import {
  appendThinkingTextBlock,
  mergeChatToolCall,
  mergeChatToolCalls,
} from "../../shared/chat-thinking.ts";
import { extractMarkdownFollowUps } from "../markdown.tsx";
import { defaultRichFeatureSettings } from "../rich-features.ts";
import type { SelectedModel } from "./ModelSelector.tsx";
import { MaterialIcon } from "./MaterialIcon.tsx";
import { Modal } from "./Modal.tsx";
import {
  ActivityStatusPane,
  type ActiveTimerStatus,
} from "./chat/ActivityStatusPane.tsx";
import { ChatPromptCard } from "./chat/ChatPromptCard.tsx";
import { ChatTranscript } from "./chat/ChatTranscript.tsx";
import { ConversationHeader } from "./chat/ConversationHeader.tsx";
import {
  ConversationScopeIndicator,
  DeleteConversationDialog,
  DeleteWorkspaceDialog,
  DesktopSidebar,
  ManualRenameDialog,
} from "./chat/ConversationSidebar.tsx";
import { MobileNavigation } from "./chat/MobileNavigation.tsx";
import { SubAgentPanel, type SubAgentPanelSession } from "./chat/SubAgentPanel.tsx";
import { TerminalPanel } from "./chat/TerminalPanel.tsx";
import {
  activeTimerFromToolCall,
  removedTimerIdFromToolCall,
  upsertActiveTimer,
} from "./chat/timer-tool-state.ts";
import { sharedFilesForActivity } from "./chat/activity-shared-files.ts";
import {
  planFromMessages,
  planFromToolCall,
  type ActivityPlanStatus,
} from "./chat/plan-tool-state.ts";
import { WorkspaceOriginBanner } from "./chat/WorkspaceOriginBanner.tsx";
import {
  assistantFailureContent,
  copyTextToClipboard,
  createClientMessageId,
  downloadBinaryFile,
  downloadTextFile,
  errorMessage,
  formatConversationAtif,
  formatConversationHtml,
  formatConversationJson,
  formatConversationMarkdown,
  safeFileBaseName,
  storedMessageToUiMessage,
  toChatRequestMessages,
  upsertConversation,
} from "./chat/chat-utils.ts";
import { useModelSelectorState } from "./chat/useModelSelectorState.ts";
import type {
  ChatUiMessage,
  ComposerMode,
  ConversationExportFormat,
} from "./chat/types.ts";

const assistantResponseDelayMs = 500;
const sidebarSessionLimit = 50;
const scheduledTaskSessionLimit = 10;
const sidebarSearchDebounceMs = 250;
const toastDismissDelayMs = 2400;
const dismissedWorkspaceOriginBannerKey = "truss.workspace-origin-banner.dismissed.v1";

interface ToastState {
  id: string;
  message: string;
}

interface EditedMessageRegenerationPrompt {
  messageIndex: number;
  role: "assistant" | "user";
}

type ConversationActionTarget = Pick<AgentSessionSummary, "id" | "title">;

interface ChatRouteState {
  context: "global" | "workspace" | null;
  messageId: string | null;
  sessionId: string | null;
  workspacePath: string | null;
}

export function ChatLandingScreen() {
  const [conversationMode, setConversationMode] = useState<ComposerMode>("conversation");
  const modelSelector = useModelSelectorState(conversationMode);
  const initialChatRouteRef = useRef<ChatRouteState>(parseChatRoute(window.location));
  const initialChatRouteHandledRef = useRef(false);
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(
    Boolean(initialChatRouteRef.current.sessionId),
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStartedMode, setSessionStartedMode] = useState<ComposerMode | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<AgentSessionSummary | null>(null);
  const [messageAnchorId, setMessageAnchorId] = useState<string | null>(
    initialChatRouteRef.current.messageId,
  );
  const [conversationSearch, setConversationSearch] = useState("");
  const [sidebarSearchFocused, setSidebarSearchFocused] = useState(false);
  const [conversations, setConversations] = useState<AgentSessionSummary[]>([]);
  const [scheduledTaskSessions, setScheduledTaskSessions] = useState<ScheduledTaskSessionSummary[]>([]);
  const [scheduledTaskSessionsError, setScheduledTaskSessionsError] = useState<string | null>(null);
  const [loadingScheduledTaskSessions, setLoadingScheduledTaskSessions] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [richFeatures, setRichFeatures] = useState<RichFeatureSettingsSummary>(
    defaultRichFeatureSettings,
  );
  const [toolSettings, setToolSettings] = useState(defaultChatToolSettings);
  const [deleteConversationSession, setDeleteConversationSession] =
    useState<ConversationActionTarget | null>(null);
  const [deleteWorkspaceTarget, setDeleteWorkspaceTarget] = useState<WorkspaceSummary | null>(null);
  const [editedMessageRegeneration, setEditedMessageRegeneration] =
    useState<EditedMessageRegenerationPrompt | null>(null);
  const [manualRenameSession, setManualRenameSession] = useState<AgentSessionSummary | null>(null);
  const [userChoiceQueue, setUserChoiceQueue] = useState<ChatUserChoiceRequest[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [dismissedWorkspaceOriginBanners, setDismissedWorkspaceOriginBanners] = useState<
    ReadonlySet<string>
  >(() => readDismissedWorkspaceOriginBanners());
  const [launchingWorkspaceSessionId, setLaunchingWorkspaceSessionId] = useState<string | null>(
    null,
  );
  const [workspaceNavigationPending, setWorkspaceNavigationPending] = useState(false);
  const [pendingTitleBySession, setPendingTitleBySession] = useState<Record<string, string | null>>(
    {},
  );
  const [activeTimers, setActiveTimers] = useState<ActiveTimerStatus[]>([]);
  const [activePlan, setActivePlan] = useState<ActivityPlanStatus | null>(null);
  const [subAgents, setSubAgents] = useState<Record<string, SubAgentPanelSession>>({});
  const [openSubAgentId, setOpenSubAgentId] = useState<string | null>(null);
  const [commandTerminals, setCommandTerminals] = useState<Record<string, CommandTerminalSummary>>(
    {},
  );
  const [openTerminalId, setOpenTerminalId] = useState<string | null>(null);
  const [killingTerminalId, setKillingTerminalId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const conversationScopeRef = useRef<ConversationScopeSummary | null>(null);
  const showWorkspaceSessionsInGlobalViewRef = useRef(false);
  const conversationSearchRef = useRef("");
  const conversationListRequestIdRef = useRef(0);
  const workspaceListRequestIdRef = useRef(0);
  const toastTimeoutRef = useRef<number | null>(null);
  const workspaceOriginImpressionRef = useRef<Set<string>>(new Set());
  const activeChatAbortControllerRef = useRef<AbortController | null>(null);
  const notifiedFinishedMessageIdsRef = useRef<Set<string>>(new Set());
  const notifiedUserChoiceRequestIdsRef = useRef<Set<string>>(new Set());
  const conversationModeWasUserSelectedRef = useRef(false);
  const messagesRef = useRef<ChatUiMessage[]>(messages);

  async function refreshConversations(search = conversationSearchRef.current): Promise<void> {
    const scope = conversationScopeRef.current;

    if (!scope) {
      return;
    }

    const requestId = conversationListRequestIdRef.current + 1;

    conversationListRequestIdRef.current = requestId;
    setLoadingConversations(true);

    try {
      const [response] = await Promise.all([
        fetchAgentSessions({
          excludeScheduledTaskSessions: true,
          includeSubAgents: false,
          includeWorkspaceSessions:
            scope.mode === "all" ? showWorkspaceSessionsInGlobalViewRef.current : true,
          limit: sidebarSessionLimit,
          search,
        }),
        refreshScheduledTaskSessions(),
      ]);

      if (requestId !== conversationListRequestIdRef.current) {
        return;
      }

      setConversations(response.sessions);
      setConversationError(null);
    } catch (caught) {
      if (requestId !== conversationListRequestIdRef.current) {
        return;
      }

      setConversationError(errorMessage(caught));
    } finally {
      if (requestId === conversationListRequestIdRef.current) {
        setLoadingConversations(false);
      }
    }
  }

  async function refreshScheduledTaskSessions(): Promise<void> {
    setLoadingScheduledTaskSessions(true);

    try {
      const response = await fetchScheduledTaskSessions(scheduledTaskSessionLimit);
      setScheduledTaskSessions(response.sessions);
      setScheduledTaskSessionsError(null);
    } catch (caught) {
      setScheduledTaskSessionsError(errorMessage(caught));
    } finally {
      setLoadingScheduledTaskSessions(false);
    }
  }

  async function refreshWorkspaces(): Promise<void> {
    if (conversationScopeRef.current?.mode !== "all") {
      setWorkspaces([]);
      setWorkspaceError(null);
      setLoadingWorkspaces(false);
      return;
    }

    const requestId = workspaceListRequestIdRef.current + 1;

    workspaceListRequestIdRef.current = requestId;
    setLoadingWorkspaces(true);

    try {
      const response = await fetchWorkspaces();

      if (requestId !== workspaceListRequestIdRef.current) {
        return;
      }

      setWorkspaces(response.workspaces);
      setWorkspaceError(null);
    } catch (caught) {
      if (requestId !== workspaceListRequestIdRef.current) {
        return;
      }

      setWorkspaceError(errorMessage(caught));
    } finally {
      if (requestId === workspaceListRequestIdRef.current) {
        setLoadingWorkspaces(false);
      }
    }
  }

  useEffect(() => {
    if (sessionId || messages.length > 0 || conversationModeWasUserSelectedRef.current) {
      return;
    }

    const defaultMode = defaultComposerModeForScope(
      modelSelector.session?.conversationScope ?? null,
    );
    const defaultSelection = defaultModelSelectionForComposerMode(
      modelSelector.session,
      defaultMode,
    );

    setConversationMode(defaultMode);

    if (defaultSelection) {
      modelSelector.setSelectionForMode(defaultMode, defaultSelection);
    }
  }, [messages.length, modelSelector.session, sessionId]);

  useEffect(() => {
    const scope = modelSelector.session?.conversationScope;

    conversationScopeRef.current = scope ?? null;
    showWorkspaceSessionsInGlobalViewRef.current =
      modelSelector.session?.setup.showWorkspaceSessionsInGlobalView === true;

    if (!scope) {
      return;
    }

    void refreshConversations(conversationSearchRef.current);

    if (scope.mode !== "all") {
      setWorkspaces([]);
      setWorkspaceError(null);
      setLoadingWorkspaces(false);
      return;
    }

    void refreshWorkspaces();
  }, [
    modelSelector.session?.conversationScope.mode,
    modelSelector.session?.conversationScope.workspacePath,
    modelSelector.session?.setup.showWorkspaceSessionsInGlobalView,
  ]);

  useEffect(() => {
    sessionIdRef.current = sessionId;

    if (sessionId && Object.prototype.hasOwnProperty.call(pendingTitleBySession, sessionId)) {
      setConversationTitle(pendingTitleBySession[sessionId] ?? null);
    }
  }, [pendingTitleBySession, sessionId]);

  useEffect(() => {
    messagesRef.current = messages;
  });

  useEffect(() => {
    setCommandTerminals({});
    setOpenTerminalId(null);

    if (!sessionId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await listCommandTerminals(sessionId);

        if (cancelled || sessionIdRef.current !== sessionId) {
          return;
        }

        const liveIds = new Set(response.terminals.map((t) => t.terminalId));

        setCommandTerminals((current) => {
          const next = { ...current };

          for (const terminal of response.terminals) {
            next[terminal.terminalId] = mergeCommandTerminalSummary(
              next[terminal.terminalId],
              terminal,
            );
          }

          // Any terminal referenced in messages as "running" but absent from the
          // server response has expired (e.g. server restarted). Mark it timed_out
          // so the badge and kill button reflect the actual state.
          for (const message of messagesRef.current) {
            for (const toolCall of message.thinking?.toolCalls ?? []) {
              const ref = toolCall.terminal;

              if (ref && ref.status === "running" && !liveIds.has(ref.terminalId)) {
                const stale = commandTerminalSummaryFromReference(ref);
                const expired: CommandTerminalSummary = {
                  ...stale,
                  status: "timed_out",
                  updatedAt: new Date().toISOString(),
                };

                next[ref.terminalId] = mergeCommandTerminalSummary(
                  next[ref.terminalId],
                  expired,
                );
              }
            }
          }

          return next;
        });
      } catch {
        // Best effort reconciliation; SSE updates remain the primary source of truth.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setActiveTimers([]);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetchOrchestrationTimers(sessionId);

        if (cancelled) {
          return;
        }

        setActiveTimers(
          response.timers.map((timer) => ({
            ...timer,
            sessionId,
          })),
        );
      } catch {
        if (!cancelled) {
          setActiveTimers([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    setActivePlan(planFromMessages(messages));
  }, [messages]);

  useEffect(() => {
    if (initialChatRouteHandledRef.current) {
      return;
    }

    initialChatRouteHandledRef.current = true;

    const route = initialChatRouteRef.current;

    if (route.sessionId) {
      void openConversation(route.sessionId, {
        messageId: route.messageId,
        updateUrl: false,
      });
    }
  }, []);

  useEffect(() => {
    if (
      !currentSession ||
      workspaceOriginImpressionRef.current.has(currentSession.id) ||
      !shouldShowWorkspaceOriginBanner({
        currentScope: modelSelector.session?.conversationScope ?? null,
        dismissedSessionIds: dismissedWorkspaceOriginBanners,
        session: currentSession,
      })
    ) {
      return;
    }

    workspaceOriginImpressionRef.current.add(currentSession.id);
    trackWorkspaceOriginBannerEvent("impression", currentSession);
  }, [currentSession, dismissedWorkspaceOriginBanners, modelSelector.session?.conversationScope]);

  useEffect(() => {
    conversationSearchRef.current = conversationSearch;

    const searchDelay = conversationSearch.trim() ? sidebarSearchDebounceMs : 0;
    const timeoutId = window.setTimeout(() => {
      void refreshConversations(conversationSearch);
    }, searchDelay);

    return () => window.clearTimeout(timeoutId);
  }, [conversationSearch]);

  useEffect(() => {
    const source = new EventSource("/api/events");

    const handleTitleEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as AgentSessionTitleEvent;

      setPendingTitleBySession((current) => ({
        ...current,
        [event.sessionId]: event.title,
      }));

      if (sessionIdRef.current === event.sessionId) {
        setConversationTitle(event.title);
      }

      setConversations((current) =>
        current.map((session) =>
          session.id === event.sessionId ? { ...session, title: event.title } : session,
        ),
      );
    };

    const handleMcpEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as McpCapabilitiesEvent;

      modelSelector.updateMcpSummary(event.mcp);
    };

    const handleReadyEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as SystemReadyEvent;

      modelSelector.updateMcpSummary(event.session.mcp);
    };

    const handleAgentMessageEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as AgentMessageEvent;

      if (event.sessionId && sessionIdRef.current !== event.sessionId) {
        return;
      }

      setMessages((current) => upsertAgentEventMessage(current, event));
      if (event.generated?.kind === "timer" && event.generated.timerId) {
        const firedTimerId = event.generated.timerId;

        setActiveTimers((current) =>
          current.filter((timer) => timer.timerId !== firedTimerId),
        );
      }
      void refreshConversations();
    };

    const handleAgentDeltaEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as AgentDeltaEvent;

      if (event.sessionId && sessionIdRef.current !== event.sessionId) {
        return;
      }

      setMessages((current) => appendAgentEventDelta(current, event));
    };

    const handleAgentDoneEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as AgentDoneEvent;

      if (event.sessionId && sessionIdRef.current !== event.sessionId) {
        return;
      }

      setMessages((current) => completeAgentEventMessage(current, event));
      void refreshConversations();
      void refreshWorkspaces();
    };

    const handleSubAgentSpawnedEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as SubAgentSpawnedEvent;

      if (sessionIdRef.current !== event.parentSessionId) {
        return;
      }

      setSubAgents((current) => updateSubAgentSpawned(current, event));
    };

    const handleSubAgentStatusEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as SubAgentStatusEvent;

      setSubAgents((current) => updateSubAgentStatus(current, event));
      setMessages((current) => applySubAgentStatusToMessages(current, event));
    };

    const handleCommandTerminalUpdatedEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as CommandTerminalUpdatedEvent;

      if (sessionIdRef.current !== event.sessionId) {
        return;
      }

      setCommandTerminals((current) => ({
        ...current,
        [event.terminal.terminalId]: event.terminal,
      }));
    };

    source.addEventListener("command_terminal.updated", handleCommandTerminalUpdatedEvent);
    source.addEventListener("agent.message", handleAgentMessageEvent);
    source.addEventListener("agent.delta", handleAgentDeltaEvent);
    source.addEventListener("agent.done", handleAgentDoneEvent);
    source.addEventListener("agent.session.title", handleTitleEvent);
    source.addEventListener("mcp.capabilities", handleMcpEvent);
    source.addEventListener("sub_agent.spawned", handleSubAgentSpawnedEvent);
    source.addEventListener("sub_agent.status", handleSubAgentStatusEvent);
    source.addEventListener("system.ready", handleReadyEvent);

    return () => {
      source.removeEventListener("command_terminal.updated", handleCommandTerminalUpdatedEvent);
      source.removeEventListener("agent.message", handleAgentMessageEvent);
      source.removeEventListener("agent.delta", handleAgentDeltaEvent);
      source.removeEventListener("agent.done", handleAgentDoneEvent);
      source.removeEventListener("agent.session.title", handleTitleEvent);
      source.removeEventListener("mcp.capabilities", handleMcpEvent);
      source.removeEventListener("sub_agent.spawned", handleSubAgentSpawnedEvent);
      source.removeEventListener("sub_agent.status", handleSubAgentStatusEvent);
      source.removeEventListener("system.ready", handleReadyEvent);
      source.close();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetchRichFeatureSettings();

        if (!cancelled) {
          setRichFeatures(response.richFeatures);
        }
      } catch {
        if (!cancelled) {
          setRichFeatures(defaultRichFeatureSettings);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    },
    [],
  );

  function showToast(message: string): void {
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
    }

    setToast({ id: createClientMessageId("toast"), message });
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, toastDismissDelayMs);
  }

  function notifySessionFinishedOnce(sessionId: string, messageId: string): void {
    if (notifiedFinishedMessageIdsRef.current.has(messageId)) {
      return;
    }

    notifiedFinishedMessageIdsRef.current.add(messageId);
    notifySessionFinished(sessionId);
  }

  function notifyUserChoiceRequestOnce(request: ChatUserChoiceRequest): void {
    if (notifiedUserChoiceRequestIdsRef.current.has(request.id)) {
      return;
    }

    notifiedUserChoiceRequestIdsRef.current.add(request.id);
    notifyUserChoiceRequest(request);
  }

  function startNewConversation(): void {
    if (isSending) {
      return;
    }

    setMobileSidebarOpen(false);
    resetConversationModeToScopeDefault();
    setSessionStartedMode(null);
    setConversationTitle(null);
    setCurrentSession(null);
    setMessages([]);
    setMessageAnchorId(null);
    setSessionId(null);
    setActiveTimers([]);
    setSubAgents({});
    setOpenSubAgentId(null);
    writeChatHomeRoute();
  }

  async function openConversation(
    nextSessionId: string,
    options: { messageId?: string | null; updateUrl?: boolean } = {},
  ): Promise<boolean> {
    if (isSending) {
      return false;
    }

    try {
      const detail = await fetchAgentSession(nextSessionId);
      const nextMode = detail.session.type === "agentic" ? "agent" : "conversation";

      conversationModeWasUserSelectedRef.current = false;
      setConversationMode(nextMode);
      setSessionStartedMode(nextMode);
      modelSelector.setSelectionForMode(nextMode, {
        modelId: detail.session.modelId,
        providerId: detail.session.providerId,
      });
      setConversationTitle(detail.session.title);
      setMessages(
        detail.messages.map((message) =>
          storedMessageToUiMessage(message, detail.session.modelId),
        ),
      );
      setSessionId(detail.session.id);
      setCurrentSession(detail.session);
      setMessageAnchorId(options.messageId ?? null);
      setActiveTimers([]);
      setSubAgents({});
      setOpenSubAgentId(null);
      setConversationError(null);

      if (options.updateUrl !== false) {
        writeChatRoute({
          messageId: options.messageId ?? null,
          scope: modelSelector.session?.conversationScope ?? null,
          sessionId: detail.session.id,
        });
      }

      return true;
    } catch (caught) {
      setConversationError(errorMessage(caught));
      return false;
    }
  }

  async function openConversationFromSidebar(nextSessionId: string): Promise<void> {
    const opened = await openConversation(nextSessionId);

    if (opened) {
      setMobileSidebarOpen(false);
    }
  }

  function openSettings(): void {
    window.location.href = "/settings";
  }

  function changeConversationMode(mode: ComposerMode): void {
    conversationModeWasUserSelectedRef.current = true;
    setConversationMode(mode);
  }

  function resetConversationModeToScopeDefault(): void {
    const defaultMode = defaultComposerModeForScope(
      modelSelector.session?.conversationScope ?? null,
    );
    const defaultSelection = defaultModelSelectionForComposerMode(
      modelSelector.session,
      defaultMode,
    );

    conversationModeWasUserSelectedRef.current = false;
    setConversationMode(defaultMode);

    if (defaultSelection) {
      modelSelector.setSelectionForMode(defaultMode, defaultSelection);
    }
  }

  function applyConversationSummary(session: AgentSessionSummary): void {
    setConversations((current) => upsertConversation(current, session));
    setPendingTitleBySession((current) => ({
      ...current,
      [session.id]: session.title,
    }));

    if (sessionIdRef.current === session.id) {
      setConversationTitle(session.title);
      setCurrentSession((current) => (current ? { ...current, ...session } : session));
    }
  }

  async function duplicateConversation(target: ConversationActionTarget): Promise<void> {
    if (isSending) {
      return;
    }

    try {
      const created = await duplicateAgentSession(target.id);

      applyConversationSummary(created);
      await openConversation(created.id);
      void refreshConversations();
    } catch (caught) {
      setConversationError(errorMessage(caught));
    }
  }

  async function copyConversationToClipboard(target: ConversationActionTarget): Promise<void> {
    try {
      const detail = await fetchAgentSession(target.id);

      await copyTextToClipboard(formatConversationMarkdown(detail));
      showToast("Conversation copied to clipboard.");
      setConversationError(null);
    } catch (caught) {
      setConversationError(errorMessage(caught));
    }
  }

  async function exportConversation(
    target: ConversationActionTarget,
    format: ConversationExportFormat,
  ): Promise<void> {
    try {
      const detail = await fetchAgentSession(target.id);
      const title = detail.session.title ?? "Untitled conversation";

      const fileBaseName = safeFileBaseName(title);

      switch (format) {
        case "markdown":
          downloadTextFile(
            `${fileBaseName}.md`,
            "text/markdown;charset=utf-8",
            formatConversationMarkdown(detail),
          );
          break;
        case "json":
          downloadTextFile(
            `${fileBaseName}.json`,
            "application/json;charset=utf-8",
            formatConversationJson(detail),
          );
          break;
        case "atif":
          downloadTextFile(
            `${fileBaseName}.atif.json`,
            "application/json;charset=utf-8",
            formatConversationAtif(detail),
          );
          break;
        case "html":
          downloadTextFile(
            `${fileBaseName}.html`,
            "text/html;charset=utf-8",
            formatConversationHtml(detail),
          );
          break;
        case "docx": {
          const response = await fetch(`/api/agent-sessions/${target.id}/export-docx`);
          if (!response.ok) {
            throw new Error(`Export failed: ${response.statusText}`);
          }
          const data = await response.arrayBuffer();
          downloadBinaryFile(
            `${fileBaseName}.docx`,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            data,
          );
          break;
        }
      }

      setConversationError(null);
    } catch (caught) {
      setConversationError(errorMessage(caught));
    }
  }

  async function autoRenameConversation(target: AgentSessionSummary): Promise<void> {
    if (isSending) {
      return;
    }

    try {
      const updated = await autoRenameAgentSession(target.id);

      applyConversationSummary(updated);
      showToast("Conversation renamed.");
      setConversationError(null);
      void refreshConversations();
    } catch (caught) {
      setConversationError(errorMessage(caught));
    }
  }

  async function manuallyRenameConversation(
    target: AgentSessionSummary,
    title: string,
  ): Promise<void> {
    if (isSending) {
      return;
    }

    const updated = await renameAgentSession(target.id, { title });

    applyConversationSummary(updated);
    setConversationError(null);
    void refreshConversations();
  }

  async function updateCurrentConversationTitle(title: string): Promise<void> {
    const currentSessionId = sessionIdRef.current;

    if (!currentSessionId || isSending) {
      return;
    }

    try {
      const updated = title
        ? await renameAgentSession(currentSessionId, { title })
        : await autoRenameAgentSession(currentSessionId);

      applyConversationSummary(updated);
      showToast(title ? "Conversation renamed." : "Conversation title generated.");
      setConversationError(null);
      void refreshConversations();
    } catch (caught) {
      setConversationError(errorMessage(caught));
      throw caught;
    }
  }

  function requestDeleteConversation(target: ConversationActionTarget): void {
    if (isSending) {
      return;
    }

    setDeleteConversationSession(target);
  }

  async function deleteConversation(target: ConversationActionTarget): Promise<void> {
    if (isSending) {
      return;
    }

    try {
      await deleteAgentSession(target.id);
      setConversations((current) =>
        current.filter((conversation) => conversation.id !== target.id),
      );
      setPendingTitleBySession((current) => {
        const next = { ...current };

        delete next[target.id];
        return next;
      });

      if (sessionIdRef.current === target.id) {
        startNewConversation();
      }

      setConversationError(null);
      showToast("Conversation deleted.");
      void refreshConversations();
      void refreshWorkspaces();
    } catch (caught) {
      setConversationError(errorMessage(caught));
      throw caught;
    }
  }

  async function sendMessage(content: string, attachments: ChatAttachment[]): Promise<void> {
    const trimmed = content.trim();

    if ((!trimmed && attachments.length === 0) || isSending) {
      return;
    }

    const selectedModel = modelSelector.selected;

    if (!selectedModel) {
      appendModelSelectionError();
      return;
    }

    requestBrowserNotificationPermission();

    const userMessage: ChatUiMessage = {
      attachments: attachments.length > 0 ? attachments : undefined,
      content: trimmed,
      createdAt: new Date().toISOString(),
      id: createClientMessageId("user"),
      persisted: false,
      role: "user",
    };
    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    await streamAssistantResponse({ baseMessages: nextMessages, selectedModel });
  }

  function stopActiveRequest(): void {
    activeChatAbortControllerRef.current?.abort();
  }

  function appendModelSelectionError(): void {
    const createdAt = new Date().toISOString();

    setMessages((current) => [
      ...current,
      {
        completedAt: createdAt,
        content: "Choose a configured model before sending a message.",
        createdAt,
        id: createClientMessageId("assistant"),
        modelId: "Assistant",
        persisted: false,
        role: "assistant",
        status: "error",
      },
    ]);
  }

  async function streamAssistantResponse({
    baseMessages,
    selectedModel,
    targetMode = conversationMode,
    targetSessionId = sessionId,
  }: {
    baseMessages: ChatUiMessage[];
    selectedModel: SelectedModel;
    targetMode?: ComposerMode;
    targetSessionId?: string | null;
  }): Promise<void> {
    const requestMessages = toChatRequestMessages(baseMessages);
    const abortController = new AbortController();
    let assistantVisible = false;
    let assistantRevealTimer: number | null = null;
    let streamSessionId = targetSessionId;
    const createAssistantDraft = (): ChatUiMessage => ({
      content: "",
      createdAt: new Date().toISOString(),
      id: createClientMessageId("assistant"),
      modelId: selectedModel.modelId,
      persisted: false,
      role: "assistant",
      status: "thinking",
    });
    let assistantMessage = createAssistantDraft();

    function clearAssistantRevealTimer(): void {
      if (assistantRevealTimer === null) {
        return;
      }

      window.clearTimeout(assistantRevealTimer);
      assistantRevealTimer = null;
    }

    function scheduleAssistantReveal(): void {
      clearAssistantRevealTimer();
      assistantRevealTimer = window.setTimeout(() => {
        assistantRevealTimer = null;
        revealAssistantMessage();
      }, assistantResponseDelayMs);
    }

    function revealAssistantMessage(): void {
      clearAssistantRevealTimer();

      if (assistantVisible) {
        return;
      }

      const messageSnapshot = assistantMessage;
      assistantVisible = true;
      setMessages((current) =>
        current.some((message) => message.id === messageSnapshot.id)
          ? current
          : [...current, messageSnapshot],
      );
    }

    function updateAssistantMessage(update: (message: ChatUiMessage) => ChatUiMessage): void {
      const previousId = assistantMessage.id;

      assistantMessage = update(assistantMessage);
      const messageSnapshot = assistantMessage;

      if (!assistantVisible) {
        return;
      }

      setMessages((current) =>
        current.map((message) => (message.id === previousId ? messageSnapshot : message)),
      );
    }

    function startNextAssistantDraft(): void {
      clearAssistantRevealTimer();
      assistantVisible = false;
      assistantMessage = createAssistantDraft();
      scheduleAssistantReveal();
    }

    scheduleAssistantReveal();

    setIsSending(true);
    activeChatAbortControllerRef.current = abortController;

    try {
      await streamChatMessage(
        {
          messages: requestMessages,
          modelId: selectedModel.modelId,
          modeOverride: targetSessionId ? composerModeToSessionType(targetMode) : undefined,
          providerId: selectedModel.providerId,
          sessionId: targetSessionId,
          tools: toolSettings,
          type: targetMode === "agent" ? "agentic" : "conversation",
        },
        {
          onAssistantMessage: (event) => {
            streamSessionId = event.sessionId;
            setSessionId(event.sessionId);
            setConversationTitle(event.title ?? pendingTitleBySession[event.sessionId] ?? null);
            writeChatRoute({
              messageId: null,
              mode: "replace",
              scope: modelSelector.session?.conversationScope ?? null,
              sessionId: event.sessionId,
            });
            void refreshConversations();
            updateAssistantMessage((message) => ({
              completedAt: new Date().toISOString(),
              content: appendAssistantContent(message.content, event.message.content),
              createdAt: event.message.createdAt,
              id: event.message.id,
              modelId: event.modelId,
              persisted: true,
              role: event.message.role,
              status: undefined,
              thinking: mergeAssistantThinking(message.thinking, event.thinking),
            }));
            revealAssistantMessage();
            startNextAssistantDraft();
          },
          onContentDelta: (event) => {
            updateAssistantMessage((message) => ({
              ...message,
              content: `${message.content}${event.delta}`,
              status: "thinking",
            }));
            revealAssistantMessage();
          },
          onDone: (event) => {
            streamSessionId = event.sessionId;
            setSessionId(event.sessionId);
            setConversationTitle(event.title ?? pendingTitleBySession[event.sessionId] ?? null);
            writeChatRoute({
              messageId: null,
              mode: "replace",
              scope: modelSelector.session?.conversationScope ?? null,
              sessionId: event.sessionId,
            });
            void refreshConversations();
            updateAssistantMessage((message) => ({
              completedAt: new Date().toISOString(),
              content: appendAssistantContent(message.content, event.message.content),
              createdAt: event.message.createdAt,
              id: event.message.id,
              modelId: event.modelId,
              persisted: true,
              role: event.message.role,
              status: undefined,
              thinking: mergeAssistantThinking(message.thinking, event.thinking),
            }));
            revealAssistantMessage();
            notifySessionFinishedOnce(event.sessionId, event.message.id);
          },
          onError: (event) => {
            throw new Error(event.error);
          },
          onStart: (event) => {
            streamSessionId = event.sessionId;
            setSessionId(event.sessionId);
            setSessionStartedMode((current) =>
              targetSessionId && event.sessionId === targetSessionId ? current ?? targetMode : targetMode,
            );
            setConversationTitle(event.title ?? pendingTitleBySession[event.sessionId] ?? null);
            writeChatRoute({
              messageId: null,
              mode: "replace",
              scope: modelSelector.session?.conversationScope ?? null,
              sessionId: event.sessionId,
            });
            void refreshConversations();
          },
          onSubAgentDelta: (event) => {
            setSubAgents((current) => updateSubAgentDelta(current, event));
          },
          onSubAgentMessage: (event) => {
            setSubAgents((current) => updateSubAgentMessage(current, event));
          },
          onSubAgentSpawned: (event) => {
            setSubAgents((current) => updateSubAgentSpawned(current, event));
          },
          onSubAgentStatus: (event) => {
            setSubAgents((current) => updateSubAgentStatus(current, event));
          },
          onSubAgentThinkingDelta: (event) => {
            setSubAgents((current) => updateSubAgentThinking(current, event));
          },
          onSubAgentToolCall: (event) => {
            setSubAgents((current) => updateSubAgentToolCall(current, event));
          },
          onThinkingDelta: (event) => {
            updateAssistantMessage((message) => ({
              ...message,
              status: "thinking",
              thinking: {
                content: `${message.thinking?.content ?? ""}${event.delta}`,
                durationMs: event.durationMs,
                toolCalls: message.thinking?.toolCalls,
                wordCount: event.wordCount,
              },
            }));
            revealAssistantMessage();
          },
          onToolCall: (event) => {
            revealAssistantMessage();
            applyTimerToolCall(event.call, streamSessionId ?? sessionIdRef.current);
            applyPlanToolCall(event.call);
            applyCommandTerminalToolCall(event.call);
            updateAssistantMessage((message) => ({
              ...message,
              status: "thinking",
              thinking: upsertToolCallThinking(message.thinking, event.call),
            }));
          },
          onUserChoiceRequest: (event) => {
            revealAssistantMessage();
            setUserChoiceQueue((current) => [...current, event.request]);
            notifyUserChoiceRequestOnce(event.request);
          },
        },
        {
          signal: abortController.signal,
        },
      );
    } catch (caught) {
      if (isAbortError(caught)) {
        updateAssistantMessage((message) => {
          const stoppedMessage = "Request stopped.";
          const thinking = failRunningToolCalls(message.thinking, stoppedMessage);

          return {
            ...message,
            completedAt: new Date().toISOString(),
            content: message.content.trim() ? message.content : stoppedMessage,
            thinking,
            status: "error",
          };
        });
        return;
      }

      const failureMessage = errorMessage(caught);

      updateAssistantMessage((message) => {
        const thinking = failRunningToolCalls(message.thinking, failureMessage);

        return {
          ...message,
          completedAt: new Date().toISOString(),
          content: assistantFailureContent({ ...message, thinking }, caught),
          thinking,
          status: "error",
        };
      });
    } finally {
      revealAssistantMessage();
      clearAssistantRevealTimer();
      setUserChoiceQueue([]);
      if (activeChatAbortControllerRef.current === abortController) {
        activeChatAbortControllerRef.current = null;
      }
      setIsSending(false);
    }
  }

  async function editMessage(
    messageId: string,
    content: string,
    attachments: ChatAttachment[] | undefined,
  ): Promise<void> {
    const previousMessages = messages;
    const messageIndex = previousMessages.findIndex((message) => message.id === messageId);
    const existing = messageIndex >= 0 ? previousMessages[messageIndex] : undefined;

    if (!existing) {
      return;
    }

    const nextAttachments = attachments?.length ? attachments : undefined;

    setMessages((current) =>
      current.map((message) =>
        message.id === messageId ? { ...message, attachments: nextAttachments, content } : message,
      ),
    );

    if (!sessionId || !existing.persisted) {
      if (previousMessages.length > messageIndex + 1) {
        setEditedMessageRegeneration({
          messageIndex,
          role: existing.role,
        });
      }

      return;
    }

    try {
      const updated = await updateAgentSessionMessage(sessionId, messageId, {
        attachments: nextAttachments,
        content,
      });

      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                ...storedMessageToUiMessage(updated, existing.modelId ?? ""),
                modelId: existing.modelId,
                persisted: true,
              }
            : message,
        ),
      );
      setConversationError(null);
      void refreshConversations();

      if (previousMessages.length > messageIndex + 1) {
        setEditedMessageRegeneration({
          messageIndex,
          role: existing.role,
        });
      }
    } catch (caught) {
      setMessages(previousMessages);
      setConversationError(errorMessage(caught));
      throw caught;
    }
  }

  async function updateMessageAttachment(
    messageId: string,
    updatedAttachment: ChatAttachment,
  ): Promise<void> {
    const previousMessages = messages;
    const messageIndex = previousMessages.findIndex((message) => message.id === messageId);
    const existing = messageIndex >= 0 ? previousMessages[messageIndex] : undefined;

    if (!existing?.attachments?.length) {
      return;
    }

    const nextAttachments = existing.attachments.map((attachment) =>
      attachment.id === updatedAttachment.id ? updatedAttachment : attachment,
    );
    const attachmentChanged = nextAttachments.some((attachment, index) => {
      const previousAttachment = existing.attachments?.[index];

      return previousAttachment ? attachment !== previousAttachment : true;
    });

    if (!attachmentChanged) {
      return;
    }

    setMessages((current) =>
      current.map((message) =>
        message.id === messageId ? { ...message, attachments: nextAttachments } : message,
      ),
    );

    if (!sessionId || !existing.persisted) {
      if (previousMessages.length > messageIndex + 1) {
        setEditedMessageRegeneration({
          messageIndex,
          role: existing.role,
        });
      }

      return;
    }

    try {
      const updated = await updateAgentSessionMessage(sessionId, messageId, {
        attachments: nextAttachments,
        content: existing.content,
      });

      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                ...storedMessageToUiMessage(updated, existing.modelId ?? ""),
                modelId: existing.modelId,
                persisted: true,
              }
            : message,
        ),
      );
      setConversationError(null);
      void refreshConversations();

      if (previousMessages.length > messageIndex + 1) {
        setEditedMessageRegeneration({
          messageIndex,
          role: existing.role,
        });
      }
    } catch (caught) {
      setMessages(previousMessages);
      setConversationError(errorMessage(caught));
      throw caught;
    }
  }

  async function deleteMessage(messageId: string): Promise<void> {
    const previousMessages = messages;
    const existing = previousMessages.find((message) => message.id === messageId);

    if (!existing) {
      return;
    }

    setMessages((current) => current.filter((message) => message.id !== messageId));

    if (!sessionId || !existing.persisted) {
      return;
    }

    try {
      await deleteAgentSessionMessage(sessionId, messageId);
      setConversationError(null);
      void refreshConversations();
    } catch (caught) {
      setMessages(previousMessages);
      setConversationError(errorMessage(caught));
      throw caught;
    }
  }

  async function retryMessage(messageId: string): Promise<void> {
    const messageIndex = messages.findIndex((message) => message.id === messageId);

    if (messageIndex < 0) {
      return;
    }

    await retryMessageAtIndex({
      messageIndex,
      sourceMessages: messages,
      targetMode: conversationMode,
      targetSessionId: sessionId,
    });
  }

  async function retryMessageAtIndex({
    messageIndex,
    sourceMessages,
    targetMode,
    targetSessionId,
  }: {
    messageIndex: number;
    sourceMessages: ChatUiMessage[];
    targetMode: ComposerMode;
    targetSessionId: string | null;
  }): Promise<void> {
    if (isSending) {
      return;
    }

    const selectedModel = modelSelector.selected;

    if (!selectedModel) {
      appendModelSelectionError();
      return;
    }

    if (messageIndex < 0 || messageIndex >= sourceMessages.length) {
      return;
    }

    const message = sourceMessages[messageIndex];

    if (!message) {
      return;
    }

    const retryMessages =
      message.role === "assistant"
        ? sourceMessages.slice(0, messageIndex)
        : sourceMessages.slice(0, messageIndex + 1);

    if (toChatRequestMessages(retryMessages).length === 0) {
      return;
    }

    requestBrowserNotificationPermission();

    setMessages(retryMessages);
    await streamAssistantResponse({
      baseMessages: retryMessages,
      selectedModel,
      targetMode,
      targetSessionId,
    });
  }

  async function cancelTimer(timer: ActiveTimerStatus): Promise<void> {
    const response = await cancelOrchestrationTimer(timer.timerId, {
      sessionId: timer.sessionId,
    });

    if (response.cancelled) {
      setActiveTimers((current) => current.filter((item) => item.timerId !== timer.timerId));
    } else {
      setActiveTimers((current) => current.filter((item) => item.timerId !== timer.timerId));
      showToast("Timer was already finished.");
    }
  }

  async function extendTimer(timer: ActiveTimerStatus): Promise<void> {
    const response = await extendOrchestrationTimer(timer.timerId, {
      delaySeconds: timer.lengthSeconds,
      sessionId: timer.sessionId,
    });

    const extendedTimer = response.timer;

    if (extendedTimer) {
      setActiveTimers((current) =>
        upsertActiveTimer(current, {
          firesAt: extendedTimer.firesAt,
          ...(extendedTimer.label ? { label: extendedTimer.label } : {}),
          lengthSeconds: extendedTimer.lengthSeconds,
          message: extendedTimer.message,
          sessionId: timer.sessionId,
          ...(extendedTimer.startedAt ? { startedAt: extendedTimer.startedAt } : {}),
          timerId: extendedTimer.timerId,
        }),
      );
    } else {
      setActiveTimers((current) => current.filter((item) => item.timerId !== timer.timerId));
      showToast("Timer was already finished.");
    }
  }

  function applyPlanToolCall(call: ChatToolCall): void {
    const nextPlan = planFromToolCall(call);

    if (nextPlan) {
      setActivePlan(nextPlan);
    }
  }

  async function fireTimer(timer: ActiveTimerStatus): Promise<void> {
    const response = await fireOrchestrationTimer(timer.timerId, {
      sessionId: timer.sessionId,
    });

    if (response.fired) {
      setActiveTimers((current) => current.filter((item) => item.timerId !== timer.timerId));
    } else {
      setActiveTimers((current) => current.filter((item) => item.timerId !== timer.timerId));
      showToast("Timer was already finished.");
    }
  }

  function applyTimerToolCall(call: ChatToolCall, fallbackSessionId: string | null): void {
    const nextTimer = activeTimerFromToolCall(call, fallbackSessionId);

    if (nextTimer) {
      setActiveTimers((current) => upsertActiveTimer(current, nextTimer));
      return;
    }

    const removedTimerId = removedTimerIdFromToolCall(call);

    if (removedTimerId) {
      setActiveTimers((current) =>
        current.filter((timer) => timer.timerId !== removedTimerId),
      );
    }
  }

  function applyCommandTerminalToolCall(call: ChatToolCall): void {
    if (!call.terminal) {
      return;
    }

    const terminal = commandTerminalSummaryFromReference(call.terminal);

    setCommandTerminals((current) => ({
      ...current,
      [terminal.terminalId]: mergeCommandTerminalSummary(
        current[terminal.terminalId],
        terminal,
      ),
    }));
  }

  async function regenerateEditedMessageInCurrentSession(
    prompt: EditedMessageRegenerationPrompt,
  ): Promise<void> {
    setEditedMessageRegeneration(null);
    await retryMessageAtIndex({
      messageIndex: prompt.messageIndex,
      sourceMessages: messages,
      targetMode: conversationMode,
      targetSessionId: sessionId,
    });
  }

  async function duplicateAndRegenerateEditedMessage(
    prompt: EditedMessageRegenerationPrompt,
  ): Promise<void> {
    const currentSessionId = sessionId;

    if (!currentSessionId || isSending) {
      return;
    }

    try {
      setEditedMessageRegeneration(null);

      const created = await duplicateAgentSession(currentSessionId);
      const detail = await fetchAgentSession(created.id);
      const nextMode = detail.session.type === "agentic" ? "agent" : "conversation";
      const nextMessages = detail.messages.map((message) =>
        storedMessageToUiMessage(message, detail.session.modelId),
      );

      applyConversationSummary(created);
      conversationModeWasUserSelectedRef.current = false;
      setConversationMode(nextMode);
      setSessionStartedMode(nextMode);
      modelSelector.setSelectionForMode(nextMode, {
        modelId: detail.session.modelId,
        providerId: detail.session.providerId,
      });
      setConversationTitle(detail.session.title);
      setCurrentSession(detail.session);
      setMessages(nextMessages);
      setMessageAnchorId(null);
      setSessionId(detail.session.id);
      setConversationError(null);
      writeChatRoute({
        messageId: null,
        scope: modelSelector.session?.conversationScope ?? null,
        sessionId: detail.session.id,
      });

      await retryMessageAtIndex({
        messageIndex: prompt.messageIndex,
        sourceMessages: nextMessages,
        targetMode: nextMode,
        targetSessionId: detail.session.id,
      });
      void refreshConversations();
    } catch (caught) {
      setConversationError(errorMessage(caught));
      throw caught;
    }
  }

  async function resolveUserChoice(
    request: ChatUserChoiceRequest,
    payload: ChatUserChoiceResolutionRequest,
  ): Promise<void> {
    const resolution =
      request.kind === "directory_access"
        ? await applyDirectoryAccessResolution(request, payload)
        : payload;

    await resolveChatUserChoice(request.id, resolution);
    setUserChoiceQueue((current) => current.filter((item) => item.id !== request.id));
  }

  async function applyDirectoryAccessResolution(
    request: ChatUserChoiceRequest,
    payload: ChatUserChoiceResolutionRequest,
  ): Promise<ChatUserChoiceResolutionRequest> {
    const selectedOption = request.options.find((option) => option.id === payload.optionId);

    if (selectedOption?.value !== "allow" || !request.directoryAccess) {
      return payload;
    }

    const directoryPath = request.directoryAccess.directoryPath;
    const readOnly = request.directoryAccess.readOnly;
    const currentSecurity = await fetchFileAccessSettings();
    const directories = mergeFileAccessDirectoryUpdates(
      currentSecurity.directories,
      { path: directoryPath, readOnly },
    );
    const updatedSecurity = await updateFileAccessSettings({ directories });
    const grantedDirectory =
      updatedSecurity.directories.find((directory) => samePath(directory.path, directoryPath))
        ?.path ?? directoryPath;
    const reload = await reloadMcpServers();

    modelSelector.updateMcpSummary(reload.mcp);
    showToast("Directory granted and MCP reloaded.");

    return {
      ...payload,
      appliedEffect: {
        directoryPath: grantedDirectory,
        mcpReloaded: true,
        readOnly,
        type: "file_access_directory_granted",
      },
    };
  }

  async function openSubAgentPanel(subAgent: ChatSubAgentReference): Promise<void> {
    setOpenSubAgentId(subAgent.subSessionId);
    setSubAgents((current) => ({
      ...current,
      [subAgent.subSessionId]: mergeSubAgentReference(current[subAgent.subSessionId], subAgent),
    }));

    try {
      const detail = await fetchAgentSession(subAgent.subSessionId);

      setSubAgents((current) => ({
        ...current,
        [subAgent.subSessionId]: {
          ...mergeSubAgentReference(current[subAgent.subSessionId], subAgent),
          messages: detail.messages.map((message) =>
            storedMessageToUiMessage(message, detail.session.modelId),
          ),
          modelId: detail.session.modelId,
        },
      }));
      setConversationError(null);
    } catch (caught) {
      setConversationError(errorMessage(caught));
    }
  }

  async function openSubAgentPanelById(subSessionId: string): Promise<void> {
    const existing = subAgents[subSessionId] ?? emptySubAgentSession(subSessionId);

    setOpenSubAgentId(subSessionId);
    setSubAgents((current) => ({
      ...current,
      [subSessionId]: current[subSessionId] ?? existing,
    }));

    try {
      const detail = await fetchAgentSession(subSessionId);

      setSubAgents((current) => ({
        ...current,
        [subSessionId]: {
          ...current[subSessionId],
          messages: detail.messages.map((message) =>
            storedMessageToUiMessage(message, detail.session.modelId),
          ),
          modelId: detail.session.modelId,
          parentSessionId: detail.session.parentSessionId ?? current[subSessionId]?.parentSessionId ?? "",
          startedAt: detail.session.createdAt,
          status: current[subSessionId]?.status ?? "done",
          subSessionId,
          task: detail.session.title ?? current[subSessionId]?.task ?? "Sub-agent",
        },
      }));
      setConversationError(null);
    } catch (caught) {
      setConversationError(errorMessage(caught));
    }
  }

  async function killTerminalFromActivity(terminal: CommandTerminalSummary): Promise<void> {
    const currentSessionId = sessionIdRef.current;

    if (!currentSessionId) {
      return;
    }

    setKillingTerminalId(terminal.terminalId);
    try {
      const response = await killCommandTerminal(terminal.terminalId, currentSessionId);

      setCommandTerminals((current) => ({
        ...current,
        [response.terminal.terminalId]: response.terminal,
      }));
    } catch (caught) {
      showToast(errorMessage(caught));
    } finally {
      setKillingTerminalId((current) =>
        current === terminal.terminalId ? null : current,
      );
    }
  }

  async function terminateCommandFromTranscript(toolCall: ChatToolCall): Promise<void> {
    const currentSessionId = sessionIdRef.current;
    const executionId = toolCall.commandExecution?.executionId;

    if (!currentSessionId || !executionId) {
      return;
    }

    try {
      const response = await killCommandExecution(executionId, currentSessionId);

      setMessages((current) =>
        applyCommandExecutionToMessages(current, response.execution),
      );
    } catch (caught) {
      showToast(errorMessage(caught));
    }
  }

  function dismissWorkspaceOriginBanner(targetSessionId: string): void {
    setDismissedWorkspaceOriginBanners((current) => {
      const next = new Set(current);

      next.add(targetSessionId);
      writeDismissedWorkspaceOriginBanners(next);
      return next;
    });
  }

  async function copyWorkspacePath(workspacePath: string): Promise<void> {
    try {
      await copyTextToClipboard(workspacePath);
      showToast("Workspace path copied to clipboard.");
      setConversationError(null);
    } catch (caught) {
      setConversationError(errorMessage(caught));
    }
  }

  async function launchWorkspaceForSession(session: AgentSessionSummary): Promise<void> {
    if (!session.workspacePath || session.workspaceExists === false || launchingWorkspaceSessionId) {
      return;
    }

    const openedWindow = window.open("about:blank", "_blank");

    setLaunchingWorkspaceSessionId(session.id);
    trackWorkspaceOriginBannerEvent("click", session);

    try {
      const launch = await launchWorkspaceConversation({
        messageId: currentRouteMessageId(),
        sessionId: session.id,
        workspacePath: session.workspacePath,
      });

      if (openedWindow) {
        openedWindow.location.href = launch.url;
        openedWindow.focus();
      } else {
        window.open(launch.url, "_blank", "noopener,noreferrer");
      }

      setConversationError(null);
    } catch (caught) {
      openedWindow?.close();
      setConversationError(errorMessage(caught));
    } finally {
      setLaunchingWorkspaceSessionId((current) => (current === session.id ? null : current));
    }
  }

  async function launchWorkspaceInCurrentWindow(workspacePath: string): Promise<void> {
    if (workspaceNavigationPending) {
      return;
    }

    setWorkspaceNavigationPending(true);

    try {
      const launch = await launchWorkspaceConversation({ workspacePath });

      window.location.href = launch.url;
    } catch (caught) {
      setConversationError(errorMessage(caught));
      setWorkspaceNavigationPending(false);
    }
  }

  async function pickAndLaunchWorkspace(): Promise<void> {
    if (workspaceNavigationPending) {
      return;
    }

    setWorkspaceNavigationPending(true);

    try {
      const selection = await pickWorkspaceDirectory();

      if (selection.cancelled || !selection.workspacePath) {
        setWorkspaceNavigationPending(false);
        return;
      }

      const launch = await launchWorkspaceConversation({
        workspacePath: selection.workspacePath,
      });

      window.location.href = launch.url;
    } catch (caught) {
      setConversationError(errorMessage(caught));
      setWorkspaceNavigationPending(false);
    }
  }

  async function returnToGlobalView(): Promise<void> {
    if (workspaceNavigationPending) {
      return;
    }

    setWorkspaceNavigationPending(true);

    try {
      const launch = await launchWorkspaceConversation({ workspacePath: null });

      window.location.href = launch.url;
    } catch (caught) {
      setConversationError(errorMessage(caught));
      setWorkspaceNavigationPending(false);
    }
  }

  function requestDeleteWorkspace(workspace: WorkspaceSummary): void {
    if (isSending) {
      return;
    }

    setDeleteWorkspaceTarget(workspace);
  }

  async function deleteWorkspace(workspace: WorkspaceSummary): Promise<void> {
    if (isSending) {
      return;
    }

    try {
      await deleteWorkspaceSessions({ workspacePath: workspace.workspacePath });
      setWorkspaces((current) =>
        current.filter((item) => !samePath(item.workspacePath, workspace.workspacePath)),
      );
      setConversations((current) =>
        current.filter(
          (conversation) => !samePath(conversation.workspacePath, workspace.workspacePath),
        ),
      );

      if (samePath(currentSession?.workspacePath, workspace.workspacePath)) {
        startNewConversation();
      }

      setConversationError(null);
      setWorkspaceError(null);
      showToast("Workspace sessions deleted.");
      void refreshConversations();
      void refreshWorkspaces();
    } catch (caught) {
      setWorkspaceError(errorMessage(caught));
      throw caught;
    }
  }

  function consumeMessageAnchor(messageId: string): void {
    setMessageAnchorId((current) => (current === messageId ? null : current));
  }

  function reportMissingMessageAnchor(messageId: string): void {
    setMessageAnchorId((current) => (current === messageId ? null : current));
    showToast("Message anchor was not found.");
  }

  const hasMessages = messages.length > 0;
  const automaticTaskSession = currentSession?.type === "sub-agent";
  const sidebarSearchExpanded = sidebarSearchFocused || conversationSearch.trim().length > 0;
  const activeConversationTarget =
    sessionId === null
      ? null
      : conversations.find((conversation) => conversation.id === sessionId) ??
        (currentSession?.id === sessionId ? currentSession : null) ?? {
          id: sessionId,
          title: conversationTitle,
        };
  const followUpPrompts = followUpsForLatestAssistantMessage(messages, richFeatures);
  const openSubAgent = openSubAgentId ? subAgents[openSubAgentId] ?? null : null;
  const activitySubAgents = subAgentsForActivity(messages, Object.values(subAgents), sessionId);
  const activityTerminals = commandTerminalsForActivity(
    messages,
    Object.values(commandTerminals),
  );
  const openTerminal = openTerminalId
    ? activityTerminals.find((terminal) => terminal.terminalId === openTerminalId) ?? null
    : null;
  const activitySharedFiles = sharedFilesForActivity(messages);
  const emptyScopeIndicator =
    !sessionId && !hasMessages && modelSelector.session?.conversationScope ? (
      <div className="truss-empty-scope-indicator absolute left-1/2 top-6 z-30 flex w-[calc(100%-2rem)] -translate-x-1/2 justify-center px-4 sm:top-8 md:top-10">
        <ConversationScopeIndicator
          className="mx-auto w-fit bg-surface-container-lowest/95 backdrop-blur"
          scope={modelSelector.session.conversationScope}
        />
      </div>
    ) : null;
  const showWorkspaceOriginBanner =
    currentSession &&
    shouldShowWorkspaceOriginBanner({
      currentScope: modelSelector.session?.conversationScope ?? null,
      dismissedSessionIds: dismissedWorkspaceOriginBanners,
      session: currentSession,
    });
  const workspaceOriginBanner =
    showWorkspaceOriginBanner && currentSession?.workspacePath ? (
      <WorkspaceOriginBanner
        launchDisabled={Boolean(launchingWorkspaceSessionId)}
        launchPending={launchingWorkspaceSessionId === currentSession.id}
        onCopyWorkspacePath={() => void copyWorkspacePath(currentSession.workspacePath ?? "")}
        onDismiss={() => dismissWorkspaceOriginBanner(currentSession.id)}
        onLaunchWorkspace={() => void launchWorkspaceForSession(currentSession)}
        workspaceDisplayName={currentSession.workspaceDisplayName}
        workspaceExists={currentSession.workspaceExists}
        workspacePath={currentSession.workspacePath}
      />
    ) : null;

  return (
    <main className="relative flex min-h-screen overflow-hidden bg-surface text-on-surface">
      <div className="truss-grid pointer-events-none fixed inset-0 z-0" />
      <DesktopSidebar
        activeSessionId={sessionId}
        conversations={conversations}
        disabled={isSending}
        error={conversationError}
        loading={loadingConversations}
        mobileOpen={mobileSidebarOpen}
        onAutoRename={(conversation) => void autoRenameConversation(conversation)}
        onCopyToClipboard={(conversation) => void copyConversationToClipboard(conversation)}
        onDelete={requestDeleteConversation}
        onDeleteWorkspace={requestDeleteWorkspace}
        onDuplicate={(conversation) => void duplicateConversation(conversation)}
        onExport={(conversation, format) => void exportConversation(conversation, format)}
        onManualRename={setManualRenameSession}
        onMobileClose={() => setMobileSidebarOpen(false)}
        onNewChat={startNewConversation}
        onNewWorkspace={() => void pickAndLaunchWorkspace()}
        onOpenConversation={(nextSessionId) => void openConversationFromSidebar(nextSessionId)}
        onOpenWorkspace={(workspace) => void launchWorkspaceInCurrentWindow(workspace.workspacePath)}
        onRefreshWorkspaces={() => void refreshWorkspaces()}
        onReturnToGlobalView={() => void returnToGlobalView()}
        onSearchChange={setConversationSearch}
        onSearchFocusChange={setSidebarSearchFocused}
        onSettings={openSettings}
        scheduledTaskSessions={scheduledTaskSessions}
        scheduledTaskSessionsError={scheduledTaskSessionsError}
        scheduledTaskSessionsLoading={loadingScheduledTaskSessions}
        searchValue={conversationSearch}
        scope={modelSelector.session?.conversationScope ?? null}
        workspaceError={workspaceError}
        workspaceLoading={loadingWorkspaces}
        workspaceNavigationPending={workspaceNavigationPending}
        workspaces={workspaces}
      />

      <section
        className={[
          "relative z-10 flex h-screen min-w-0 flex-1 flex-col overflow-hidden transition-[filter,opacity] duration-300 ease-out",
          sidebarSearchExpanded
            ? "md:opacity-45 md:brightness-75 md:blur-[5px]"
            : "opacity-100 brightness-100 blur-0",
        ].join(" ")}
      >
        {emptyScopeIndicator}
        <div
          className={[
            "truss-chat-stage flex min-h-0 min-w-0 flex-1 transition-all duration-500 ease-out",
            hasMessages
              ? "truss-chat-stage-loaded h-full flex-col pb-24 md:pb-0"
              : "truss-chat-stage-empty items-center justify-center px-5 pb-28 pt-10 sm:px-8 md:pb-10 lg:px-12",
          ].join(" ")}
        >
          <div
            className={[
              "flex w-full min-w-0 flex-col transition-all duration-500 ease-out",
              hasMessages
                ? "h-full min-h-0 max-w-none"
                : "max-h-screen max-w-[850px] justify-center gap-4",
            ].join(" ")}
          >
            <ConversationHeader
              canEditTitle={Boolean(sessionId) && !isSending && !automaticTaskSession}
              hasMessages={hasMessages}
              loadingModels={modelSelector.loading}
              mode={conversationMode}
              modelOptions={modelSelector.options}
              conversationActionsDisabled={
                !activeConversationTarget || isSending || automaticTaskSession
              }
              onCopyAllToClipboard={() => {
                if (activeConversationTarget) {
                  void copyConversationToClipboard(activeConversationTarget);
                }
              }}
              onDelete={() => {
                if (activeConversationTarget) {
                  requestDeleteConversation(activeConversationTarget);
                }
              }}
              onDuplicate={() => {
                if (activeConversationTarget) {
                  void duplicateConversation(activeConversationTarget);
                }
              }}
              onExport={(format) => {
                if (activeConversationTarget) {
                  void exportConversation(activeConversationTarget, format);
                }
              }}
              onModelChange={modelSelector.onModelChange}
              onModeChange={changeConversationMode}
              onTitleSubmit={updateCurrentConversationTitle}
              selectedModel={modelSelector.selected}
              sessionStartedMode={sessionStartedMode}
              title={conversationTitle}
            />
            {hasMessages ? (
              <ChatTranscript
                banner={workspaceOriginBanner}
                disabled={isSending}
                initialTopScrollKey={workspaceOriginBanner ? currentSession?.id ?? null : null}
                messageAnchorId={messageAnchorId}
                messages={messages}
                onCopySuccess={showToast}
                onDeleteMessage={deleteMessage}
                onEditMessage={editMessage}
                onMessageAnchorMissing={reportMissingMessageAnchor}
                onMessageAnchorResolved={consumeMessageAnchor}
                onOpenSubAgentId={(subSessionId) => void openSubAgentPanelById(subSessionId)}
                onOpenSubAgent={(subAgent) => void openSubAgentPanel(subAgent)}
                onRetryMessage={retryMessage}
                onTerminateCommand={(toolCall) => terminateCommandFromTranscript(toolCall)}
                onUpdateAttachment={updateMessageAttachment}
                richFeatures={richFeatures}
              />
            ) : null}
            {automaticTaskSession ? (
              <AutomaticTaskNotice
                disabled={isSending}
                onCopy={() => {
                  if (activeConversationTarget) {
                    void duplicateConversation(activeConversationTarget);
                  }
                }}
              />
            ) : (
              <ChatPromptCard
                docked={hasMessages}
                disabled={isSending}
                followUps={followUpPrompts}
                mode={conversationMode}
                onModeChange={changeConversationMode}
                onMcpReloaded={modelSelector.updateMcpSummary}
                onSend={(content, attachments) => void sendMessage(content, attachments)}
                onStop={stopActiveRequest}
                onToolSettingsChange={setToolSettings}
                running={isSending}
                mcp={modelSelector.session?.mcp ?? null}
                toolSettings={toolSettings}
              />
            )}
          </div>
        </div>
      </section>

      <ActivityStatusPane
        onCancelTimer={(timer) => cancelTimer(timer)}
        onExtendTimer={(timer) => extendTimer(timer)}
        onFireTimer={(timer) => fireTimer(timer)}
        onKillTerminal={(terminal) => killTerminalFromActivity(terminal)}
        onOpenTerminal={setOpenTerminalId}
        onOpenSubAgent={(subSessionId) => void openSubAgentPanelById(subSessionId)}
        plan={activePlan}
        sharedFiles={activitySharedFiles}
        subAgents={activitySubAgents}
        terminals={activityTerminals}
        timers={activeTimers}
      />
      <MobileNavigation
        historyOpen={mobileSidebarOpen}
        newChatActive={!sessionId && !mobileSidebarOpen}
        onHistoryClick={() => setMobileSidebarOpen((current) => !current)}
        onNewChat={startNewConversation}
        onSettingsClick={openSettings}
      />
      <SubAgentPanel
        onClose={() => setOpenSubAgentId(null)}
        open={Boolean(openSubAgentId)}
        richFeatures={richFeatures}
        session={openSubAgent}
      />
      <TerminalPanel
        onClose={() => setOpenTerminalId(null)}
        onKill={(terminal) => void killTerminalFromActivity(terminal)}
        open={Boolean(openTerminalId)}
        pendingKill={Boolean(openTerminal && killingTerminalId === openTerminal.terminalId)}
        terminal={openTerminal}
      />
      <ToastNotification toast={toast} />
      <EditedMessageRegenerationDialog
        disabled={isSending}
        prompt={editedMessageRegeneration}
        onClose={() => setEditedMessageRegeneration(null)}
        onDuplicate={(prompt) => duplicateAndRegenerateEditedMessage(prompt)}
        onOverwrite={(prompt) => regenerateEditedMessageInCurrentSession(prompt)}
      />
      <UserChoiceDialog
        onResolve={(request, payload) => resolveUserChoice(request, payload)}
        request={userChoiceQueue[0] ?? null}
        queueLength={userChoiceQueue.length}
      />
      <DeleteConversationDialog
        onClose={() => setDeleteConversationSession(null)}
        onDelete={(conversation) => deleteConversation(conversation)}
        session={deleteConversationSession}
      />
      <DeleteWorkspaceDialog
        onClose={() => setDeleteWorkspaceTarget(null)}
        onDelete={(workspace) => deleteWorkspace(workspace)}
        workspace={deleteWorkspaceTarget}
      />
      <ManualRenameDialog
        onClose={() => setManualRenameSession(null)}
        onRename={(conversation, title) => manuallyRenameConversation(conversation, title)}
        session={manualRenameSession}
      />
    </main>
  );
}

function AutomaticTaskNotice({
  disabled,
  onCopy,
}: {
  disabled: boolean;
  onCopy(): void;
}) {
  return (
    <aside className="mx-auto flex w-full max-w-[980px] shrink-0 items-center justify-between gap-4 border-t border-outline-variant bg-surface-container-low px-5 py-4 sm:px-8 lg:px-12">
      <div className="flex min-w-0 items-center gap-3">
        <MaterialIcon className="shrink-0 text-primary" name="schedule" size={22} />
        <div>
          <p className="font-semibold text-on-surface">This is an automatic task.</p>
          <p className="text-sm text-on-surface-variant">
            Copy it to continue as a regular conversation.
          </p>
        </div>
      </div>
      <button
        className="inline-flex shrink-0 items-center gap-2 rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
        disabled={disabled}
        onClick={onCopy}
        type="button"
      >
        <MaterialIcon name="control_point_duplicate" size={18} />
        Copy as conversation
      </button>
    </aside>
  );
}

function isAbortError(caught: unknown): boolean {
  return (
    (caught instanceof DOMException && caught.name === "AbortError") ||
    (caught instanceof Error && caught.name === "AbortError")
  );
}

function followUpsForLatestAssistantMessage(
  messages: ChatUiMessage[],
  richFeatures: RichFeatureSettingsSummary,
): string[] {
  const latestMessage = messages.at(-1);

  if (
    !latestMessage ||
    latestMessage.role !== "assistant" ||
    latestMessage.status === "thinking"
  ) {
    return [];
  }

  return extractMarkdownFollowUps(latestMessage.content, richFeatures);
}

function upsertAgentEventMessage(
  current: ChatUiMessage[],
  event: AgentMessageEvent,
): ChatUiMessage[] {
  const message: ChatUiMessage = event.message
    ? {
        ...storedMessageToUiMessage(event.message, event.modelId ?? ""),
        generated: event.generated,
        modelId: event.message.role === "assistant" ? event.modelId : undefined,
        status: undefined,
      }
    : {
        content: event.content,
        createdAt: event.createdAt,
        generated: event.generated,
        id: event.messageId,
        modelId: event.role === "assistant" ? event.modelId : undefined,
        persisted: false,
        role: event.role === "assistant" ? "assistant" : "user",
        status: event.role === "assistant" ? "thinking" : undefined,
      };
  const existingIndex = current.findIndex((item) => item.id === message.id);

  if (existingIndex >= 0) {
    return current.map((item) =>
      item.id === message.id
        ? {
            ...item,
            ...message,
            content: message.content || item.content,
            generated: message.generated ?? item.generated,
          }
        : item,
    );
  }

  return [...current, message];
}

function appendAgentEventDelta(
  current: ChatUiMessage[],
  event: AgentDeltaEvent,
): ChatUiMessage[] {
  const existing = current.find((message) => message.id === event.messageId);

  if (!existing) {
    return [
      ...current,
      {
        content: event.delta,
        createdAt: event.createdAt,
        id: event.messageId,
        persisted: false,
        role: "assistant",
        status: "thinking",
      },
    ];
  }

  return current.map((message) =>
    message.id === event.messageId
      ? {
          ...message,
          content: `${message.content}${event.delta}`,
          status: "thinking",
        }
      : message,
  );
}

function applyCommandExecutionToMessages(
  current: ChatUiMessage[],
  execution: ChatCommandExecutionReference,
): ChatUiMessage[] {
  let changed = false;
  const next = current.map((message) => {
    const thinking = message.thinking;
    const toolCalls = thinking?.toolCalls;

    if (!thinking || !toolCalls?.length) {
      return message;
    }

    let messageChanged = false;
    const nextToolCalls = toolCalls.map((toolCall) => {
      const matches =
        toolCall.commandExecution?.executionId === execution.executionId ||
        toolCall.id === execution.executionId;

      if (!matches) {
        return toolCall;
      }

      changed = true;
      messageChanged = true;
      return {
        ...toolCall,
        commandExecution: execution,
      };
    });

    return messageChanged
      ? {
          ...message,
          thinking: {
            ...thinking,
            toolCalls: nextToolCalls,
          },
        }
      : message;
  });

  return changed ? next : current;
}

function completeAgentEventMessage(
  current: ChatUiMessage[],
  event: AgentDoneEvent,
): ChatUiMessage[] {
  if (event.message) {
    return upsertAgentEventMessage(current, {
      ...event,
      content: event.message.content,
      messageId: event.message.id,
      role: event.message.role,
      type: "agent.message",
    });
  }

  return current.map((message) =>
    message.id === event.messageId
      ? {
          ...message,
          persisted: true,
          status: undefined,
        }
      : message,
  );
}

type SubAgentMap = Record<string, SubAgentPanelSession>;

function subAgentsForActivity(
  messages: ChatUiMessage[],
  liveSubAgents: SubAgentPanelSession[],
  sessionId: string | null,
): SubAgentPanelSession[] {
  const byId = new Map<string, SubAgentPanelSession>();

  for (const message of messages) {
    for (const toolCall of message.thinking?.toolCalls ?? []) {
      const subAgent = toolCall.subAgent;

      if (!subAgent || (sessionId && subAgent.parentSessionId !== sessionId)) {
        continue;
      }

      byId.set(
        subAgent.subSessionId,
        mergeSubAgentReference(byId.get(subAgent.subSessionId), subAgent),
      );
    }
  }

  for (const subAgent of liveSubAgents) {
    const existing = byId.get(subAgent.subSessionId);

    if (
      sessionId &&
      subAgent.parentSessionId &&
      subAgent.parentSessionId !== sessionId &&
      !existing
    ) {
      continue;
    }

    if (sessionId && !subAgent.parentSessionId && !existing) {
      continue;
    }

    byId.set(subAgent.subSessionId, mergeSubAgentPanelSession(existing, subAgent));
  }

  return [...byId.values()].sort(compareActivitySubAgents);
}

function mergeSubAgentPanelSession(
  current: SubAgentPanelSession | undefined,
  next: SubAgentPanelSession,
): SubAgentPanelSession {
  return {
    completedAt: next.completedAt ?? current?.completedAt,
    elapsedMs: next.elapsedMs ?? current?.elapsedMs,
    messages: next.messages.length > 0 ? next.messages : current?.messages ?? [],
    modelId: next.modelId ?? current?.modelId,
    parentSessionId: next.parentSessionId ?? current?.parentSessionId,
    startedAt: next.startedAt ?? current?.startedAt,
    status: next.status,
    subSessionId: next.subSessionId,
    task: next.task || current?.task || "Sub-agent",
    toolTurnCount: next.toolTurnCount ?? current?.toolTurnCount,
  };
}

function compareActivitySubAgents(
  first: SubAgentPanelSession,
  second: SubAgentPanelSession,
): number {
  const statusDelta = subAgentStatusRank(first.status) - subAgentStatusRank(second.status);

  if (statusDelta !== 0) {
    return statusDelta;
  }

  return subAgentSortTimestamp(second) - subAgentSortTimestamp(first);
}

function subAgentStatusRank(status: SubAgentPanelSession["status"]): number {
  if (status === "running") {
    return 0;
  }

  if (status === "error") {
    return 1;
  }

  return 2;
}

function subAgentSortTimestamp(subAgent: SubAgentPanelSession): number {
  const value = subAgent.completedAt ?? subAgent.startedAt;
  const timestamp = value ? new Date(value).getTime() : 0;

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function commandTerminalsForActivity(
  messages: ChatUiMessage[],
  liveTerminals: CommandTerminalSummary[],
): CommandTerminalSummary[] {
  const byId = new Map<string, CommandTerminalSummary>();

  for (const message of messages) {
    for (const toolCall of message.thinking?.toolCalls ?? []) {
      if (!toolCall.terminal) {
        continue;
      }

      const terminal = commandTerminalSummaryFromReference(toolCall.terminal);

      byId.set(
        terminal.terminalId,
        mergeCommandTerminalSummary(byId.get(terminal.terminalId), terminal),
      );
    }
  }

  for (const terminal of liveTerminals) {
    byId.set(
      terminal.terminalId,
      mergeCommandTerminalSummary(byId.get(terminal.terminalId), terminal),
    );
  }

  return [...byId.values()].sort(compareCommandTerminals);
}

function commandTerminalSummaryFromReference(
  terminal: ChatCommandTerminalReference,
): CommandTerminalSummary {
  // updatedAt is intentionally left unknown ("") rather than pinned to startedAt: this
  // reconstructed summary comes from a static tool-call reference captured once when the
  // tool ran, so its status can go stale (e.g. the terminal idle-timed-out afterward). Leaving
  // updatedAt unset makes it the "oldest" candidate in mergeCommandTerminalSummary, so any
  // live SSE update or server reconciliation fetch always overrides it regardless of when
  // this reference itself was captured.
  return {
    command: terminal.command,
    label: terminal.label,
    lastOutputPreview: terminal.lastOutputPreview,
    log: [],
    startedAt: terminal.startedAt,
    status: terminal.status,
    terminalId: terminal.terminalId,
    updatedAt: "",
    workingDirectory: "",
  };
}

function mergeCommandTerminalSummary(
  current: CommandTerminalSummary | undefined,
  next: CommandTerminalSummary,
): CommandTerminalSummary {
  const nextIsNewer = isoTimestamp(next.updatedAt) >= isoTimestamp(current?.updatedAt);

  return {
    command: next.command || current?.command || "",
    label: next.label || current?.label || next.command || "Terminal",
    lastOutputPreview: next.lastOutputPreview || current?.lastOutputPreview || "",
    log: next.log.length > 0 ? next.log : current?.log ?? [],
    startedAt: next.startedAt || current?.startedAt || new Date().toISOString(),
    status: nextIsNewer ? next.status : current?.status ?? next.status,
    terminalId: next.terminalId,
    updatedAt: latestIso(current?.updatedAt, next.updatedAt),
    workingDirectory: next.workingDirectory || current?.workingDirectory || "",
  };
}

function compareCommandTerminals(
  first: CommandTerminalSummary,
  second: CommandTerminalSummary,
): number {
  const statusDelta = terminalStatusRank(first.status) - terminalStatusRank(second.status);

  if (statusDelta !== 0) {
    return statusDelta;
  }

  return isoTimestamp(second.updatedAt) - isoTimestamp(first.updatedAt);
}

function terminalStatusRank(status: CommandTerminalSummary["status"] | undefined): number {
  if (status === "running") {
    return 0;
  }

  if (status === "idle") {
    return 1;
  }

  if (status === "timed_out") {
    return 2;
  }

  return 3;
}

function latestIso(left: string | undefined, right: string | undefined): string {
  if (!left) {
    return right ?? new Date().toISOString();
  }

  if (!right) {
    return left;
  }

  return isoTimestamp(right) >= isoTimestamp(left) ? right : left;
}

function isoTimestamp(value: string | undefined): number {
  const timestamp = value ? new Date(value).getTime() : 0;

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function composerModeToSessionType(mode: ComposerMode): "conversation" | "agentic" {
  return mode === "agent" ? "agentic" : "conversation";
}

function mergeSubAgentReference(
  current: SubAgentPanelSession | undefined,
  subAgent: ChatSubAgentReference,
): SubAgentPanelSession {
  return {
    completedAt: subAgent.completedAt ?? current?.completedAt,
    elapsedMs: subAgent.elapsedMs ?? current?.elapsedMs,
    messages: current?.messages ?? [],
    modelId: subAgent.modelId ?? current?.modelId,
    parentSessionId: subAgent.parentSessionId,
    startedAt: subAgent.startedAt ?? current?.startedAt,
    status: subAgent.status,
    subSessionId: subAgent.subSessionId,
    task: subAgent.task,
    toolTurnCount: subAgent.toolTurnCount ?? current?.toolTurnCount,
  };
}

function updateSubAgentSpawned(
  current: SubAgentMap,
  event: Extract<ChatStreamEvent, { type: "sub_agent.spawned" }> | SubAgentSpawnedEvent,
): SubAgentMap {
  const existing = current[event.subSessionId];
  const next: SubAgentPanelSession = {
    completedAt: existing?.completedAt,
    elapsedMs: existing?.elapsedMs,
    messages: existing?.messages ?? [],
    modelId: event.modelId,
    parentSessionId: event.parentSessionId,
    startedAt: event.startedAt,
    status: "running",
    subSessionId: event.subSessionId,
    task: event.task,
    toolTurnCount: existing?.toolTurnCount,
  };

  return {
    ...current,
    [event.subSessionId]: event.message
      ? upsertSubAgentMessage(next, event.message, event.modelId)
      : next,
  };
}

function updateSubAgentStatus(
  current: SubAgentMap,
  event: Extract<ChatStreamEvent, { type: "sub_agent.status" }> | SubAgentStatusEvent,
): SubAgentMap {
  const existing = current[event.subSessionId] ?? emptySubAgentSession(event.subSessionId);

  return {
    ...current,
    [event.subSessionId]: {
      ...existing,
      completedAt: event.completedAt ?? existing.completedAt,
      elapsedMs: event.elapsedMs ?? existing.elapsedMs,
      status: event.status,
      toolTurnCount: event.toolTurnCount ?? existing.toolTurnCount,
    },
  };
}

function applySubAgentStatusToMessages(
  current: ChatUiMessage[],
  event: Extract<ChatStreamEvent, { type: "sub_agent.status" }> | SubAgentStatusEvent,
): ChatUiMessage[] {
  return current.map((message) => {
    if (!message.thinking?.toolCalls?.length) {
      return message;
    }

    let changed = false;
    const toolCalls = message.thinking.toolCalls.map((toolCall) => {
      if (toolCall.subAgent?.subSessionId !== event.subSessionId) {
        return toolCall;
      }

      changed = true;
      const subAgent: ChatSubAgentReference = {
        ...toolCall.subAgent,
        completedAt: event.completedAt ?? toolCall.subAgent.completedAt,
        elapsedMs: event.elapsedMs ?? toolCall.subAgent.elapsedMs,
        status: event.status,
        toolTurnCount: event.toolTurnCount ?? toolCall.subAgent.toolTurnCount,
      };
      const status: ChatToolCall["status"] =
        event.status === "running"
          ? "running"
          : event.status === "error"
            ? "error"
            : "completed";

      return {
        ...toolCall,
        completedAt: event.completedAt ?? toolCall.completedAt,
        status,
        subAgent,
      };
    });

    return changed
      ? {
          ...message,
          thinking: {
            ...message.thinking,
            toolCalls,
          },
        }
      : message;
  });
}

function updateSubAgentDelta(
  current: SubAgentMap,
  event: Extract<ChatStreamEvent, { type: "sub_agent.delta" }>,
): SubAgentMap {
  const existing = current[event.subSessionId] ?? emptySubAgentSession(event.subSessionId);
  const messages = upsertLiveSubAgentAssistant(existing.messages, event.subSessionId, event.modelId, {
    contentDelta: event.delta,
  });

  return {
    ...current,
    [event.subSessionId]: {
      ...existing,
      messages,
      modelId: event.modelId,
    },
  };
}

function updateSubAgentThinking(
  current: SubAgentMap,
  event: Extract<ChatStreamEvent, { type: "sub_agent.thinking_delta" }>,
): SubAgentMap {
  const existing = current[event.subSessionId] ?? emptySubAgentSession(event.subSessionId);
  const messages = upsertLiveSubAgentAssistant(existing.messages, event.subSessionId, existing.modelId, {
    thinkingDelta: event.delta,
    thinkingDurationMs: event.durationMs,
    thinkingWordCount: event.wordCount,
  });

  return {
    ...current,
    [event.subSessionId]: {
      ...existing,
      messages,
    },
  };
}

function updateSubAgentToolCall(
  current: SubAgentMap,
  event: Extract<ChatStreamEvent, { type: "sub_agent.tool_call" }>,
): SubAgentMap {
  const existing = current[event.subSessionId] ?? emptySubAgentSession(event.subSessionId);
  const messages = upsertLiveSubAgentAssistant(existing.messages, event.subSessionId, existing.modelId, {
    toolCall: event.call,
  });

  return {
    ...current,
    [event.subSessionId]: {
      ...existing,
      messages,
    },
  };
}

function updateSubAgentMessage(
  current: SubAgentMap,
  event: Extract<ChatStreamEvent, { type: "sub_agent.message" }>,
): SubAgentMap {
  const existing = current[event.subSessionId] ?? emptySubAgentSession(event.subSessionId);

  return {
    ...current,
    [event.subSessionId]: upsertSubAgentMessage(existing, event.message, event.modelId),
  };
}

function upsertSubAgentMessage(
  session: SubAgentPanelSession,
  message: StoredChatMessage | undefined,
  modelId: string,
): SubAgentPanelSession {
  if (!message) {
    return session;
  }

  const uiMessage = storedMessageToUiMessage(message, modelId);
  const messages =
    uiMessage.role === "assistant"
      ? session.messages.filter((item) => item.id !== liveSubAgentAssistantId(session.subSessionId))
      : session.messages;
  const existingIndex = messages.findIndex((item) => item.id === uiMessage.id);
  const nextMessages =
    existingIndex >= 0
      ? messages.map((item) => (item.id === uiMessage.id ? uiMessage : item))
      : [...messages, uiMessage];

  return {
    ...session,
    messages: nextMessages,
    modelId,
  };
}

function upsertLiveSubAgentAssistant(
  messages: ChatUiMessage[],
  subSessionId: string,
  modelId: string | undefined,
  update: {
    contentDelta?: string;
    thinkingDelta?: string;
    thinkingDurationMs?: number;
    thinkingWordCount?: number;
    toolCall?: ChatToolCall;
  },
): ChatUiMessage[] {
  const liveId = liveSubAgentAssistantId(subSessionId);
  const existing = messages.find((message) => message.id === liveId);
  const base: ChatUiMessage =
    existing ?? {
      content: "",
      createdAt: new Date().toISOString(),
      id: liveId,
      modelId,
      persisted: false,
      role: "assistant",
      status: "thinking",
    };
  const nextThinking = update.toolCall
    ? upsertToolCallThinking(base.thinking, update.toolCall)
    : update.thinkingDelta !== undefined
      ? {
          content: `${base.thinking?.content ?? ""}${update.thinkingDelta}`,
          durationMs: update.thinkingDurationMs ?? base.thinking?.durationMs ?? 0,
          toolCalls: base.thinking?.toolCalls,
          wordCount: update.thinkingWordCount ?? base.thinking?.wordCount ?? 0,
        }
      : base.thinking;
  const next: ChatUiMessage = {
    ...base,
    content: `${base.content}${update.contentDelta ?? ""}`,
    modelId: modelId ?? base.modelId,
    status: "thinking",
    thinking: nextThinking,
  };

  return existing
    ? messages.map((message) => (message.id === liveId ? next : message))
    : [...messages, next];
}

function liveSubAgentAssistantId(subSessionId: string): string {
  return `${subSessionId}:assistant-live`;
}

function emptySubAgentSession(subSessionId: string): SubAgentPanelSession {
  return {
    messages: [],
    status: "running",
    subSessionId,
    task: "Sub-agent",
  };
}

function parseChatRoute(location: Location): ChatRouteState {
  const match = location.pathname.match(/^\/chat\/([^/]+)$/);
  const params = new URLSearchParams(location.search);
  const context = params.get("context");

  return {
    context: context === "global" || context === "workspace" ? context : null,
    messageId: messageIdFromLocation(location),
    sessionId: match?.[1] ? safeDecodeURIComponent(match[1]) : null,
    workspacePath: params.get("workspace")?.trim() || null,
  };
}

function currentRouteMessageId(): string | null {
  return messageIdFromLocation(window.location);
}

function messageIdFromLocation(location: Location): string | null {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;

  if (hash.startsWith("message=")) {
    return safeDecodeURIComponent(hash.slice("message=".length));
  }

  const queryMessageId = new URLSearchParams(location.search).get("messageId");

  return queryMessageId?.trim() ? queryMessageId : null;
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function writeChatHomeRoute(): void {
  const nextRoute = "/";
  const currentRoute = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (currentRoute === nextRoute) {
    return;
  }

  window.history.pushState(null, "", nextRoute);
}

function writeChatRoute({
  messageId,
  mode = "push",
  scope,
  sessionId,
}: {
  messageId: string | null;
  mode?: "push" | "replace";
  scope: ConversationScopeSummary | null;
  sessionId: string;
}): void {
  const nextRoute = chatRouteForSession({ messageId, scope, sessionId });
  const currentRoute = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (nextRoute === currentRoute) {
    return;
  }

  if (mode === "replace") {
    window.history.replaceState(null, "", nextRoute);
  } else {
    window.history.pushState(null, "", nextRoute);
  }
}

function chatRouteForSession({
  messageId,
  scope,
  sessionId,
}: {
  messageId: string | null;
  scope: ConversationScopeSummary | null;
  sessionId: string;
}): string {
  const params = new URLSearchParams();

  if (scope?.mode === "workspace") {
    params.set("context", "workspace");
    params.set("workspace", scope.workspacePath);
  } else {
    params.set("context", "global");
  }

  return [
    `/chat/${encodeURIComponent(sessionId)}?${params.toString()}`,
    messageId ? `#message=${encodeURIComponent(messageId)}` : "",
  ].join("");
}

function readDismissedWorkspaceOriginBanners(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(dismissedWorkspaceOriginBannerKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;

    if (!Array.isArray(parsed)) {
      return new Set();
    }

    return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return new Set();
  }
}

function writeDismissedWorkspaceOriginBanners(sessionIds: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(
      dismissedWorkspaceOriginBannerKey,
      JSON.stringify([...sessionIds]),
    );
  } catch {
    // Dismissal is a local convenience; storage failures should not affect chat.
  }
}

function shouldShowWorkspaceOriginBanner({
  currentScope,
  dismissedSessionIds,
  session,
}: {
  currentScope: ConversationScopeSummary | null;
  dismissedSessionIds: ReadonlySet<string>;
  session: AgentSessionSummary;
}): boolean {
  return Boolean(
    session.workspacePath &&
      !dismissedSessionIds.has(session.id) &&
      (currentScope?.mode !== "workspace" ||
        !samePath(session.workspacePath, currentScope.workspacePath)),
  );
}

function trackWorkspaceOriginBannerEvent(
  action: "click" | "impression",
  session: AgentSessionSummary,
): void {
  window.dispatchEvent(
    new CustomEvent("truss:telemetry", {
      detail: {
        event: `workspace_origin_banner.${action}`,
        sessionId: session.id,
        workspacePath: session.workspacePath,
      },
    }),
  );
}

function samePath(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  return left.replace(/\\/g, "/").toLowerCase() === right.replace(/\\/g, "/").toLowerCase();
}

function mergeFileAccessDirectoryUpdates(
  currentDirectories: FileAccessDirectorySummary[],
  nextDirectory: FileAccessDirectoryUpdate,
): FileAccessDirectoryUpdate[] {
  const directories = currentDirectories.map((directory) => ({
    path: directory.path,
    readOnly: directory.readOnly,
  }));
  const normalizedNextDirectory = {
    path: nextDirectory.path,
    readOnly: nextDirectory.readOnly === true,
  };
  const existingIndex = directories.findIndex((directory) =>
    samePath(directory.path, nextDirectory.path),
  );

  if (existingIndex >= 0) {
    directories[existingIndex] = normalizedNextDirectory;
  } else {
    directories.push(normalizedNextDirectory);
  }

  return directories;
}

function defaultComposerModeForScope(scope: ConversationScopeSummary | null): ComposerMode {
  return scope?.mode === "workspace" ? "agent" : "conversation";
}

function defaultModelSelectionForComposerMode(
  session: SessionInfo | null,
  mode: ComposerMode,
): SelectedModel | null {
  const profileId = mode === "agent" ? "agentic" : "conversation";
  const profile = session?.modelProfiles.find((item) => item.id === profileId);

  return profile
    ? {
        modelId: profile.modelId,
        providerId: profile.providerId,
      }
    : null;
}

function upsertToolCallThinking(
  thinking: ChatThinking | null | undefined,
  call: ChatToolCall,
): ChatThinking {
  const currentCalls = thinking?.toolCalls ?? [];
  const existingIndex = currentCalls.findIndex((item) => item.id === call.id);
  const toolCalls =
    existingIndex >= 0
      ? currentCalls.map((item) => (item.id === call.id ? mergeChatToolCall(item, call) : item))
      : [...currentCalls, call];

  return {
    content: thinking?.content ?? "",
    durationMs: thinking?.durationMs ?? 0,
    toolCalls,
    wordCount: thinking?.wordCount ?? 0,
  };
}

function appendAssistantContent(current: string, next: string): string {
  const currentText = current.trim();
  const nextText = next.trim();

  if (!currentText) {
    return next;
  }

  if (!nextText || currentText === nextText || currentText.startsWith(nextText)) {
    return current;
  }

  if (nextText.startsWith(currentText)) {
    return next;
  }

  return `${current}\n\n${next}`;
}

function mergeAssistantThinking(
  current: ChatThinking | null | undefined,
  incoming: ChatThinking | null | undefined,
): ChatThinking | null {
  if (!current && !incoming) {
    return null;
  }

  if (!current) {
    return incoming ?? null;
  }

  if (!incoming) {
    return current;
  }

  const content = appendThinkingTextBlock(current.content, incoming.content) ?? "";
  const toolCalls = mergeChatToolCalls(current.toolCalls, incoming.toolCalls);
  const encryptedContent = incoming.encryptedContent ?? current.encryptedContent;

  if (!content && toolCalls.length === 0 && !encryptedContent) {
    return null;
  }

  return {
    content,
    durationMs: Math.max(current.durationMs, incoming.durationMs),
    ...(encryptedContent ? { encryptedContent } : {}),
    ...(toolCalls.length ? { toolCalls } : {}),
    wordCount: wordCount(content),
  };
}

function failRunningToolCalls(
  thinking: ChatThinking | null | undefined,
  error: string,
): ChatThinking | null | undefined {
  if (!thinking?.toolCalls?.some((toolCall) => toolCall.status === "running")) {
    return thinking;
  }

  const completedAt = new Date().toISOString();

  return {
    ...thinking,
    toolCalls: thinking.toolCalls.map((toolCall) =>
      toolCall.status === "running"
        ? {
            ...toolCall,
            completedAt,
            error,
            status: "error",
          }
        : toolCall,
    ),
  };
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function ToastNotification({ toast }: { toast: ToastState | null }) {
  if (!toast) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className="truss-toast fixed bottom-6 right-6 z-170 max-w-sm rounded-sm border border-outline-variant bg-surface px-4 py-3 text-sm font-medium text-on-surface shadow-[0_18px_44px_rgb(27_28_25/0.18)]"
      key={toast.id}
      role="status"
    >
      {toast.message}
    </div>
  );
}

function UserChoiceDialog({
  onResolve,
  request,
  queueLength,
}: {
  onResolve(
    request: ChatUserChoiceRequest,
    payload: ChatUserChoiceResolutionRequest,
  ): Promise<void>;
  request: ChatUserChoiceRequest | null;
  queueLength: number;
}) {
  const [selection, setSelection] = useState<"custom" | string | null>(null);
  const [customResponse, setCustomResponse] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [resolvingOptionId, setResolvingOptionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelection(null);
    setCustomResponse("");
    setIsResolving(false);
    setResolvingOptionId(null);
    setError(null);
  }, [request?.id]);

  if (!request) {
    return null;
  }

  const activeRequest = request;
  const directoryAccess =
    activeRequest.kind === "directory_access" ? activeRequest.directoryAccess ?? null : null;
  const commandApproval =
    activeRequest.kind === "command_approval" ? activeRequest.commandApproval ?? null : null;
  const commandWhitelist =
    activeRequest.kind === "command_whitelist" ? activeRequest.commandWhitelist ?? null : null;
  const directoryAccessAllowOption = directoryAccess
    ? (activeRequest.options.find((option) => option.value === "allow") ?? null)
    : null;
  const directoryAccessDenyOption = directoryAccess
    ? (activeRequest.options.find((option) => option.value === "deny") ?? null)
    : null;
  const commandApprovalAllowOption = commandApproval
    ? (activeRequest.options.find((option) => option.value === "allow") ?? null)
    : null;
  const commandApprovalDenyOption = commandApproval
    ? (activeRequest.options.find((option) => option.value === "deny") ?? null)
    : null;
  const commandApprovalIsDangerous = commandApproval?.safetyLevel === "dangerous";
  const customText = customResponse.trim();
  const directoryAccessLabel = directoryAccess?.readOnly ? "read-only" : "read/write";
  const canSubmit =
    !directoryAccess &&
    !commandApproval &&
    !commandWhitelist &&
    !isResolving &&
    (Boolean(selection && selection !== "custom") ||
      Boolean(selection === "custom" && customText));
  const submitLabel = isResolving ? "Sending..." : "Submit";

  async function resolve(payload: ChatUserChoiceResolutionRequest): Promise<void> {
    if (isResolving) {
      return;
    }

    setIsResolving(true);
    setResolvingOptionId(typeof payload.optionId === "string" ? payload.optionId : null);
    setError(null);

    try {
      await onResolve(activeRequest, payload);
    } catch (caught) {
      setError(errorMessage(caught));
      setIsResolving(false);
      setResolvingOptionId(null);
    }
  }

  function submit(): void {
    if (!canSubmit) {
      return;
    }

    void resolve(
      selection === "custom" ? { customResponse: customText } : { optionId: selection ?? "" },
    );
  }

  return (
    <Modal
      closeLabel="Cancel choice"
      description={
        directoryAccess
          ? "Review this local file-access request before changing Security."
          : commandApproval
            ? "Review this command before Command Runner executes it."
          : commandWhitelist
            ? "Review this Command Runner whitelist request before changing Security."
          : undefined
      }
      footer={
        directoryAccess ? (
          <>
            {directoryAccessDenyOption ? (
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-outline-variant bg-surface px-4 text-sm font-semibold text-on-surface-variant transition hover:border-outline hover:bg-surface-container-low hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-45"
                data-autofocus="true"
                disabled={isResolving}
                onClick={() => void resolve({ optionId: directoryAccessDenyOption.id })}
                type="button"
              >
                <MaterialIcon name="block" size={18} />
                {resolvingOptionId === directoryAccessDenyOption.id ? "Denying..." : "Deny"}
              </button>
            ) : null}
            {directoryAccessAllowOption ? (
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-[#b45309] bg-[#b45309] px-4 text-sm font-semibold text-white shadow-[0_8px_18px_rgb(180_83_9/0.2)] transition hover:border-[#92400e] hover:bg-[#92400e] disabled:cursor-not-allowed disabled:opacity-45"
                disabled={isResolving}
                onClick={() => void resolve({ optionId: directoryAccessAllowOption.id })}
                type="button"
              >
                <MaterialIcon name="warning" size={18} />
                {resolvingOptionId === directoryAccessAllowOption.id
                  ? "Applying..."
                  : directoryAccess?.readOnly
                    ? "Allow read-only"
                    : "Allow directory"}
              </button>
            ) : null}
          </>
        ) : commandApproval ? (
          <>
            {commandApprovalDenyOption ? (
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-outline-variant bg-surface px-4 text-sm font-semibold text-on-surface-variant transition hover:border-outline hover:bg-surface-container-low hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-45"
                data-autofocus="true"
                disabled={isResolving}
                onClick={() => void resolve({ optionId: commandApprovalDenyOption.id })}
                type="button"
              >
                <MaterialIcon name="block" size={18} />
                {resolvingOptionId === commandApprovalDenyOption.id ? "Denying..." : "Deny"}
              </button>
            ) : null}
            {commandApprovalAllowOption ? (
              <button
                className={[
                  "inline-flex h-10 items-center justify-center gap-2 rounded-sm border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45",
                  commandApprovalIsDangerous
                    ? "border-[#b45309] bg-[#b45309] text-white shadow-[0_8px_18px_rgb(180_83_9/0.2)] hover:border-[#92400e] hover:bg-[#92400e]"
                    : "border-primary bg-primary text-on-primary hover:bg-primary-container",
                ].join(" ")}
                disabled={isResolving}
                onClick={() => void resolve({ optionId: commandApprovalAllowOption.id })}
                type="button"
              >
                <MaterialIcon name={commandApprovalIsDangerous ? "warning" : "check"} size={18} />
                {resolvingOptionId === commandApprovalAllowOption.id
                  ? "Allowing..."
                  : commandApprovalAllowOption.label}
              </button>
            ) : null}
          </>
        ) : commandWhitelist ? (
          <div className="flex flex-wrap justify-end gap-2">
            {activeRequest.options.map((option) => {
              const denying = option.value === "deny";

              return (
                <button
                  className={[
                    "inline-flex h-10 items-center justify-center gap-2 rounded-sm border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45",
                    denying
                      ? "border-outline-variant bg-surface text-on-surface-variant hover:border-outline hover:bg-surface-container-low hover:text-on-surface"
                      : "border-primary bg-primary text-on-primary hover:bg-primary-container",
                  ].join(" ")}
                  data-autofocus={denying ? "true" : undefined}
                  disabled={isResolving}
                  key={option.id}
                  onClick={() => void resolve({ optionId: option.id })}
                  type="button"
                >
                  <MaterialIcon name={denying ? "block" : "check"} size={18} />
                  {resolvingOptionId === option.id ? "Applying..." : option.label}
                </button>
              );
            })}
          </div>
        ) : (
          <>
            <button
              className="h-10 rounded-sm border border-outline-variant px-4 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-45"
              disabled={isResolving}
              onClick={() => void resolve({ cancelled: true })}
              type="button"
            >
              Cancel
            </button>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-primary bg-primary px-4 text-sm font-semibold text-on-primary transition hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!canSubmit}
              onClick={submit}
              type="button"
            >
              <MaterialIcon name="check" size={18} />
              {submitLabel}
            </button>
          </>
        )
      }
      icon={
        directoryAccess || commandApprovalIsDangerous
          ? "warning"
          : commandApproval || commandWhitelist
            ? "terminal"
            : request.icon
      }
      onClose={isResolving ? () => undefined : () => void resolve({ cancelled: true })}
      open
      role={directoryAccess || commandApproval || commandWhitelist ? "alertdialog" : "dialog"}
      size="md"
      title={queueLength > 1 ? `${request.title} (1 of ${queueLength})` : request.title}
      className={directoryAccess || commandApprovalIsDangerous ? "truss-danger-choice-modal" : ""}
    >
      <div className="grid gap-4">
        {directoryAccess ? (
          <>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-sm border border-[#f59e0b]/45 bg-[#fffbeb] px-3 py-3 text-sm shadow-[inset_0_0_0_1px_rgb(255_255_255/0.58)]">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-[#fef3c7] text-[#92400e]">
                <MaterialIcon name="warning" size={20} />
              </span>
              <div className="grid min-w-0 gap-1">
                <p className="font-semibold text-[#78350f]">Local file-access request</p>
                <p className="text-sm leading-5 text-[#6b3f12]">
                  Approving grants Truss Filesystem Tools {directoryAccessLabel} access to this directory for
                  the current context for 24 hours and reloads MCP servers immediately.
                </p>
              </div>
            </div>
            <DirectoryAccessRequestDetails request={directoryAccess} />
          </>
        ) : commandApproval ? (
          <>
            <div
              className={[
                "grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-sm border px-3 py-3 text-sm",
                commandApprovalIsDangerous
                  ? "border-[#f59e0b]/45 bg-[#fffbeb] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.58)]"
                  : "border-outline-variant bg-surface-container-lowest",
              ].join(" ")}
            >
              <span
                className={[
                  "grid h-9 w-9 shrink-0 place-items-center rounded-sm",
                  commandApprovalIsDangerous
                    ? "bg-[#fef3c7] text-[#92400e]"
                    : "bg-primary-container text-on-primary-container",
                ].join(" ")}
              >
                <MaterialIcon name={commandApprovalIsDangerous ? "warning" : "terminal"} size={20} />
              </span>
              <div className="grid min-w-0 gap-1">
                <p
                  className={[
                    "font-semibold",
                    commandApprovalIsDangerous ? "text-[#78350f]" : "text-on-surface",
                  ].join(" ")}
                >
                  Command approval request
                </p>
                <p
                  className={[
                    "text-sm leading-5",
                    commandApprovalIsDangerous
                      ? "text-[#6b3f12]"
                      : "text-on-surface-variant",
                  ].join(" ")}
                >
                  Command Runner rated this command as{" "}
                  <span className="font-semibold">{commandApproval.safetyLevel}</span>. Approving
                  runs it once.
                </p>
              </div>
            </div>
            <CommandApprovalRequestDetails request={commandApproval} />
          </>
        ) : commandWhitelist ? (
          <>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-3 text-sm">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-primary-container text-on-primary-container">
                <MaterialIcon name="terminal" size={20} />
              </span>
              <div className="grid min-w-0 gap-1">
                <p className="font-semibold text-on-surface">Command whitelist request</p>
                <p className="text-sm leading-5 text-on-surface-variant">
                  Approving adds this pattern to Command Runner Security and lets matching
                  commands bypass the ask flow until the selected expiry lapses.
                </p>
              </div>
            </div>
            <CommandWhitelistRequestDetails request={commandWhitelist} />
          </>
        ) : (
          <>
            <p className="whitespace-pre-line text-sm leading-6 text-on-surface-variant">
              {request.question}
            </p>
            <div
              aria-label={request.question}
              className="truss-follow-up-panel grid gap-2 rounded-sm border border-outline-variant/80 bg-surface-container-lowest px-2 py-2 shadow-[0_12px_28px_rgb(60_50_30/0.07),inset_0_0_0_1px_rgb(255_255_255/0.55)]"
              role="radiogroup"
            >
              {request.options.map((option, index) => {
                const selected = selection === option.id;

                return (
                  <button
                    aria-checked={selected}
                    className={[
                      "flex min-h-10 min-w-0 items-start gap-2 rounded-sm border px-2 py-2 text-left text-sm leading-5 transition focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45",
                      selected
                        ? "border-primary bg-surface-container-low text-on-surface"
                        : "border-transparent text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface focus-visible:bg-surface-container-low focus-visible:text-on-surface",
                    ].join(" ")}
                    data-autofocus={index === 0 ? "true" : undefined}
                    disabled={isResolving}
                    key={option.id}
                    onClick={() => setSelection(option.id)}
                    role="radio"
                    type="button"
                  >
                    <MaterialIcon
                      className="mt-0.5 shrink-0 text-primary"
                      name="subdirectory_arrow_right"
                      size={17}
                    />
                    <span className="grid min-w-0 gap-0.5">
                      <span className="min-w-0 break-words font-semibold [overflow-wrap:anywhere]">
                        {option.label}
                      </span>
                      {option.description ? (
                        <span className="min-w-0 text-xs leading-5 text-on-surface-variant">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}

              {request.allowCustomOption ? (
                <div
                  className={[
                    "grid min-w-0 gap-2 rounded-sm border px-2 py-2 transition",
                    selection === "custom"
                      ? "border-primary bg-surface-container-low"
                      : "border-transparent hover:bg-surface-container-low",
                  ].join(" ")}
                >
                  <button
                    aria-checked={selection === "custom"}
                    className="flex min-h-8 min-w-0 items-center gap-2 rounded-sm text-left text-sm leading-5 text-on-surface-variant transition hover:text-on-surface focus-visible:text-on-surface focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={isResolving}
                    onClick={() => setSelection("custom")}
                    role="radio"
                    type="button"
                  >
                    <MaterialIcon className="shrink-0 text-primary" name="edit" size={17} />
                    <span className="min-w-0 font-semibold">{request.customOptionLabel}</span>
                  </button>
                  <input
                    className="h-10 min-w-0 rounded-sm border border-outline-variant bg-surface px-3 text-sm text-on-surface outline-none transition placeholder:text-on-surface-variant/55 focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isResolving}
                    maxLength={2000}
                    onChange={(event) => {
                      setCustomResponse(event.target.value);
                      setSelection("custom");
                    }}
                    onFocus={() => setSelection("custom")}
                    placeholder={request.customOptionPlaceholder}
                    value={customResponse}
                  />
                </div>
              ) : null}
            </div>
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

function CommandApprovalRequestDetails({
  request,
}: {
  request: NonNullable<ChatUserChoiceRequest["commandApproval"]>;
}) {
  const isDangerous = request.safetyLevel === "dangerous";
  const iconClass = isDangerous ? "text-[#b45309]" : "text-primary";

  return (
    <div
      className={[
        "grid gap-3 rounded-sm border bg-surface-container-lowest px-3 py-3 text-sm",
        isDangerous ? "border-[#f59e0b]/35" : "border-outline-variant",
      ].join(" ")}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
        <MaterialIcon className={iconClass} name="terminal" size={18} />
        <div className="grid min-w-0 gap-1">
          <span className="text-xs font-semibold uppercase text-on-surface-variant">
            Command
          </span>
          <pre className="max-h-40 min-w-0 overflow-auto whitespace-pre-wrap rounded-sm border border-outline-variant/80 bg-surface px-3 py-2 font-mono text-xs leading-5 text-on-surface [overflow-wrap:anywhere]"><code>{request.command}</code></pre>
        </div>
      </div>
      {request.summary ? (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
          <MaterialIcon className={iconClass} name="summarize" size={18} />
          <div className="grid min-w-0 gap-1">
            <span className="text-xs font-semibold uppercase text-on-surface-variant">
              Summary
            </span>
            <span className="text-sm leading-5 text-on-surface-variant">
              {request.summary}
            </span>
          </div>
        </div>
      ) : null}
      {request.safetyReasoning ? (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
          <MaterialIcon className={iconClass} name="policy" size={18} />
          <div className="grid min-w-0 gap-1">
            <span className="font-semibold text-on-surface">
              Security assessment reasoning
            </span>
            <span className="text-sm leading-5 text-on-surface-variant">
              {request.safetyReasoning}
            </span>
          </div>
        </div>
      ) : null}
      {request.accessesOutsideWhitelist ? (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
          <MaterialIcon className={iconClass} name="warning" size={18} />
          <div className="grid min-w-0 gap-1">
            <span className="text-xs font-semibold uppercase text-on-surface-variant">
              Boundary
            </span>
            <span className="text-sm leading-5 text-on-surface-variant">
              The assessment flagged possible access outside the whitelisted directories.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DirectoryAccessRequestDetails({
  request,
}: {
  request: NonNullable<ChatUserChoiceRequest["directoryAccess"]>;
}) {
  return (
    <div className="grid gap-3 rounded-sm border border-[#f59e0b]/35 bg-surface-container-lowest px-3 py-3 text-sm">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
        <MaterialIcon className="text-[#b45309]" name="folder" size={18} />
        <div className="grid min-w-0 gap-1">
          <span className="text-xs font-semibold uppercase text-on-surface-variant">
            Requested directory
          </span>
          <span className="min-w-0 break-words font-mono text-xs text-on-surface [overflow-wrap:anywhere]">
            {request.directoryPath}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
        <MaterialIcon
          className="text-[#b45309]"
          name={request.readOnly ? "visibility" : "edit"}
          size={18}
        />
        <div className="grid min-w-0 gap-1">
          <span className="text-xs font-semibold uppercase text-on-surface-variant">
            Requested access
          </span>
          <span className="text-sm leading-5 text-on-surface-variant">
            {request.readOnly ? "Read-only" : "Read/write"}
          </span>
        </div>
      </div>
      {request.reason ? (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
          <MaterialIcon className="text-[#b45309]" name="notes" size={18} />
          <div className="grid min-w-0 gap-1">
            <span className="text-xs font-semibold uppercase text-on-surface-variant">
              Reason
            </span>
            <span className="text-sm leading-5 text-on-surface-variant">{request.reason}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CommandWhitelistRequestDetails({
  request,
}: {
  request: NonNullable<ChatUserChoiceRequest["commandWhitelist"]>;
}) {
  return (
    <div className="grid gap-3 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-3 text-sm">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
        <MaterialIcon className="text-primary" name="rule" size={18} />
        <div className="grid min-w-0 gap-1">
          <span className="text-xs font-semibold uppercase text-on-surface-variant">
            Pattern
          </span>
          <span className="min-w-0 break-words font-mono text-xs text-on-surface [overflow-wrap:anywhere]">
            {request.pattern}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
        <MaterialIcon className="text-primary" name="category" size={18} />
        <div className="grid min-w-0 gap-1">
          <span className="text-xs font-semibold uppercase text-on-surface-variant">
            Pattern type
          </span>
          <span className="text-sm leading-5 text-on-surface-variant">{request.type}</span>
        </div>
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
        <MaterialIcon className="text-primary" name="notes" size={18} />
        <div className="grid min-w-0 gap-1">
          <span className="text-xs font-semibold uppercase text-on-surface-variant">
            Reason
          </span>
          <span className="text-sm leading-5 text-on-surface-variant">{request.reason}</span>
        </div>
      </div>
    </div>
  );
}

function EditedMessageRegenerationDialog({
  disabled,
  onClose,
  onDuplicate,
  onOverwrite,
  prompt,
}: {
  disabled: boolean;
  onClose(): void;
  onDuplicate(prompt: EditedMessageRegenerationPrompt): Promise<void>;
  onOverwrite(prompt: EditedMessageRegenerationPrompt): Promise<void>;
  prompt: EditedMessageRegenerationPrompt | null;
}) {
  const [busyAction, setBusyAction] = useState<"duplicate" | "overwrite" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBusyAction(null);
    setError(null);
  }, [prompt]);

  if (!prompt) {
    return null;
  }

  const activePrompt = prompt;
  const targetLabel =
    activePrompt.role === "assistant" ? "this assistant message" : "the next assistant message";
  const actionDisabled = disabled || Boolean(busyAction);

  async function choose(action: "duplicate" | "overwrite"): Promise<void> {
    if (disabled || busyAction) {
      return;
    }

    setBusyAction(action);
    setError(null);

    try {
      if (action === "overwrite") {
        await onOverwrite(activePrompt);
      } else {
        await onDuplicate(activePrompt);
      }
    } catch (caught) {
      setError(errorMessage(caught));
      setBusyAction(null);
    }
  }

  return (
    <Modal
      closeLabel="Close regeneration prompt"
      description="Choose how Truss handles messages after the edited one."
      footer={
        <>
          <button
            className="h-10 rounded-sm border border-outline-variant px-4 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-45"
            data-autofocus="true"
            disabled={actionDisabled}
            onClick={onClose}
            type="button"
          >
            Do Not Regenerate
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-outline-variant bg-surface px-4 text-sm font-semibold text-on-surface transition hover:border-outline hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-45"
            disabled={actionDisabled}
            onClick={() => void choose("duplicate")}
            type="button"
          >
            <MaterialIcon name="control_point_duplicate" size={18} />
            {busyAction === "duplicate" ? "Duplicating..." : "Duplicate Session"}
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-primary bg-primary px-4 text-sm font-semibold text-on-primary transition hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-45"
            disabled={actionDisabled}
            onClick={() => void choose("overwrite")}
            type="button"
          >
            <MaterialIcon name="refresh" size={18} />
            {busyAction === "overwrite" ? "Regenerating..." : "Overwrite Current"}
          </button>
        </>
      }
      icon="refresh"
      onClose={actionDisabled ? () => undefined : onClose}
      open
      size="lg"
      title="Regenerate after edit?"
    >
      <div className="grid gap-3">
        <p className="text-sm leading-6 text-on-surface-variant">
          The conversation has messages after the edited one. Choose whether to regenerate{" "}
          {targetLabel} now.
        </p>
        {error ? (
          <p className="rounded-sm border border-error-container bg-error-container/25 px-3 py-2 text-sm text-error">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
