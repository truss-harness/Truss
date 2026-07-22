import type {
  ApiError,
  OrchestrationTimerActionRequest,
  OrchestrationTimerActionResponse,
  OrchestrationTimerSummary,
  OrchestrationTimersResponse,
} from "../../shared/protocol.ts";
import type { ServerContext } from "./context.ts";
import { json, readJson } from "./responses.ts";

const orchestrationServerName = "Truss Orchestration Tools";

type TimerToolName = "timer_cancel" | "timer_extend" | "timer_fire" | "timer_list";

export async function handleOrchestrationTimerRoute(
  request: Request,
  context: ServerContext,
  timerId: string | null,
  action: string | null,
): Promise<Response> {
  const url = new URL(request.url);

  if (!timerId && !action) {
    if (request.method !== "GET") {
      return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
    }

    const sessionId = url.searchParams.get("sessionId")?.trim() ?? "";

    if (!sessionId) {
      return json<ApiError>({ error: "sessionId is required" }, { status: 400 });
    }

    const result = await callTimerTool(context, "timer_list", {}, sessionId);
    const timers = Array.isArray(result.timers)
      ? result.timers.flatMap((timer) => {
          const normalized = normalizeTimerSummary(timer);

          return normalized ? [normalized] : [];
        })
      : [];

    return json<OrchestrationTimersResponse>({ timers });
  }

  if (!timerId || !action || request.method !== "POST") {
    return json<ApiError>({ error: "Route not found" }, { status: 404 });
  }

  const body = await readJson<OrchestrationTimerActionRequest>(request);
  if (!body || typeof body !== "object") {
    return json<ApiError>({ error: "Request body is required" }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";

  if (!sessionId) {
    return json<ApiError>({ error: "sessionId is required" }, { status: 400 });
  }

  if (action === "cancel") {
    const result = await callTimerTool(context, "timer_cancel", { timerId }, sessionId);

    return json<OrchestrationTimerActionResponse>({
      cancelled: result.cancelled === true,
    });
  }

  if (action === "extend") {
    const delaySeconds = normalizedDelaySeconds(body.delaySeconds);

    if (delaySeconds === null) {
      return json<ApiError>({ error: "delaySeconds is required" }, { status: 400 });
    }

    const result = await callTimerTool(
      context,
      "timer_extend",
      { delaySeconds, timerId },
      sessionId,
    );

    return json<OrchestrationTimerActionResponse>({
      timer: normalizeTimerSummary(result.timer),
    });
  }

  if (action === "fire") {
    const result = await callTimerTool(context, "timer_fire", { timerId }, sessionId);

    return json<OrchestrationTimerActionResponse>({
      fired: result.fired === true,
    });
  }

  return json<ApiError>({ error: "Route not found" }, { status: 404 });
}

async function callTimerTool(
  context: ServerContext,
  toolName: TimerToolName,
  args: Record<string, unknown>,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const result = await context.mcp.callToolStructuredByServerName({
    args,
    meta: { sessionId },
    serverName: orchestrationServerName,
    toolName,
  });

  if (result && typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }

  throw new Error(`Timer tool "${toolName}" returned an invalid response.`);
}

function normalizedDelaySeconds(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.min(3600, Math.max(1, Math.floor(value)));
}

function normalizeTimerSummary(value: unknown): OrchestrationTimerSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const source = value as Record<string, unknown>;
  const firesAt = typeof source.firesAt === "string" ? source.firesAt : "";
  const lengthSeconds =
    typeof source.lengthSeconds === "number" && Number.isFinite(source.lengthSeconds)
      ? source.lengthSeconds
      : null;
  const message = typeof source.message === "string" ? source.message : "";
  const startedAt = typeof source.startedAt === "string" && source.startedAt.trim()
    ? source.startedAt.trim()
    : undefined;
  const timerId = typeof source.timerId === "string" ? source.timerId : "";

  if (!firesAt || !lengthSeconds || !message || !timerId) {
    return null;
  }

  const label = typeof source.label === "string" && source.label.trim()
    ? source.label.trim()
    : undefined;

  return {
    firesAt,
    ...(label ? { label } : {}),
    lengthSeconds,
    message,
    ...(startedAt ? { startedAt } : {}),
    timerId,
  };
}
