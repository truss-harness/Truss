import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import type {
  CommandTerminalStatus,
  CommandTerminalSummary,
  OrchestrationTimerSummary,
} from "../../../shared/protocol.ts";
import { MaterialIcon } from "../MaterialIcon.tsx";
import { formatFileSize } from "./chat-utils.ts";
import type { ActivitySharedFile } from "./activity-shared-files.ts";
import type {
  ActivityPlanItemStatus,
  ActivityPlanSubtask,
  ActivityPlanStatus,
  ActivityPlanTodo,
} from "./plan-tool-state.ts";
import type { SubAgentPanelSession } from "./SubAgentPanel.tsx";

export interface ActiveTimerStatus extends OrchestrationTimerSummary {
  sessionId: string;
}

export function ActivityStatusPane({
  onCancelTimer,
  onExtendTimer,
  onFireTimer,
  onKillTerminal,
  onOpenTerminal,
  onOpenSubAgent,
  plan,
  sharedFiles,
  subAgents,
  terminals,
  timers,
}: {
  onCancelTimer(timer: ActiveTimerStatus): Promise<void>;
  onExtendTimer(timer: ActiveTimerStatus): Promise<void>;
  onFireTimer(timer: ActiveTimerStatus): Promise<void>;
  onKillTerminal(terminal: CommandTerminalSummary): Promise<void>;
  onOpenTerminal(terminalId: string): void;
  onOpenSubAgent(subSessionId: string): void;
  plan: ActivityPlanStatus | null;
  sharedFiles: ActivitySharedFile[];
  subAgents: SubAgentPanelSession[];
  terminals: CommandTerminalSummary[];
  timers: ActiveTimerStatus[];
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const planTodos = plan?.todos ?? [];
  const hasActivity =
    timers.length > 0 ||
    terminals.length > 0 ||
    subAgents.length > 0 ||
    planTodos.length > 0 ||
    sharedFiles.length > 0;
  const activityIdentityKey = activityIdentity(
    timers,
    planTodos,
    terminals,
    subAgents,
    sharedFiles,
  );
  const [dismissedActivityKey, setDismissedActivityKey] = useState<string | null>(null);
  const active = hasActivity && dismissedActivityKey !== activityIdentityKey;
  const hiddenWithActivity = hasActivity && dismissedActivityKey === activityIdentityKey;
  const [rendered, setRendered] = useState(active);
  const [visible, setVisible] = useState(active);

  useEffect(() => {
    setDismissedActivityKey(null);
  }, [activityIdentityKey]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);

    return () => window.clearInterval(intervalId);
  }, [active]);

  useEffect(() => {
    if (active) {
      setRendered(true);
      const frameId = window.requestAnimationFrame(() => setVisible(true));

      return () => window.cancelAnimationFrame(frameId);
    }

    setVisible(false);
    const timeoutId = window.setTimeout(() => setRendered(false), 240);

    return () => window.clearTimeout(timeoutId);
  }, [active]);

  async function runTimerAction(
    action: "cancel" | "extend" | "fire",
    timer: ActiveTimerStatus,
    callback: (timer: ActiveTimerStatus) => Promise<void>,
  ): Promise<void> {
    const key = `${timer.timerId}:${action}`;

    setPendingAction(key);
    try {
      await callback(timer);
    } finally {
      setPendingAction((current) => (current === key ? null : current));
    }
  }

  async function runTerminalAction(
    action: "kill",
    terminal: CommandTerminalSummary,
    callback: (terminal: CommandTerminalSummary) => Promise<void>,
  ): Promise<void> {
    const key = `${terminal.terminalId}:${action}`;

    setPendingAction(key);
    try {
      await callback(terminal);
    } finally {
      setPendingAction((current) => (current === key ? null : current));
    }
  }

  function showActivityPane(): void {
    setDismissedActivityKey(null);
    setRendered(true);
    window.requestAnimationFrame(() => setVisible(true));
  }

  function hideActivityPane(): void {
    setVisible(false);
    setDismissedActivityKey(activityIdentityKey);
  }

  if (!rendered) {
    return hiddenWithActivity ? (
      <ActivityRestoreRail
        onShow={showActivityPane}
        summary={activitySummary(
          timers.length,
          planTodos.length,
          terminals.length,
          subAgents.length,
          sharedFiles.length,
        )}
      />
    ) : null;
  }

  return (
    <aside
      aria-label="Session activity"
      className={[
        "fixed bottom-24 border-l border-outline-variant right-3 z-50 flex max-h-[calc(100vh-9rem)] w-[calc(100vw-1.5rem)] max-w-[320px] shrink-0 flex-col gap-3 rounded-sm border bg-surface/92 px-3 py-3 text-on-surface shadow-[0_18px_46px_rgb(27_28_25/0.16)] backdrop-blur transition-[opacity,transform] duration-200 ease-out md:relative md:bottom-auto md:right-auto md:z-20 md:mt-[57px] md:h-[calc(100vh-57px)] md:max-h-[calc(100vh-57px)] md:w-[320px] md:max-w-none md:rounded-none md:border-y-0 md:border-l md:border-r-0 md:bg-surface md:shadow-none md:backdrop-blur-none",
        visible
          ? "translate-x-0 scale-100 opacity-100"
          : "pointer-events-none translate-x-8 scale-[0.985] opacity-0",
      ].join(" ")}
    >
      <div className="flex min-h-9 items-center gap-2 border-b border-outline-variant pb-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-on-surface">Activity</p>
          <p className="truncate text-xs text-on-surface-variant">
            {activitySummary(
              timers.length,
              planTodos.length,
              terminals.length,
              subAgents.length,
              sharedFiles.length,
            )}
          </p>
        </div>
        <button
          aria-label="Hide this bar"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-sm border border-outline-variant bg-surface text-on-surface-variant transition hover:border-outline hover:bg-surface-container-low hover:text-on-surface focus-visible:border-outline focus-visible:bg-surface-container-low focus-visible:text-on-surface focus-visible:outline-none"
          onClick={hideActivityPane}
          title="Hide this bar"
          type="button"
        >
          <MaterialIcon name="close" size={14} />
        </button>
      </div>
      <div className="truss-message-scrollbar flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden pb-2">
        {timers.length > 0 ? (
          <ActivitySection title="Timers">
            {timers.map((timer) => (
              <TimerStatusItem
                key={timer.timerId}
                nowMs={nowMs}
                onCancel={(item) =>
                  runTimerAction("cancel", item, onCancelTimer)
                }
                onExtend={(item) =>
                  runTimerAction("extend", item, onExtendTimer)
                }
                onFire={(item) =>
                  runTimerAction("fire", item, onFireTimer)
                }
                pendingAction={pendingAction}
                timer={timer}
              />
            ))}
          </ActivitySection>
        ) : null}
        {planTodos.length > 0 ? <PlanStatusSection plan={{ todos: planTodos }} /> : null}
        {terminals.length > 0 ? (
          <ActivitySection title="Terminals">
            {terminals.map((terminal) => (
              <TerminalStatusItem
                key={terminal.terminalId}
                onKill={(item) =>
                  runTerminalAction("kill", item, onKillTerminal)
                }
                onOpen={() => onOpenTerminal(terminal.terminalId)}
                pendingAction={pendingAction}
                terminal={terminal}
              />
            ))}
          </ActivitySection>
        ) : null}
        {subAgents.length > 0 ? (
          <ActivitySection title="Sub-agents">
            {subAgents.map((subAgent) => (
              <SubAgentStatusItem
                key={subAgent.subSessionId}
                onOpen={() => onOpenSubAgent(subAgent.subSessionId)}
                subAgent={subAgent}
              />
            ))}
          </ActivitySection>
        ) : null}
        {sharedFiles.length > 0 ? <SharedFilesSection files={sharedFiles} /> : null}
      </div>
    </aside>
  );
}

