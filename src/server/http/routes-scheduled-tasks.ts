import { CronPattern } from "croner";
import type {
  ApiError,
  ScheduledTaskCreateRequest,
  ScheduledTaskDeleteResponse,
  ScheduledTaskRunNowResponse,
  ScheduledTaskRunsResponse,
  ScheduledTaskSessionsResponse,
  ScheduledTaskSessionSummary,
  ScheduledTasksResponse,
  ScheduledTaskStopResponse,
  ScheduledTaskUpdateRequest,
} from "../../shared/protocol.ts";
import { getLlmProvider } from "../llm/registry.ts";
import { runScheduledTask } from "./routes-chat.ts";
import { validateGenerationParameters } from "./routes-model-profiles.ts";
import type {
  ScheduledTaskCreate,
  ScheduledTaskUpdate,
} from "../storage/scheduled-tasks.ts";
import type { ScheduledTaskSummary } from "../../shared/protocol.ts";
import { createId } from "../utils/id.ts";
import { json, readJson } from "./responses.ts";
import type { ServerContext } from "./context.ts";

const maxNameLength = 200;
const maxPromptLength = 40_000;
const maxCronLength = 200;
const maxTimezoneLength = 100;
const maxWorkingDirectoryLength = 4_000;
const maxSessionListLimit = 100;

function normalizeListLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.min(parsed, maxSessionListLimit);
}

