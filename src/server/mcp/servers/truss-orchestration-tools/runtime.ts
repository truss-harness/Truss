export type PlanItemStatus = "done" | "in_progress" | "pending" | "skipped";

export interface PlanSubtask {
  id: string;
  notes?: string;
  status: PlanItemStatus;
  title: string;
}

export interface PlanTodo {
  description?: string;
  id: string;
  status: PlanItemStatus;
  subtasks: PlanSubtask[];
  title: string;
}

export interface SessionPlan {
  todos: PlanTodo[];
}

export interface TimerFiredEvent {
  firedAt: string;
  label?: string;
  lengthSeconds: number;
  message: string;
  sessionId: string;
  timerId: string;
}

interface TimerRecord {
  firesAt: string;
  label?: string;
  lengthSeconds: number;
  message: string;
  sessionId: string;
  startedAt: string;
  timeout: ReturnType<typeof setTimeout>;
  timerId: string;
}

export interface TimerSummary {
  firesAt: string;
  label?: string;
  lengthSeconds: number;
  message: string;
  startedAt: string;
  timerId: string;
}

export interface TrussOrchestrationToolsRuntimeOptions {
  onTimerFired?(event: TimerFiredEvent): void | Promise<void>;
}

export class TrussOrchestrationToolsRuntime {
  readonly #plansBySessionId = new Map<string, SessionPlan>();
  readonly #timers = new Map<string, TimerRecord>();
  readonly #onTimerFired?: TrussOrchestrationToolsRuntimeOptions["onTimerFired"];

  constructor(options: TrussOrchestrationToolsRuntimeOptions = {}) {
    this.#onTimerFired = options.onTimerFired;
  }

  close(): void {
    for (const timer of this.#timers.values()) {
      clearTimeout(timer.timeout);
    }

    this.#timers.clear();
  }

  setTodos({
    sessionId,
    todos,
  }: {
    sessionId: string;
    todos: PlanTodo[];
  }): SessionPlan {
    const plan = {
      todos: todos.map((todo) => ({
        description: todo.description,
        id: todo.id,
        status: todo.status,
        subtasks: [],
        title: todo.title,
      })),
    };

    this.#plansBySessionId.set(sessionId, plan);
    return clonePlan(plan);
  }

  setSubtasks({
    replace,
    sessionId,
    subtasks,
    todoId,
  }: {
    replace: boolean;
    sessionId: string;
    subtasks: PlanSubtask[];
    todoId: string;
  }): SessionPlan {
    const todo = this.#requireTodo(sessionId, todoId);

    todo.subtasks = replace ? subtasks : upsertSubtasks(todo.subtasks, subtasks);
    return this.getPlan(sessionId);
  }