function ActivityRestoreRail({ onShow, summary }: { onShow(): void; summary: string }) {
  return (
    <aside
      aria-label="Collapsed session activity"
      className="fixed bottom-24 right-3 z-50 flex md:relative md:bottom-auto md:right-auto md:z-20 md:mt-[57px] md:h-[calc(100vh-57px)] md:w-12 md:items-start md:justify-center md:border-l md:border-outline-variant md:bg-surface md:pt-3"
    >
      <button
        aria-label={`Show session activity (${summary})`}
        className="grid h-6 w-6 place-items-center rounded-sm border border-outline-variant bg-surface text-on-surface-variant shadow-[0_12px_30px_rgb(27_28_25/0.14)] transition hover:border-outline hover:bg-surface-container-low hover:text-on-surface focus-visible:border-outline focus-visible:bg-surface-container-low focus-visible:text-on-surface focus-visible:outline-none"
        onClick={onShow}
        title={`Show activity: ${summary}`}
        type="button"
      >
        <MaterialIcon name="chevron_left" size={20} />
      </button>
    </aside>
  );
}

function ActivitySection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="grid min-w-0 gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-normal text-on-surface-variant">
        {title}
      </h3>
      <div className="grid min-w-0 gap-2">{children}</div>
    </section>
  );
}