export async function handleScheduledTasksRoute(
  request: Request,
  context: ServerContext,
  taskId: string | null,
  subResource: string | null,
): Promise<Response> {
  if (subResource === "sessions") {
    if (request.method !== "GET") {
      return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
    }

    const url = new URL(request.url);
    const limit = normalizeListLimit(url.searchParams.get("limit"));

    return json<ScheduledTaskSessionsResponse>({
      sessions: context.scheduledTasks.listScheduledTaskSessions(limit) as ScheduledTaskSessionSummary[],
    });
  }

  if (!taskId) {
    if (request.method === "GET") {
      return json<ScheduledTasksResponse>({ tasks: withNextRunAt(context) });
    }

    if (request.method === "POST") {
      return createScheduledTask(request, context);
    }

    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  if (subResource === "runs") {
    if (request.method !== "GET") {
      return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
    }

    const task = context.scheduledTasks.getScheduledTask(taskId);

    if (!task) {
      return json<ApiError>({ error: "Scheduled task not found" }, { status: 404 });
    }

    return json<ScheduledTaskRunsResponse>({ runs: context.scheduledTaskRuns.listRuns(taskId) });
  }

  if (subResource === "run") {
    if (request.method !== "POST") {
      return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
    }

    const task = context.scheduledTasks.getScheduledTask(taskId);

    if (!task) {
      return json<ApiError>({ error: "Scheduled task not found" }, { status: 404 });
    }

    if (context.scheduledTaskRuns.isRunning(taskId) && !task.allowOverlap) {
      return json<ApiError>({ error: "This task is already running." }, { status: 409 });
    }

    // Fire-and-forget: the run can involve multiple LLM tool turns and may
    // take a while. Clients observe progress via scheduled_task.updated hub
    // events and by polling the runs endpoint.
    void runScheduledTask(context, task, "manual");

    const runs = context.scheduledTaskRuns.listRuns(taskId, 1);

    return json<ScheduledTaskRunNowResponse>(
      { run: runs[0] ?? { id: "", taskId, sessionId: null, status: "running", trigger: "manual", summary: null, error: null, startedAt: new Date().toISOString(), completedAt: null } },
      { status: 202 },
    );
  }

  if (subResource === "stop") {
    if (request.method !== "POST") {
      return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
    }

    const task = context.scheduledTasks.getScheduledTask(taskId);

    if (!task) {
      return json<ApiError>({ error: "Scheduled task not found" }, { status: 404 });
    }

    let stopped = false;

    for (const entry of context.scheduledTaskRunControllers.values()) {
      if (entry.taskId === taskId) {
        entry.controller.abort();
        stopped = true;
      }
    }

    return json<ScheduledTaskStopResponse>({ stopped });
  }

  if (subResource) {
    return json<ApiError>({ error: "Route not found" }, { status: 404 });
  }

  if (request.method === "GET") {
    const task = context.scheduledTasks.getScheduledTask(taskId);

    if (!task) {
      return json<ApiError>({ error: "Scheduled task not found" }, { status: 404 });
    }

    return json({ task: attachNextRunAt(context, task) });
  }

  if (request.method === "PATCH" || request.method === "PUT") {
    return updateScheduledTask(request, context, taskId);
  }

  if (request.method === "DELETE") {
    const deleted = context.scheduledTasks.deleteScheduledTask(taskId);

    if (!deleted) {
      return json<ApiError>({ error: "Scheduled task not found" }, { status: 404 });
    }

    context.reloadScheduledTasks();

    return json<ScheduledTaskDeleteResponse>({ deleted: true });
  }

  return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
}

async function createScheduledTask(request: Request, context: ServerContext): Promise<Response> {
  const body = await readJson<ScheduledTaskCreateRequest>(request);
  const validation = validateCreateRequest(body, context);

  if (!validation.ok) {
    return json<ApiError>({ error: validation.error }, { status: 400 });
  }

  const task = context.scheduledTasks.createScheduledTask({
    id: createId("task"),
    createdBy: "user",
    ...validation.input,
  });

  context.reloadScheduledTasks();

  return json({ task: attachNextRunAt(context, task) }, { status: 201 });
}

async function updateScheduledTask(
  request: Request,
  context: ServerContext,
  taskId: string,
): Promise<Response> {
  const existing = context.scheduledTasks.getScheduledTask(taskId);

  if (!existing) {
    return json<ApiError>({ error: "Scheduled task not found" }, { status: 404 });
  }

  const body = await readJson<ScheduledTaskUpdateRequest>(request);
  const validation = validateUpdateRequest(body, context);

  if (!validation.ok) {
    return json<ApiError>({ error: validation.error }, { status: 400 });
  }

  const task = context.scheduledTasks.updateScheduledTask(taskId, validation.update);

  if (!task) {
    return json<ApiError>({ error: "Scheduled task not found" }, { status: 404 });
  }

  context.reloadScheduledTasks();

  return json({ task: attachNextRunAt(context, task) });
}

function withNextRunAt(context: ServerContext): ScheduledTaskSummary[] {
  return context.scheduledTasks.listScheduledTasks().map((task) => attachNextRunAt(context, task));
}

function attachNextRunAt(context: ServerContext, task: ScheduledTaskSummary): ScheduledTaskSummary {
  return {
    ...task,
    nextRunAt: context.scheduledTaskScheduler.nextRunAt(task.id)?.toISOString() ?? null,
    running: context.scheduledTaskRuns.isRunning(task.id),
  };
}

function validateCreateRequest(
  body: ScheduledTaskCreateRequest | null,
  context: ServerContext,
): { ok: true; input: Omit<ScheduledTaskCreate, "id" | "createdBy"> } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Scheduled task payload must be an object" };
  }

  const name = requiredString(body.name, "name", maxNameLength);

  if (!name.ok) {
    return name;
  }

  const prompt = requiredString(body.prompt, "prompt", maxPromptLength);

  if (!prompt.ok) {
    return prompt;
  }

  const cronExpression = requiredString(body.cronExpression, "cronExpression", maxCronLength);

  if (!cronExpression.ok) {
    return cronExpression;
  }

  const cronValidation = validateCronExpression(cronExpression.value);

  if (!cronValidation.ok) {
    return cronValidation;
  }

  const timezoneValidation = optionalString(body.timezone, "timezone", maxTimezoneLength);

  if (!timezoneValidation.ok) {
    return timezoneValidation;
  }

  const workingDirectoryValidation = optionalString(
    body.workingDirectory,
    "workingDirectory",
    maxWorkingDirectoryLength,
  );

  if (!workingDirectoryValidation.ok) {
    return workingDirectoryValidation;
  }

  const defaultProfile = context
    .getModelProfiles()
    .find((profile) => profile.id === "agentic");
  const providerId = body.providerId?.trim() || defaultProfile?.providerId;
  const modelId = body.modelId?.trim() || defaultProfile?.modelId;

  if (!providerId || !modelId) {
    return { ok: false, error: "providerId and modelId are required" };
  }

  if (!getLlmProvider(providerId)) {
    return { ok: false, error: "Unknown LLM provider" };
  }

  const parametersValidation = body.parameters
    ? validateGenerationParameters(body.parameters)
    : { ok: true as const, parameters: {} };

  if (!parametersValidation.ok) {
    return parametersValidation;
  }

  return {
    ok: true,
    input: {
      name: name.value,
      prompt: prompt.value,
      cronExpression: cronExpression.value,
      timezone: timezoneValidation.value,
      workingDirectory: workingDirectoryValidation.value,
      providerId,
      modelId,
      parameters: {
        temperature: parametersValidation.parameters.temperature ?? defaultProfile?.parameters.temperature ?? null,
        topP: parametersValidation.parameters.topP ?? defaultProfile?.parameters.topP ?? null,
        topK: parametersValidation.parameters.topK ?? defaultProfile?.parameters.topK ?? null,
        contextSize:
          parametersValidation.parameters.contextSize ?? defaultProfile?.parameters.contextSize ?? null,
      },
      allowOverlap: body.allowOverlap === true,
      enabled: body.enabled !== false,
    },
  };
}

