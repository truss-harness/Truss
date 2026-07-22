import type {
  ApiError,
  LlmGenerationParameters,
  LlmModelProfileId,
  LlmModelProfilesResponse,
  LlmModelProfileUpdateRequest,
} from "../../shared/protocol.ts";
import { getLlmProvider } from "../llm/registry.ts";
import type { LlmModelProfileUpdate } from "../storage/model-profiles.ts";
import { json, readJson } from "./responses.ts";
import type { ServerContext } from "./context.ts";

const modelProfileIds: LlmModelProfileId[] = ["fast-helper", "conversation", "agentic"];
const maxModelLength = 160;

export async function handleModelProfilesRoute(
  request: Request,
  context: ServerContext,
  profileId: string | null,
): Promise<Response> {
  if (!profileId && request.method === "GET") {
    return modelProfilesResponse(context);
  }

  if (!profileId) {
    return json<ApiError>({ error: "Model profile id is required" }, { status: 400 });
  }

  if (!isModelProfileId(profileId)) {
    return json<ApiError>({ error: "Unknown model profile" }, { status: 404 });
  }

  if (request.method !== "PATCH" && request.method !== "PUT") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJson<LlmModelProfileUpdateRequest>(request);
  const validation = validateModelProfileUpdate(body);

  if (!validation.ok) {
    return json<ApiError>({ error: validation.error }, { status: 400 });
  }

  if (validation.update.providerId && !getLlmProvider(validation.update.providerId)) {
    return json<ApiError>({ error: "Unknown LLM provider" }, { status: 400 });
  }

  context.modelProfiles.updateModelProfile(profileId, validation.update);
  return modelProfilesResponse(context);
}

function modelProfilesResponse(context: ServerContext): Response {
  return json<LlmModelProfilesResponse>({
    profiles: context.getModelProfiles(),
  });
}

function validateModelProfileUpdate(
  body: LlmModelProfileUpdateRequest | null,
): { ok: true; update: LlmModelProfileUpdate } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Model profile payload must be an object" };
  }

  const update: LlmModelProfileUpdate = {};

  if (Object.hasOwn(body, "providerId")) {
    if (typeof body.providerId !== "string" || !body.providerId.trim()) {
      return { ok: false, error: "providerId must be a non-empty string" };
    }

    update.providerId = body.providerId.trim();
  }

  if (Object.hasOwn(body, "modelId")) {
    if (typeof body.modelId !== "string" || !body.modelId.trim()) {
      return { ok: false, error: "modelId must be a non-empty string" };
    }

    const modelId = body.modelId.trim();

    if (modelId.length > maxModelLength) {
      return { ok: false, error: "modelId is too long" };
    }

    update.modelId = modelId;
  }

  if (Object.hasOwn(body, "parameters")) {
    const parameters = validateGenerationParameters(body.parameters);

    if (!parameters.ok) {
      return parameters;
    }

    update.parameters = parameters.parameters;
  }

  return { ok: true, update };
}

export function validateGenerationParameters(
  parameters: Partial<LlmGenerationParameters> | null | undefined,
):
  | { ok: true; parameters: Partial<LlmGenerationParameters> }
  | { ok: false; error: string } {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    return { ok: false, error: "parameters must be an object" };
  }

  const next: Partial<LlmGenerationParameters> = {};

  if (Object.hasOwn(parameters, "temperature")) {
    const value = validateNullableNumber(parameters.temperature, "temperature", 0, 2);

    if (!value.ok) {
      return value;
    }

    next.temperature = value.value;
  }

  if (Object.hasOwn(parameters, "topP")) {
    const value = validateNullableNumber(parameters.topP, "topP", 0, 1);

    if (!value.ok) {
      return value;
    }

    next.topP = value.value;
  }

  if (Object.hasOwn(parameters, "topK")) {
    const value = validateNullableInteger(parameters.topK, "topK", 0, Number.MAX_SAFE_INTEGER);

    if (!value.ok) {
      return value;
    }

    next.topK = value.value;
  }

  if (Object.hasOwn(parameters, "contextSize")) {
    const value = validateNullableInteger(
      parameters.contextSize,
      "contextSize",
      1,
      Number.MAX_SAFE_INTEGER,
    );

    if (!value.ok) {
      return value;
    }

    next.contextSize = value.value;
  }

  return { ok: true, parameters: next };
}

export function isModelProfileId(value: string): value is LlmModelProfileId {
  return modelProfileIds.includes(value as LlmModelProfileId);
}

function validateNullableNumber(
  value: unknown,
  name: string,
  min: number,
  max: number,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === null) {
    return { ok: true, value: null };
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    return { ok: false, error: `${name} must be a number from ${min} to ${max}, or null` };
  }

  return { ok: true, value };
}

function validateNullableInteger(
  value: unknown,
  name: string,
  min: number,
  max: number,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const numberValue = validateNullableNumber(value, name, min, max);

  if (!numberValue.ok || numberValue.value === null) {
    return numberValue;
  }

  if (!Number.isInteger(numberValue.value)) {
    return { ok: false, error: `${name} must be an integer, or null` };
  }

  return numberValue;
}