function activitySummary(
  timerCount: number,
  todoCount: number,
  terminalCount: number,
  taskCount: number,
  fileCount: number,
): string {
  const parts = [
    itemCountLabel(timerCount, "timer"),
    itemCountLabel(todoCount, "todo"),
    itemCountLabel(terminalCount, "terminal"),
    itemCountLabel(taskCount, "task"),
    itemCountLabel(fileCount, "file"),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : "No active items";
}

function itemCountLabel(count: number, noun: string): string | null {
  return count > 0 ? `${count} ${noun}${count === 1 ? "" : "s"}` : null;
}

function activityIdentity(
  timers: ActiveTimerStatus[],
  todos: ActivityPlanTodo[],
  terminals: CommandTerminalSummary[],
  subAgents: SubAgentPanelSession[],
  sharedFiles: ActivitySharedFile[],
): string {
  const timerKeys = timers.map((timer) => timer.timerId).join(",");
  const todoKeys = todos
    .map((todo) => activityItemSnapshot(todo))
    .join(",");
  const terminalKeys = terminals
    .map((terminal) => `${terminal.terminalId}:${terminal.status}:${terminal.updatedAt}`)
    .join(",");
  const subAgentKeys = subAgents.map((subAgent) => subAgent.subSessionId).join(",");
  const fileKeys = sharedFiles.map((file) => file.id).join(",");

  return `timers:${timerKeys}|todos:${todoKeys}|terminals:${terminalKeys}|subagents:${subAgentKeys}|files:${fileKeys}`;
}

function TimerStatusItem({
  nowMs,
  onCancel,
  onExtend,
  onFire,
  pendingAction,
  timer,
}: {
  nowMs: number;
  onCancel(timer: ActiveTimerStatus): void;
  onExtend(timer: ActiveTimerStatus): void;
  onFire(timer: ActiveTimerStatus): void;
  pendingAction: string | null;
  timer: ActiveTimerStatus;
}) {
  const firesAtMs = new Date(timer.firesAt).getTime();
  const remainingMs = Number.isFinite(firesAtMs) ? Math.max(0, firesAtMs - nowMs) : 0;
  const startedAtMs = timer.startedAt ? new Date(timer.startedAt).getTime() : Number.NaN;
  const setAtMs = Number.isFinite(startedAtMs)
    ? startedAtMs
    : Number.isFinite(firesAtMs)
      ? firesAtMs - timer.lengthSeconds * 1000
      : Number.NaN;
  const totalMs =
    Number.isFinite(firesAtMs) && Number.isFinite(setAtMs)
      ? Math.max(1, firesAtMs - setAtMs)
      : Math.max(1, timer.lengthSeconds * 1000);
  const remainingRatio = Math.max(0, Math.min(1, remainingMs / totalMs));
  const elapsedRatio = 1 - remainingRatio;
  const stroke = 126;
  const dashOffset = stroke * (1 - elapsedRatio);
  const label = timer.label?.trim() || "None";
  const summary = `Timer set ${formatTimestamp(setAtMs)}. Triggers ${formatTimestamp(firesAtMs)}. Label: ${label}.`;
  const busy = pendingAction?.startsWith(`${timer.timerId}:`) ?? false;
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const hoverCard = useHoverCard();

  return (
    <div
      className="group/timer relative grid w-full overflow-visible"
      onBlur={hoverCard.handleBlur}
      onFocus={hoverCard.show}
      onMouseEnter={hoverCard.show}
      onMouseLeave={hoverCard.scheduleHide}
      ref={anchorRef}
    >
      <ActivityHoverCard
        anchorRef={anchorRef}
        onBlur={hoverCard.handleBlur}
        onFocus={hoverCard.show}
        onMouseEnter={hoverCard.show}
        onMouseLeave={hoverCard.scheduleHide}
        open={hoverCard.open}
      >
        <dl className="grid gap-1.5 leading-5">
          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
            <dt className="text-on-surface-variant">Set</dt>
            <dd className="min-w-0 break-words">{formatTimestamp(setAtMs)}</dd>
          </div>
          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
            <dt className="text-on-surface-variant">Triggers</dt>
            <dd className="min-w-0 break-words">
              {formatTimestamp(firesAtMs)}
              <span className="text-on-surface-variant"> ({formatRelativeRemaining(remainingMs)})</span>
            </dd>
          </div>
          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
            <dt className="text-on-surface-variant">Label</dt>
            <dd className="min-w-0 break-words">{label}</dd>
          </div>
        </dl>
        <div className="mt-2 flex gap-1 border-t border-outline-variant pt-2">
          <TimerActionButton
            busy={pendingAction === `${timer.timerId}:fire`}
            disabled={busy}
            icon="bolt"
            label="Fire timer now"
            onClick={() => onFire(timer)}
          />
          <TimerActionButton
            busy={pendingAction === `${timer.timerId}:extend`}
            disabled={busy}
            icon="add"
            label={`Extend by ${formatLength(timer.lengthSeconds)}`}
            onClick={() => onExtend(timer)}
          />
          <TimerActionButton
            busy={pendingAction === `${timer.timerId}:cancel`}
            disabled={busy}
            icon="close"
            label="Cancel timer"
            onClick={() => onCancel(timer)}
            tone="danger"
          />
        </div>
      </ActivityHoverCard>
      <div
        aria-label={summary}
        className="flex min-h-16 w-full items-center gap-3 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-left text-on-surface shadow-[0_1px_2px_rgb(27_28_25/0.04)] transition hover:border-outline hover:bg-surface-container-low"
      >
        <div className="relative grid h-12 w-12 shrink-0 place-items-center text-[#b88719]">
          <svg aria-hidden="true" className="h-12 w-12 -rotate-90" viewBox="0 0 48 48">
            <circle
              cx="24"
              cy="24"
              fill="none"
              r="20"
              stroke="currentColor"
              strokeOpacity="0.2"
              strokeWidth="4"
            />
            <circle
              cx="24"
              cy="24"
              fill="none"
              r="20"
              stroke="currentColor"
              strokeDasharray={stroke}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              strokeWidth="4"
            />
          </svg>
          <span className="absolute text-[10px] font-semibold leading-none">
            {formatRemaining(remainingMs)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-on-surface">
            {timer.label?.trim() || "Timer"}
          </p>
          <p className="mt-0.5 truncate text-xs text-on-surface-variant">
            Triggers {formatTimestamp(firesAtMs)}
          </p>
          <p className="mt-0.5 truncate text-xs text-[#8a640f]">
            {formatRelativeRemaining(remainingMs)}
          </p>
        </div>
      </div>
    </div>
  );
}

function TimerActionButton({
  busy,
  disabled,
  icon,
  label,
  onClick,
  tone = "default",
}: {
  busy: boolean;
  disabled: boolean;
  icon: string;
  label: string;
  onClick(): void;
  tone?: "danger" | "default";
}) {
  return (
    <button
      aria-label={label}
      className={[
        "grid h-8 w-8 place-items-center rounded-sm border text-on-surface-variant transition focus-visible:outline-none disabled:opacity-45",
        tone === "danger"
          ? "border-error-container bg-error-container/20 hover:bg-error-container/60 hover:text-error focus-visible:bg-error-container/60"
          : "border-outline-variant bg-surface hover:border-outline hover:bg-surface-container-low hover:text-on-surface focus-visible:border-outline focus-visible:bg-surface-container-low",
      ].join(" ")}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {busy ? (
        <span className="truss-spinner h-3.5 w-3.5 rounded-full border-2 border-current/30 border-t-current" />
      ) : (
        <MaterialIcon name={icon} size={17} />
      )}
    </button>
  );
}

function PlanStatusSection({ plan }: { plan: ActivityPlanStatus }) {
  const animatedTodos = useAnimatedActivityItems(plan.todos);

  return (
    <ActivitySection title="TODOs">
      {animatedTodos.map(({ item: todo, phase }) => (
        <PlanTodoItem key={todo.id} phase={phase} todo={todo} />
      ))}
    </ActivitySection>
  );
}

function PlanTodoItem({
  phase,
  todo,
}: {
  phase: ActivityItemAnimationPhase;
  todo: ActivityPlanTodo;
}) {
  const anchorRef = useRef<HTMLElement | null>(null);
  const hoverCard = useHoverCard();
  const animatedSubtasks = useAnimatedActivityItems(todo.subtasks);
  const doneCount = todo.subtasks.filter((subtask) => subtask.status === "done").length;
  const hasSubtasks = todo.subtasks.length > 0;
  const badgeLabel = hasSubtasks
    ? `${doneCount}/${todo.subtasks.length} tasks`
    : statusLabel(todo.status);

  return (
    <article
      className={[
        "grid gap-2.5 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-3 text-on-surface shadow-[0_1px_2px_rgb(27_28_25/0.04)] transition",
        hasSubtasks
          ? "focus-visible:border-outline focus-visible:bg-surface-container-low focus-visible:outline-none"
          : "",
        activityItemAnimationClass(phase),
      ].join(" ")}
      onBlur={hasSubtasks ? hoverCard.handleBlur : undefined}
      onFocus={hasSubtasks ? hoverCard.show : undefined}
      onMouseEnter={hasSubtasks ? hoverCard.show : undefined}
      onMouseLeave={hasSubtasks ? hoverCard.scheduleHide : undefined}
      ref={anchorRef}
      tabIndex={hasSubtasks ? 0 : undefined}
    >
      {hasSubtasks ? (
        <ActivityHoverCard
          anchorRef={anchorRef}
          className="w-72"
          onBlur={hoverCard.handleBlur}
          onFocus={hoverCard.show}
          onMouseEnter={hoverCard.show}
          onMouseLeave={hoverCard.scheduleHide}
          open={hoverCard.open}
        >
          <PlanSubtasksTooltip
            doneCount={doneCount}
            subtasks={animatedSubtasks}
            totalCount={todo.subtasks.length}
          />
        </ActivityHoverCard>
      ) : null}
      <div className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-0.5">
        <PlanTodoIcon
          doneCount={doneCount}
          status={todo.status}
          totalCount={todo.subtasks.length}
        />
        <p className="line-clamp-2 min-w-0 pt-px text-sm font-semibold leading-5 text-on-surface">
          {todo.title}
        </p>
        <span className={statusBadgeClass(todo.status, !hasSubtasks)}>{badgeLabel}</span>
      </div>
      {todo.description ? (
        <p className="line-clamp-2 text-xs leading-5 text-on-surface-variant">
          {todo.description}
        </p>
      ) : null}
    </article>
  );
}

function PlanTodoIcon({
  doneCount,
  size = 18,
  status,
  totalCount,
}: {
  doneCount: number;
  size?: number;
  status: ActivityPlanItemStatus;
  totalCount: number;
}) {
  const radius = 8;
  const stroke = 2 * Math.PI * radius;
  const progress = totalCount > 0 ? Math.max(0, Math.min(1, doneCount / totalCount)) : 0;
  const dashOffset = stroke * (1 - progress);
  const showCheck = status === "done" || (totalCount > 0 && progress >= 1);

  return (
    <svg
      aria-hidden="true"
      className={`mt-0.5 block shrink-0 ${statusColorClass(status)}`}
      height={size}
      viewBox="0 0 20 20"
      width={size}
    >
      <circle
        cx="10"
        cy="10"
        fill="none"
        r={radius}
        stroke="currentColor"
        strokeOpacity={totalCount > 0 && !showCheck ? "0.22" : "1"}
        strokeWidth="2"
      />
      {totalCount > 0 && !showCheck ? (
        <circle
          cx="10"
          cy="10"
          fill="none"
          r={radius}
          stroke="currentColor"
          strokeDasharray={stroke}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          strokeWidth="2"
          transform="rotate(-90 10 10)"
        />
      ) : null}
      {showCheck ? (
        <path
          d="M6 10.15l2.35 2.35L14 6.85"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      ) : null}
      {status === "in_progress" && !showCheck ? (
        <path d="M8 6.5v7l5-3.5z" fill="currentColor" />
      ) : null}
      {status === "skipped" && !showCheck ? (
        <path
          d="M5.8 14.2l8.4-8.4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2"
        />
      ) : null}
    </svg>
  );
}

function PlanSubtasksTooltip({
  doneCount,
  subtasks,
  totalCount,
}: {
  doneCount: number;
  subtasks: AnimatedActivityItem<ActivityPlanSubtask>[];
  totalCount: number;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-outline-variant pb-2">
        <p className="min-w-0 break-words text-xs font-semibold text-on-surface">Subtasks</p>
        <span className="shrink-0 rounded-sm bg-surface-container-low px-1.5 py-0.5 text-[10px] font-semibold text-on-surface-variant">
          {doneCount}/{totalCount}
        </span>
      </div>
      <ul className="truss-message-scrollbar grid max-h-72 gap-1.5 overflow-y-auto pr-1">
        {subtasks.map(({ item: subtask, phase: subtaskPhase }) => (
          <li
            className={[
              "flex min-w-0 items-start gap-2 rounded-sm px-1 py-0.5 -mx-1",
              activityItemAnimationClass(subtaskPhase),
            ].join(" ")}
            key={subtask.id}
          >
            <PlanTodoIcon
              doneCount={0}
              size={15}
              status={subtask.status}
              totalCount={0}
            />
            <div className="min-w-0 flex-1">
              <p className="whitespace-normal break-words text-xs font-medium leading-5 text-on-surface">
                {subtask.title}
              </p>
              {subtask.notes ? (
                <p className="whitespace-normal break-words text-[11px] leading-4 text-on-surface-variant">
                  {subtask.notes}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

type ActivityItemAnimationPhase = "done" | "entering" | "exiting" | "stable";

interface ActivityKeyedItem {
  id: string;
  status?: ActivityPlanItemStatus;
}

interface AnimatedActivityItem<T extends ActivityKeyedItem> {
  fingerprint: string;
  item: T;
  phase: ActivityItemAnimationPhase;
  statusSnapshot?: ActivityPlanItemStatus;
}

const activityItemAnimationMs = 480;

function useAnimatedActivityItems<T extends ActivityKeyedItem>(
  items: T[],
): AnimatedActivityItem<T>[] {
  const itemsSignature = items.map(activityItemSnapshot).join("\n");
  const [animatedItems, setAnimatedItems] = useState<AnimatedActivityItem<T>[]>(() =>
    items.map((item) => ({
      fingerprint: activityItemSnapshot(item),
      item,
      phase: "entering",
      statusSnapshot: item.status,
    })),
  );

  useEffect(() => {
    setAnimatedItems((current) => {
      const nextById = new Map(items.map((item) => [item.id, item]));
      const currentById = new Map(current.map((entry) => [entry.item.id, entry]));
      const nextAnimated = items.map((item): AnimatedActivityItem<T> => {
        const currentEntry = currentById.get(item.id);
        const fingerprint = activityItemSnapshot(item);

        if (!currentEntry || currentEntry.phase === "exiting") {
          return {
            fingerprint,
            item,
            phase: "entering",
            statusSnapshot: item.status,
          };
        }

        const statusChanged = currentEntry.statusSnapshot !== item.status;
        const contentChanged = currentEntry.fingerprint !== fingerprint;

        if (statusChanged && item.status === "done") {
          return {
            fingerprint,
            item,
            phase: "done",
            statusSnapshot: item.status,
          };
        }

        if (statusChanged || contentChanged) {
          return {
            fingerprint,
            item,
            phase: "entering",
            statusSnapshot: item.status,
          };
        }

        return {
          fingerprint,
          item,
          phase:
            currentEntry.phase === "done" || currentEntry.phase === "entering"
              ? currentEntry.phase
              : "stable",
          statusSnapshot: item.status,
        };
      });

      current.forEach((entry, index) => {
        if (nextById.has(entry.item.id)) {
          return;
        }

        const exitingEntry =
          entry.phase === "exiting" ? entry : { ...entry, phase: "exiting" as const };
        nextAnimated.splice(Math.min(index, nextAnimated.length), 0, exitingEntry);
      });

      return nextAnimated;
    });
  }, [items, itemsSignature]);

  useEffect(() => {
    if (animatedItems.every((entry) => entry.phase === "stable")) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setAnimatedItems((current) =>
        current.flatMap((entry): AnimatedActivityItem<T>[] =>
          entry.phase === "exiting" ? [] : [{ ...entry, phase: "stable" }],
        ),
      );
    }, activityItemAnimationMs);

    return () => window.clearTimeout(timeoutId);
  }, [animatedItems]);

  return animatedItems;
}

function activityItemSnapshot(item: ActivityKeyedItem): string {
  return JSON.stringify(item);
}

function activityItemAnimationClass(phase: ActivityItemAnimationPhase): string {
  const base = "truss-activity-item";

  if (phase === "done") {
    return `${base} truss-activity-item-done`;
  }

  if (phase === "entering") {
    return `${base} truss-activity-item-enter`;
  }

  if (phase === "exiting") {
    return `${base} truss-activity-item-exit`;
  }

  return base;
}

function SharedFilesSection({ files }: { files: ActivitySharedFile[] }) {
  return (
    <ActivitySection title="Files">
      {files.map((file) => (
        <SharedFileItem file={file} key={file.id} />
      ))}
    </ActivitySection>
  );
}

function SharedFileItem({ file }: { file: ActivitySharedFile }) {
  return (
    <div
      className="flex min-h-12 items-center gap-3 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-left text-on-surface shadow-[0_1px_2px_rgb(27_28_25/0.04)]"
      title={file.name}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-surface-container-low text-on-surface-variant">
        <MaterialIcon name={sharedFileIcon(file.kind)} size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{file.name}</span>
        <span className="block truncate text-xs text-on-surface-variant">
          {sharedFileDescription(file)}
        </span>
      </span>
      <a
        aria-label={`Download ${file.name}`}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-outline-variant bg-surface text-on-surface-variant transition hover:border-outline hover:bg-surface-container-low hover:text-primary focus-visible:border-outline focus-visible:bg-surface-container-low focus-visible:text-primary focus-visible:outline-none"
        download={file.downloadName}
        href={file.dataUrl}
        title={`Download ${file.downloadName}`}
      >
        <MaterialIcon name="download" size={17} />
      </a>
    </div>
  );
}

function sharedFileIcon(kind: ActivitySharedFile["kind"]): string {
  if (kind === "image") {
    return "image";
  }

  if (kind === "text") {
    return "article";
  }

  return "description";
}

function sharedFileDescription(file: ActivitySharedFile): string {
  const typeLabel = file.sourceFormat || file.mimeType || "File";

  if (file.sourcePageCount && file.sourcePageCount > 1) {
    return `${typeLabel} / ${file.sourcePageCount} pages`;
  }

  return `${typeLabel} / ${formatFileSize(file.size)}`;
}

function statusLabel(status: ActivityPlanItemStatus): string {
  if (status === "done") {
    return "Done";
  }

  if (status === "in_progress") {
    return "Active";
  }

  if (status === "skipped") {
    return "Skipped";
  }

  return "Pending";
}

function statusColorClass(status: ActivityPlanItemStatus): string {
  if (status === "done") {
    return "text-emerald-700";
  }

  if (status === "in_progress") {
    return "text-primary";
  }

  if (status === "skipped") {
    return "text-on-surface-variant";
  }

  return "text-on-surface-variant";
}

function statusBadgeClass(status: ActivityPlanItemStatus, uppercase = true): string {
  const base = [
    "shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold",
    uppercase ? "uppercase" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (status === "done") {
    return `${base} bg-emerald-100 text-emerald-700`;
  }

  if (status === "in_progress") {
    return `${base} border border-outline-variant bg-surface-container-high text-on-surface-variant`;
  }

  if (status === "skipped") {
    return `${base} bg-surface-container-high text-on-surface-variant`;
  }

  return `${base} bg-surface-container-low text-on-surface-variant`;
}

function TerminalStatusItem({
  onKill,
  onOpen,
  pendingAction,
  terminal,
}: {
  onKill(terminal: CommandTerminalSummary): void;
  onOpen(): void;
  pendingAction: string | null;
  terminal: CommandTerminalSummary;
}) {
  const killPending = pendingAction === `${terminal.terminalId}:kill`;
  const canKill = terminal.status === "running";
  const preview = terminal.lastOutputPreview.trim() || latestTerminalOutput(terminal);
  const label = terminal.label || truncateMiddle(terminal.command, 64);

  return (
    <div className="grid min-w-0 gap-2 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-3 text-on-surface shadow-[0_1px_2px_rgb(27_28_25/0.04)]">
      <button
        aria-label={`Open terminal ${label}`}
        className="grid min-w-0 gap-2 text-left focus-visible:outline-none"
        onClick={onOpen}
        type="button"
      >
        <span className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-0.5">
          <span className="grid h-6 w-6 place-items-center rounded-sm border border-outline-variant bg-surface-container-low text-primary">
            <MaterialIcon name="terminal" size={15} />
          </span>
          <span className="line-clamp-2 min-w-0 pt-px text-sm font-semibold leading-5 text-on-surface">
            {label}
          </span>
          <span className={terminalBadgeClass(terminal.status)}>
            {terminalStatusLabel(terminal.status)}
          </span>
        </span>
        {preview ? (
          <pre className="truss-message-scrollbar max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-sm border border-outline-variant bg-surface px-2 py-2 font-mono text-[11px] leading-4 text-on-surface-variant [overflow-wrap:anywhere]">
            {preview}
          </pre>
        ) : null}
      </button>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-on-surface-variant">
          {formatTimestampFromIso(terminal.updatedAt)}
        </span>
        <button
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-outline-variant bg-surface px-2 text-xs font-semibold text-on-surface-variant transition hover:border-outline hover:bg-surface-container-low hover:text-error focus-visible:border-outline focus-visible:bg-surface-container-low focus-visible:text-error focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
          disabled={!canKill || killPending}
          onClick={() => onKill(terminal)}
          type="button"
        >
          <MaterialIcon name={killPending ? "sync" : "stop"} size={15} />
          {killPending ? "Killing" : "Kill"}
        </button>
      </div>
    </div>
  );
}

function SubAgentStatusItem({
  onOpen,
  subAgent,
}: {
  onOpen(): void;
  subAgent: SubAgentPanelSession;
}) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const hoverCard = useHoverCard();
  const statusLabel = subAgentStatusLabel(subAgent.status);
  const elapsed = formatElapsed(subAgent.elapsedMs);
  const started = formatTimestampFromIso(subAgent.startedAt);
  const toolTurns = typeof subAgent.toolTurnCount === "number" ? `${subAgent.toolTurnCount}` : "Unavailable";
  const outcome = subAgentOutcomeMessage(subAgent);
  const rowDetail =
    subAgent.status !== "done"
      ? elapsed !== "Unavailable"
        ? `Elapsed ${elapsed}`
        : "Elapsed unavailable"
      : null;
  const summary = `Sub-agent ${statusLabel}. Task: ${subAgent.task}.`;

  return (
    <div
      className="relative grid min-w-0 w-full overflow-visible"
      onBlur={hoverCard.handleBlur}
      onFocus={hoverCard.show}
      onMouseEnter={hoverCard.show}
      onMouseLeave={hoverCard.scheduleHide}
      ref={anchorRef}
    >
      <ActivityHoverCard
        anchorRef={anchorRef}
        className="w-[28rem]"
        onBlur={hoverCard.handleBlur}
        onFocus={hoverCard.show}
        onMouseEnter={hoverCard.show}
        onMouseLeave={hoverCard.scheduleHide}
        open={hoverCard.open}
      >
        <div className="grid gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className={subAgentBadgeClass(subAgent.status)}>{statusLabel}</span>
            <span className="min-w-0 truncate font-semibold text-on-surface">
              Sub-agent
            </span>
          </div>
          <p className="max-h-24 overflow-y-auto break-words text-xs leading-5 text-on-surface [overflow-wrap:anywhere]">
            {subAgent.task}
          </p>
          {outcome ? (
            <div className="grid gap-1 border-t border-outline-variant pt-2">
              <p className="text-[10px] font-semibold uppercase text-on-surface-variant">
                Outcome
              </p>
              <p className="truss-message-scrollbar max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-on-surface [overflow-wrap:anywhere]">
                {outcome}
              </p>
            </div>
          ) : null}
          <dl className="grid gap-1.5 border-t border-outline-variant pt-2 leading-5">
            <HoverMetric label="Started" value={started} />
            <HoverMetric label="Elapsed" value={elapsed} />
            <HoverMetric label="Turns" value={toolTurns} />
            <HoverMetric label="Model" value={subAgent.modelId ?? "Unavailable"} />
          </dl>
          <button
            className="mt-1 inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-outline-variant bg-surface px-2 text-xs font-semibold text-on-surface-variant transition hover:border-outline hover:bg-surface-container-low hover:text-primary focus-visible:border-outline focus-visible:bg-surface-container-low focus-visible:text-primary focus-visible:outline-none"
            onClick={onOpen}
            type="button"
          >
            <MaterialIcon name="open_in_full" size={15} />
            Open
          </button>
        </div>
      </ActivityHoverCard>
      <button
        aria-label={summary}
        className="grid min-w-0 w-full max-w-full gap-2.5 overflow-hidden rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-3 text-left text-on-surface shadow-[0_1px_2px_rgb(27_28_25/0.04)] transition hover:border-outline hover:bg-surface-container-low focus-visible:border-outline focus-visible:bg-surface-container-low focus-visible:outline-none"
        onClick={onOpen}
        type="button"
      >
        <span className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-0.5">
          <SubAgentStatusGlyph status={subAgent.status} />
          <span className="line-clamp-2 min-w-0 pt-px text-sm font-semibold leading-5 text-on-surface">
            {subAgent.task || "Sub-agent task"}
          </span>
          <span className={subAgentBadgeClass(subAgent.status)}>{statusLabel}</span>
        </span>
        {rowDetail ? (
          <span className="line-clamp-2 text-xs leading-5 text-on-surface-variant">
            {rowDetail}
          </span>
        ) : null}
      </button>
    </div>
  );
}

function ActivityHoverCard({
  anchorRef,
  children,
  className = "w-56",
  onBlur,
  onFocus,
  onMouseEnter,
  onMouseLeave,
  open,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  className?: string;
  onBlur(event: FocusEvent<HTMLElement>): void;
  onFocus(): void;
  onMouseEnter(): void;
  onMouseLeave(): void;
  open: boolean;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [rendered, setRendered] = useState(open);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (open) {
      setRendered(true);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setRendered(false), 350);

    return () => window.clearTimeout(timeoutId);
  }, [open]);

  useLayoutEffect(() => {
    if (!rendered) {
      return undefined;
    }

    function updatePosition(): void {
      const anchor = anchorRef.current;

      if (!anchor) {
        return;
      }

      const anchorRect = anchor.getBoundingClientRect();
      const panelWidth = panelRef.current?.offsetWidth ?? 224;
      const panelHeight = panelRef.current?.offsetHeight ?? 160;
      const margin = 12;
      const gap = 12;
      const left = Math.max(margin, anchorRect.left - panelWidth - gap);
      const centeredTop = anchorRect.top + anchorRect.height / 2 - panelHeight / 2;
      const maxTop = Math.max(margin, window.innerHeight - panelHeight - margin);
      const top = Math.min(Math.max(margin, centeredTop), maxTop);

      setPosition({ left, top });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, rendered]);

  if (!rendered || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className={[
        "truss-activity-hover-card fixed z-[170] max-h-[calc(100vh-1.5rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-sm border border-outline-variant bg-surface-container-lowest p-3 text-left text-xs text-on-surface shadow-[0_14px_34px_rgb(27_28_25/0.16)]",
        open
          ? "truss-activity-hover-card-visible"
          : "truss-activity-hover-card-hidden pointer-events-none",
        className,
      ].join(" ")}
      onBlur={onBlur}
      onFocus={onFocus}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      ref={panelRef}
      style={
        position
          ? { left: `${position.left}px`, top: `${position.top}px` }
          : { left: 0, top: 0, visibility: "hidden" }
      }
    >
      {children}
    </div>,
    document.body,
  );
}

function HoverMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}

function useHoverCard() {
  const [open, setOpen] = useState(false);
  const closeTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    },
    [],
  );

  function show(): void {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    setOpen(true);
  }

  function scheduleHide(): void {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
    }

    closeTimeoutRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimeoutRef.current = null;
    }, 120);
  }

  function handleBlur(event: FocusEvent<HTMLElement>): void {
    const nextTarget = event.relatedTarget;

    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    scheduleHide();
  }

  return {
    handleBlur,
    open,
    scheduleHide,
    show,
  };
}

function subAgentBadgeClass(status: SubAgentPanelSession["status"]): string {
  const base = "shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase";

  if (status === "error") {
    return `${base} bg-error-container text-error`;
  }

  if (status === "done") {
    return `${base} bg-emerald-100 text-emerald-700`;
  }

  return `${base} border border-outline-variant bg-surface-container-high text-on-surface-variant`;
}

function subAgentStatusColorClass(status: SubAgentPanelSession["status"]): string {
  if (status === "error") {
    return "text-error";
  }

  if (status === "done") {
    return "text-emerald-700";
  }

  return "text-primary";
}

function SubAgentStatusGlyph({ status }: { status: SubAgentPanelSession["status"] }) {
  return (
    <svg
      aria-hidden="true"
      className={`mt-0.5 block h-[18px] max-h-[18px] min-h-[18px] w-[18px] min-w-[18px] max-w-[18px] shrink-0 ${subAgentStatusColorClass(status)}`}
      height="18"
      preserveAspectRatio="xMidYMid meet"
      viewBox="0 0 18 18"
      width="18"
    >
      <circle
        cx="9"
        cy="9"
        fill="none"
        r="7.2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      {status === "done" ? (
        <path
          d="M5.4 9.15 7.55 11.3 12.7 6.2"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      ) : null}
      {status === "error" ? (
        <>
          <path
            d="M9 4.9v5.15"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
          <circle cx="9" cy="12.8" fill="currentColor" r="1" />
        </>
      ) : null}
      {status === "running" ? (
        <path d="M7.15 5.45v7.1L12.45 9z" fill="currentColor" />
      ) : null}
    </svg>
  );
}