  getPlan(sessionId: string): SessionPlan {
    return clonePlan(this.#planForSession(sessionId));
  }

  updateTodo({
    id,
    sessionId,
    status,
    title,
  }: {
    id: string;
    sessionId: string;
    status?: PlanItemStatus;
    title?: string;
  }): SessionPlan {
    const todo = this.#requireTodo(sessionId, id);

    if (title !== undefined) {
      todo.title = title;
    }

    if (status !== undefined) {
      todo.status = status;
    }

    return this.getPlan(sessionId);
  }

  updateSubtask({
    id,
    notes,
    sessionId,
    status,
    todoId,
  }: {
    id: string;
    notes?: string;
    sessionId: string;
    status?: PlanItemStatus;
    todoId: string;
  }): SessionPlan {
    const todo = this.#requireTodo(sessionId, todoId);
    const subtask = todo.subtasks.find((item) => item.id === id);

    if (!subtask) {
      throw new Error(`Unknown subtask "${id}" under todo "${todoId}".`);
    }

    if (notes !== undefined) {
      subtask.notes = notes;
    }

    if (status !== undefined) {
      subtask.status = status;
    }

    return this.getPlan(sessionId);
  }

  setTimer({
    delaySeconds,
    label,
    sessionId,
  }: {
    delaySeconds: number;
    label?: string;
    sessionId: string;
  }): TimerSummary {
    const activeSessionTimers = [...this.#timers.values()].filter(
      (timer) => timer.sessionId === sessionId,
    );

    if (activeSessionTimers.length >= 5) {
      throw new Error("This session already has 5 pending timers.");
    }

    const clampedDelaySeconds = clampTimerDelaySeconds(delaySeconds);
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const timerId = `timer_${crypto.randomUUID()}`;
    const firesAt = new Date(startedAtMs + clampedDelaySeconds * 1000).toISOString();
    const timeout = setTimeout(() => {
      this.#fireTimer(timerId);
    }, clampedDelaySeconds * 1000);

    const timer: TimerRecord = {
      firesAt,
      ...(label ? { label } : {}),
      lengthSeconds: clampedDelaySeconds,
      message: timerFiredMessageForLength(clampedDelaySeconds),
      sessionId,
      startedAt,
      timeout,
      timerId,
    };

    this.#timers.set(timerId, timer);

    return timerSummary(timer);
  }

  cancelTimer(timerId: string, sessionId: string): { cancelled: boolean } {
    const timer = this.#timers.get(timerId);

    if (!timer || timer.sessionId !== sessionId) {
      return { cancelled: false };
    }

    clearTimeout(timer.timeout);
    this.#timers.delete(timerId);
    return { cancelled: true };
  }

  extendTimer(timerId: string, sessionId: string, delaySeconds: number): TimerSummary | null {
    const timer = this.#timers.get(timerId);

    if (!timer || timer.sessionId !== sessionId) {
      return null;
    }

    const clampedDelaySeconds = clampTimerDelaySeconds(delaySeconds);
    const nowMs = Date.now();
    const currentFiresAtMs = new Date(timer.firesAt).getTime();
    const baseFiresAtMs =
      Number.isFinite(currentFiresAtMs) && currentFiresAtMs > nowMs
        ? currentFiresAtMs
        : nowMs;
    const nextFiresAtMs = baseFiresAtMs + clampedDelaySeconds * 1000;
    const nextDelayMs = Math.max(1, nextFiresAtMs - Date.now());

    clearTimeout(timer.timeout);
    timer.firesAt = new Date(nextFiresAtMs).toISOString();
    timer.timeout = setTimeout(() => {
      this.#fireTimer(timerId);
    }, nextDelayMs);

    return timerSummary(timer);
  }

  fireTimer(timerId: string, sessionId: string): { fired: boolean } {
    const timer = this.#timers.get(timerId);

    if (!timer || timer.sessionId !== sessionId) {
      return { fired: false };
    }

    return { fired: this.#fireTimer(timerId) };
  }

  listTimers(sessionId: string): TimerSummary[] {
    return [...this.#timers.values()]
      .filter((timer) => timer.sessionId === sessionId)
      .sort((left, right) => left.firesAt.localeCompare(right.firesAt))
      .map(timerSummary);
  }

  #planForSession(sessionId: string): SessionPlan {
    const existing = this.#plansBySessionId.get(sessionId);

    if (existing) {
      return existing;
    }

    const next = emptyPlan();

    this.#plansBySessionId.set(sessionId, next);
    return next;
  }

  #requireTodo(sessionId: string, id: string): PlanTodo {
    const todo = this.#planForSession(sessionId).todos.find((item) => item.id === id);

    if (!todo) {
      throw new Error(`Unknown todo "${id}".`);
    }

    return todo;
  }

  #fireTimer(timerId: string): boolean {
    const timer = this.#timers.get(timerId);

    if (!timer) {
      return false;
    }

    clearTimeout(timer.timeout);
    this.#timers.delete(timerId);
    void this.#onTimerFired?.({
      firedAt: new Date().toISOString(),
      ...(timer.label ? { label: timer.label } : {}),
      lengthSeconds: timer.lengthSeconds,
      message: timer.message,
      sessionId: timer.sessionId,
      timerId,
    });

    return true;
  }
}

export function createTrussOrchestrationToolsRuntime(
  options: TrussOrchestrationToolsRuntimeOptions = {},
): TrussOrchestrationToolsRuntime {
  return new TrussOrchestrationToolsRuntime(options);
}

function upsertSubtasks(current: PlanSubtask[], next: PlanSubtask[]): PlanSubtask[] {
  const byId = new Map(current.map((subtask) => [subtask.id, subtask] as const));

  for (const subtask of next) {
    byId.set(subtask.id, subtask);
  }

  return [...byId.values()];
}

function emptyPlan(): SessionPlan {
  return { todos: [] };
}

function clonePlan(plan: SessionPlan): SessionPlan {
  return {
    todos: plan.todos.map((todo) => ({
      ...todo,
      subtasks: todo.subtasks.map((subtask) => ({ ...subtask })),
    })),
  };
}

function clampTimerDelaySeconds(delaySeconds: number): number {
  return Math.min(3600, Math.max(1, Math.floor(delaySeconds)));
}

function timerSummary(timer: TimerRecord): TimerSummary {
  return {
    firesAt: timer.firesAt,
    ...(timer.label ? { label: timer.label } : {}),
    lengthSeconds: timer.lengthSeconds,
    message: timer.message,
    startedAt: timer.startedAt,
    timerId: timer.timerId,
  };
}

export function timerFiredMessageForLength(lengthSeconds: number): string {
  return `[Truss system event]: Timer set for ${formatTimerLength(lengthSeconds)} are up.`;
}

function formatTimerLength(totalSeconds: number): string {
  const seconds = clampTimerDelaySeconds(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  }

  if (minutes > 0) {
    parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  }

  if (remainingSeconds > 0 || parts.length === 0) {
    parts.push(`${remainingSeconds} ${remainingSeconds === 1 ? "second" : "seconds"}`);
  }

  return parts.join(" ");
}
