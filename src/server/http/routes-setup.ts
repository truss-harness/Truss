import type {
  ApiError,
  FirstRunSetupResponse,
  FirstRunSetupUpdateRequest,
  SetupLocationLookupResponse,
} from "../../shared/protocol.ts";
import { json, readJson } from "./responses.ts";
import type { ServerContext } from "./context.ts";

const maxNicknameLength = 80;
const maxLanguageLength = 80;
const maxLocationLength = 120;
const maxCatalogUrlLength = 500;
const locationLookupTimeoutMs = 8_000;
const ipApiUrl = "http://ip-api.com/json/";

export async function handleSetupLocationRoute(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    return json<SetupLocationLookupResponse>(await lookupLocation());
  } catch (caught) {
    return json<ApiError>(
      { error: caught instanceof Error ? caught.message : String(caught) },
      { status: 502 },
    );
  }
}

export async function handleSetupRoute(
  request: Request,
  context: ServerContext,
): Promise<Response> {
  if (request.method === "GET") {
    return setupResponse(context);
  }

  if (request.method !== "PATCH" && request.method !== "PUT") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJson<FirstRunSetupUpdateRequest>(request);
  const validation = validateSetupUpdate(body);

  if (!validation.ok) {
    return json<ApiError>({ error: validation.error }, { status: 400 });
  }

  context.setup.updateSetup(validation.update);
  return setupResponse(context);
}

function setupResponse(context: ServerContext): Response {
  return json<FirstRunSetupResponse>({
    setup: context.setup.getSetup(),
  });
}

async function lookupLocation(): Promise<SetupLocationLookupResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), locationLookupTimeoutMs);

  try {
    const response = await fetch(ipApiUrl, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Could not fetch location: ${response.status} ${response.statusText}`);
    }

    return parseLocationPayload(await response.json());
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") {
      throw new Error("Timed out while fetching location.");
    }

    throw caught;
  } finally {
    clearTimeout(timeout);
  }
}

function parseLocationPayload(payload: unknown): SetupLocationLookupResponse {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Location service returned an invalid response.");
  }

  const source = payload as Record<string, unknown>;
  const status = textProperty(source, "status");

  if (status !== "success") {
    throw new Error("Location service could not determine a location.");
  }

  const city = textProperty(source, "city");
  const regionName = textProperty(source, "regionName");
  const country = textProperty(source, "country");
  const location = [city, regionName, country].filter(Boolean).join(", ");

  if (!location) {
    throw new Error("Location service returned an empty location.");
  }

  return {
    city,
    country,
    location,
    regionName,
  };
}

function textProperty(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validateSetupUpdate(
  body: FirstRunSetupUpdateRequest | null,
): { ok: true; update: FirstRunSetupUpdateRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Setup payload must be an object" };
  }

  const update: FirstRunSetupUpdateRequest = {};

  if (Object.hasOwn(body, "completed")) {
    if (typeof body.completed !== "boolean") {
      return { ok: false, error: "completed must be a boolean" };
    }

    update.completed = body.completed;
  }

  if (Object.hasOwn(body, "showWorkspaceSessionsInGlobalView")) {
    if (typeof body.showWorkspaceSessionsInGlobalView !== "boolean") {
      return { ok: false, error: "showWorkspaceSessionsInGlobalView must be a boolean" };
    }

    update.showWorkspaceSessionsInGlobalView = body.showWorkspaceSessionsInGlobalView;
  }

  const nickname = validateOptionalText(body, "nickname", maxNicknameLength);

  if (!nickname.ok) {
    return nickname;
  }

  if (nickname.present) {
    update.nickname = nickname.value;
  }

  const preferredLanguage = validateOptionalText(
    body,
    "preferredLanguage",
    maxLanguageLength,
  );

  if (!preferredLanguage.ok) {
    return preferredLanguage;
  }

  if (preferredLanguage.present) {
    update.preferredLanguage = preferredLanguage.value;
  }

  const location = validateOptionalText(body, "location", maxLocationLength);

  if (!location.ok) {
    return location;
  }

  if (location.present) {
    update.location = location.value;
  }

  const modelCatalogUrl = validateOptionalText(body, "modelCatalogUrl", maxCatalogUrlLength);

  if (!modelCatalogUrl.ok) {
    return modelCatalogUrl;
  }

  if (modelCatalogUrl.present) {
    if (modelCatalogUrl.value && !isHttpUrl(modelCatalogUrl.value)) {
      return { ok: false, error: "modelCatalogUrl must be an HTTP or HTTPS URL" };
    }

    update.modelCatalogUrl = modelCatalogUrl.value;
  }

  return { ok: true, update };
}

function validateOptionalText(
  body: FirstRunSetupUpdateRequest,
  key: keyof FirstRunSetupUpdateRequest,
  maxLength: number,
):
  | { ok: true; present: false }
  | { ok: true; present: true; value: string | null }
  | { ok: false; error: string } {
  if (!Object.hasOwn(body, key)) {
    return { ok: true, present: false };
  }

  const value = body[key];

  if (value !== null && typeof value !== "string") {
    return { ok: false, error: `${key} must be a string or null` };
  }

  const trimmed = typeof value === "string" ? value.trim() : null;

  if (trimmed && trimmed.length > maxLength) {
    return { ok: false, error: `${key} is too long` };
  }

  return { ok: true, present: true, value: trimmed || null };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
