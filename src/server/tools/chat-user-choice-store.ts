import type {
  ChatUserChoiceAppliedEffect,
  ChatUserChoiceRequest,
  ChatUserChoiceResolutionRequest,
  ChatUserChoiceToolResult,
} from "../../shared/protocol.ts";
import { maxUserChoiceCustomResponseLength } from "./user-choice.ts";

interface PendingUserChoice {
  abortListener?: () => void;
  request: ChatUserChoiceRequest;
  resolve(result: ChatUserChoiceToolResult): void;
  signal?: AbortSignal;
  timer: ReturnType<typeof setTimeout>;
}

export class ChatUserChoiceStore {
  readonly #pending = new Map<string, PendingUserChoice>();

  waitForChoice(
    request: ChatUserChoiceRequest,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<ChatUserChoiceToolResult> {
    this.cancel(request.id, "timeout");

    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve(cancelledChoiceResult(request, "user_cancelled"));
        return;
      }

      const finish = (result: ChatUserChoiceToolResult) => {
        const pending = this.#pending.get(request.id);

        if (!pending) {
          return;
        }

        clearPendingUserChoice(pending);
        this.#pending.delete(request.id);
        resolve(result);
      };
      const timer = setTimeout(() => {
        finish(cancelledChoiceResult(request, "timeout"));
      }, timeoutMs);
      const abortListener = signal
        ? () => finish(cancelledChoiceResult(request, "user_cancelled"))
        : undefined;

      if (signal && abortListener) {
        signal.addEventListener("abort", abortListener, { once: true });
      }

      this.#pending.set(request.id, {
        abortListener,
        request,
        resolve: finish,
        signal,
        timer,
      });
    });
  }

  resolve(
    requestId: string,
    payload: ChatUserChoiceResolutionRequest | null,
  ): { ok: true } | { ok: false; status: number; error: string } {
    const pending = this.#pending.get(requestId);

    if (!pending) {
      return { ok: false, status: 404, error: "Unknown or already resolved user choice." };
    }

    const result = normalizeResolution(pending.request, payload);

    if (!result.ok) {
      return { ok: false, status: 400, error: result.error };
    }

    pending.resolve(result.value);

    return { ok: true };
  }

  cancel(requestId: string, reason: "timeout" | "user_cancelled"): boolean {
    const pending = this.#pending.get(requestId);

    if (!pending) {
      return false;
    }

    pending.resolve(cancelledChoiceResult(pending.request, reason));

    return true;
  }
}

function clearPendingUserChoice(pending: PendingUserChoice): void {
  clearTimeout(pending.timer);

  if (pending.signal && pending.abortListener) {
    pending.signal.removeEventListener("abort", pending.abortListener);
  }
}

function normalizeResolution(
  request: ChatUserChoiceRequest,
  payload: ChatUserChoiceResolutionRequest | null,
): { ok: true; value: ChatUserChoiceToolResult } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Choice resolution payload must be an object." };
  }

  if (payload.cancelled === true) {
    return {
      ok: true,
      value: cancelledChoiceResult(request, "user_cancelled"),
    };
  }

  if (typeof payload.optionId === "string" && payload.optionId.trim()) {
    const selectedIndex = request.options.findIndex((option) => option.id === payload.optionId);
    const selectedOption = selectedIndex >= 0 ? request.options[selectedIndex] : null;

    if (!selectedOption) {
      return { ok: false, error: "Selected option does not exist." };
    }

    const appliedEffect = normalizeAppliedEffect(payload.appliedEffect);

    return {
      ok: true,
      value: {
        cancelled: false,
        question: request.question,
        ...(appliedEffect ? { appliedEffect } : {}),
        resolvedAt: new Date().toISOString(),
        selectedOption: {
          ...(selectedOption.description ? { description: selectedOption.description } : {}),
          id: selectedOption.id,
          index: selectedIndex,
          label: selectedOption.label,
          value: selectedOption.value ?? selectedOption.label,
        },
        selectionType: "option",
      },
    };
  }

  if (typeof payload.customResponse === "string") {
    if (!request.allowCustomOption) {
      return { ok: false, error: "This choice does not accept a custom response." };
    }

    const customResponse = payload.customResponse.trim();

    if (!customResponse) {
      return { ok: false, error: "customResponse cannot be empty." };
    }

    if (customResponse.length > maxUserChoiceCustomResponseLength) {
      return { ok: false, error: "customResponse is too long." };
    }

    const appliedEffect = normalizeAppliedEffect(payload.appliedEffect);

    return {
      ok: true,
      value: {
        cancelled: false,
        customResponse,
        ...(appliedEffect ? { appliedEffect } : {}),
        question: request.question,
        resolvedAt: new Date().toISOString(),
        selectionType: "custom",
      },
    };
  }

  return { ok: false, error: "Choose an option or provide a custom response." };
}

function normalizeAppliedEffect(value: unknown): ChatUserChoiceAppliedEffect | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const effect = value as Record<string, unknown>;

  if (
    effect.type === "file_access_directory_granted" &&
    typeof effect.directoryPath === "string" &&
    typeof effect.mcpReloaded === "boolean" &&
    typeof effect.readOnly === "boolean"
  ) {
    return {
      directoryPath: effect.directoryPath,
      mcpReloaded: effect.mcpReloaded,
      readOnly: effect.readOnly,
      ...(typeof effect.reloadError === "string" && effect.reloadError.trim()
        ? { reloadError: effect.reloadError.trim() }
        : {}),
      type: "file_access_directory_granted",
    };
  }

  if (
    effect.type === "command_whitelist_added" &&
    typeof effect.pattern === "string" &&
    (effect.whitelistType === "prefix" ||
      effect.whitelistType === "glob" ||
      effect.whitelistType === "regex") &&
    (effect.expiresAt === null || typeof effect.expiresAt === "string")
  ) {
    return {
      expiresAt: effect.expiresAt,
      pattern: effect.pattern,
      type: "command_whitelist_added",
      whitelistType: effect.whitelistType,
    };
  }

  return null;
}

function cancelledChoiceResult(
  request: ChatUserChoiceRequest,
  reason: "timeout" | "user_cancelled",
): ChatUserChoiceToolResult {
  return {
    cancelled: true,
    question: request.question,
    reason,
    resolvedAt: new Date().toISOString(),
  };
}