function validateUpdateRequest(
  body: ScheduledTaskUpdateRequest | null,
  context: ServerContext,
): { ok: true; update: ScheduledTaskUpdate } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Scheduled task payload must be an object" };
  }

  const update: ScheduledTaskUpdate = {};

  if (Object.hasOwn(body, "name")) {
    const name = requiredString(body.name, "name", maxNameLength);

    if (!name.ok) {
      return name;
    }

    update.name = name.value;
  }

  if (Object.hasOwn(body, "prompt")) {
    const prompt = requiredString(body.prompt, "prompt", maxPromptLength);

    if (!prompt.ok) {
      return prompt;
    }

    update.prompt = prompt.value;
  }

  if (Object.hasOwn(body, "cronExpression")) {
    const cronExpression = requiredString(body.cronExpression, "cronExpression", maxCronLength);

    if (!cronExpression.ok) {
      return cronExpression;
    }

    const cronValidation = validateCronExpression(cronExpression.value);

    if (!cronValidation.ok) {
      return cronValidation;
    }

    update.cronExpression = cronExpression.value;
  }

  if (Object.hasOwn(body, "timezone")) {
    const timezoneValidation = optionalString(body.timezone, "timezone", maxTimezoneLength);

    if (!timezoneValidation.ok) {
      return timezoneValidation;
    }

    update.timezone = timezoneValidation.value;
  }

  if (Object.hasOwn(body, "workingDirectory")) {
    const workingDirectoryValidation = optionalString(
      body.workingDirectory,
      "workingDirectory",
      maxWorkingDirectoryLength,
    );

    if (!workingDirectoryValidation.ok) {
      return workingDirectoryValidation;
    }

    update.workingDirectory = workingDirectoryValidation.value;
  }

  if (Object.hasOwn(body, "providerId")) {
    if (typeof body.providerId !== "string" || !body.providerId.trim()) {
      return { ok: false, error: "providerId must be a non-empty string" };
    }

    if (!getLlmProvider(body.providerId.trim())) {
      return { ok: false, error: "Unknown LLM provider" };
    }

    update.providerId = body.providerId.trim();
  }

  if (Object.hasOwn(body, "modelId")) {
    if (typeof body.modelId !== "string" || !body.modelId.trim()) {
      return { ok: false, error: "modelId must be a non-empty string" };
    }

    update.modelId = body.modelId.trim();
  }

  if (Object.hasOwn(body, "parameters") && body.parameters) {
    const parameters = validateGenerationParameters(body.parameters);

    if (!parameters.ok) {
      return parameters;
    }

    update.parameters = parameters.parameters;
  }

  if (Object.hasOwn(body, "allowOverlap")) {
    update.allowOverlap = body.allowOverlap === true;
  }

  if (Object.hasOwn(body, "enabled")) {
    update.enabled = body.enabled !== false;
  }

  void context;

  return { ok: true, update };
}

function validateCronExpression(value: string): { ok: true } | { ok: false; error: string } {
  try {
    new CronPattern(value);
    return { ok: true };
  } catch (caught) {
    return {
      ok: false,
      error: `Invalid cron expression: ${caught instanceof Error ? caught.message : String(caught)}`,
    };
  }
}

function requiredString(
  value: unknown,
  name: string,
  maxLength: number,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, error: `${name} is required` };
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    return { ok: false, error: `${name} is too long` };
  }

  return { ok: true, value: trimmed };
}

function optionalString(
  value: unknown,
  name: string,
  maxLength: number,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false, error: `${name} must be a string or null` };
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    return { ok: false, error: `${name} is too long` };
  }

  return { ok: true, value: trimmed || null };
}
