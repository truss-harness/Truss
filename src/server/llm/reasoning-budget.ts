import type { ChatThinking } from "../../shared/protocol.ts";

const reasoningBudgetExceededMessage = "Reasoning budget exceeded.";

export interface ReasoningBudgetLimit {
  maxDurationMs: number;
  maxWords: number;
}

export interface ReasoningBudgetMonitor {
  readonly exceeded: boolean;
  readonly thinking: ChatThinking | null;
  chargeElapsed(durationMs: number): void;
  check(thinking: ChatThinking): void;
  dispose(): void;
  start(): void;
}

export class ReasoningBudgetExceededError extends Error {
  readonly thinking: ChatThinking | null;

  constructor(thinking: ChatThinking | null = null) {
    super(reasoningBudgetExceededMessage);
    this.name = "ReasoningBudgetExceededError";
    this.thinking = thinking;
  }
}

export function createReasoningBudgetMonitor(
  limit: ReasoningBudgetLimit | null,
  abort: () => void,
): ReasoningBudgetMonitor {
  let exceeded = false;
  let started = false;
  let startedAt: number | null = null;
  let chargedDurationMs = 0;
  let latestThinking: ChatThinking | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const currentThinking = (): ChatThinking | null => {
    const durationMs = chargedDurationMs + (latestThinking?.durationMs ?? 0);

    if (latestThinking) {
      return {
        ...latestThinking,
        durationMs,
      };
    }

    if (chargedDurationMs > 0) {
      return {
        content: "",
        durationMs,
        wordCount: 0,
      };
    }

    return null;
  };

  const clearTimer = () => {
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  const scheduleTimer = () => {
    if (!limit || !started || exceeded || startedAt === null) {
      return;
    }

    clearTimer();

    const liveElapsedMs = Date.now() - startedAt;
    const durationMs = chargedDurationMs + liveElapsedMs;
    const remainingMs = Math.max(0, limit.maxDurationMs - durationMs);

    timeout = setTimeout(exceed, remainingMs + 1);
  };

  const exceed = () => {
    if (exceeded) {
      return;
    }

    exceeded = true;
    abort();
  };

  const assertWithinLimit = () => {
    if (!limit) {
      return;
    }

    const durationMs = chargedDurationMs + (latestThinking?.durationMs ?? 0);
    const wordCount = latestThinking?.wordCount ?? 0;

    if (durationMs > limit.maxDurationMs || wordCount > limit.maxWords) {
      exceed();
    } else {
      scheduleTimer();
    }

    if (exceeded) {
      throw new ReasoningBudgetExceededError(currentThinking());
    }
  };

  return {
    get exceeded() {
      return exceeded;
    },
    get thinking() {
      return currentThinking();
    },
    chargeElapsed(durationMs) {
      if (!limit) {
        return;
      }

      chargedDurationMs += Math.max(0, durationMs);

      if (!started) {
        this.start();
      }

      assertWithinLimit();
    },
    check(nextThinking) {
      if (!limit) {
        return;
      }

      latestThinking = nextThinking;

      if (!started) {
        this.start();
      }

      assertWithinLimit();
    },
    dispose() {
      clearTimer();
    },
    start() {
      if (!limit || started) {
        return;
      }

      started = true;
      startedAt = Date.now();
      scheduleTimer();
    },
  };
}