function subAgentOutcomeMessage(subAgent: SubAgentPanelSession): string | null {
  for (let index = subAgent.messages.length - 1; index >= 0; index -= 1) {
    const message = subAgent.messages[index];

    if (!message || message.role !== "assistant") {
      continue;
    }

    const content = message.content.trim();

    if (content) {
      return content;
    }
  }

  return null;
}

function subAgentStatusLabel(status: SubAgentPanelSession["status"]): string {
  if (status === "done") {
    return "Done";
  }

  if (status === "error") {
    return "Error";
  }

  return "Running";
}

function terminalStatusLabel(status: CommandTerminalStatus): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "killed":
      return "Killed";
    case "running":
      return "Running";
    case "timed_out":
      return "Timed out";
  }
}

function terminalBadgeClass(status: CommandTerminalStatus): string {
  const base = "shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase";

  if (status === "running") {
    return `${base} border border-outline-variant bg-surface-container-high text-on-surface-variant`;
  }

  if (status === "idle") {
    return `${base} bg-emerald-100 text-emerald-700`;
  }

  if (status === "timed_out") {
    return `${base} bg-amber-100 text-amber-800`;
  }

  return `${base} bg-surface-container-high text-on-surface-variant`;
}

function latestTerminalOutput(terminal: CommandTerminalSummary): string {
  const output = [...terminal.log]
    .reverse()
    .find((entry) => entry.stream === "stdout" || entry.stream === "stderr");

  return output?.text.trim() ?? "";
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const half = Math.max(8, Math.floor((maxLength - 3) / 2));

  return `${value.slice(0, half)}...${value.slice(-half)}`;
}

function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes >= 100) {
    return `${Math.floor(minutes / 60)}h`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatRelativeRemaining(remainingMs: number): string {
  if (remainingMs <= 0) {
    return "now";
  }

  return `in ${formatLength(Math.ceil(remainingMs / 1000))}`;
}

function formatLength(totalSeconds: number): string {
  const seconds = Math.max(1, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}

function formatTimestamp(value: number): string {
  if (!Number.isFinite(value)) {
    return "Unavailable";
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    second: "2-digit",
  }).format(new Date(value));
}

function formatTimestampFromIso(value: string | undefined): string {
  if (!value) {
    return "Unavailable";
  }

  const timestamp = new Date(value).getTime();

  return formatTimestamp(timestamp);
}

function formatElapsed(value: number | undefined): string {
  if (typeof value !== "number") {
    return "Unavailable";
  }

  return formatLength(Math.max(1, Math.ceil(value / 1000)));
}
