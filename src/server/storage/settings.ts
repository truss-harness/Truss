import type { Database } from "bun:sqlite";

export interface LlmProviderSettings {
  providerId: string;
  enabled: boolean;
  baseUrl: string | null;
  defaultModel: string | null;
  models: string[];
}

export interface LlmProviderSettingsDefaults {
  providerId: string;
  enabled: boolean;
  baseUrl: string | null;
  defaultModel: string | null;
  models: string[];
}

export interface LlmProviderSettingsUpdate {
  enabled?: boolean;
  baseUrl?: string | null;
  defaultModel?: string | null;
  models?: string[];
}

interface LlmProviderSettingsRow {
  provider_id: string;
  enabled: number;
  base_url: string | null;
  default_model: string | null;
  models_json: string;
}

export class SettingsRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  ensureLlmProviders(defaults: LlmProviderSettingsDefaults[]): void {
    const insert = this.#db.query(`
      INSERT INTO llm_provider_settings (
        provider_id,
        enabled,
        base_url,
        default_model,
        models_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_id) DO NOTHING
    `);

    const seed = this.#db.transaction((items: LlmProviderSettingsDefaults[]) => {
      const now = new Date().toISOString();

      for (const item of items) {
        insert.run(
          item.providerId,
          item.enabled ? 1 : 0,
          normalizeOptionalText(item.baseUrl),
          normalizeOptionalText(item.defaultModel),
          JSON.stringify(normalizeModels(item.models)),
          now,
          now,
        );
      }
    });

    seed(defaults);
  }

  listLlmProviderSettings(): LlmProviderSettings[] {
    const rows = this.#db
      .query("SELECT provider_id, enabled, base_url, default_model, models_json FROM llm_provider_settings")
      .all() as LlmProviderSettingsRow[];

    return rows.map(rowToSettings);
  }

  listLlmProviderSettingsMap(): Map<string, LlmProviderSettings> {
    return new Map(
      this.listLlmProviderSettings().map((settings) => [settings.providerId, settings]),
    );
  }

  getLlmProviderSettings(providerId: string): LlmProviderSettings | null {
    const row = this.#db
      .query(
        "SELECT provider_id, enabled, base_url, default_model, models_json FROM llm_provider_settings WHERE provider_id = ?",
      )
      .get(providerId) as LlmProviderSettingsRow | null;

    return row ? rowToSettings(row) : null;
  }

  updateLlmProviderSettings(
    providerId: string,
    update: LlmProviderSettingsUpdate,
  ): LlmProviderSettings {
    const current = this.getLlmProviderSettings(providerId);

    if (!current) {
      throw new Error(`Unknown LLM provider settings row: ${providerId}`);
    }

    const next: LlmProviderSettings = {
      providerId,
      enabled: update.enabled ?? current.enabled,
      baseUrl:
        Object.hasOwn(update, "baseUrl") ? normalizeOptionalText(update.baseUrl) : current.baseUrl,
      defaultModel: Object.hasOwn(update, "defaultModel")
        ? normalizeOptionalText(update.defaultModel)
        : current.defaultModel,
      models: Object.hasOwn(update, "models") ? normalizeModels(update.models ?? []) : current.models,
    };

    this.#db
      .query(`
        UPDATE llm_provider_settings
        SET enabled = ?,
            base_url = ?,
            default_model = ?,
            models_json = ?,
            updated_at = ?
        WHERE provider_id = ?
      `)
      .run(
        next.enabled ? 1 : 0,
        next.baseUrl,
        next.defaultModel,
        JSON.stringify(next.models),
        new Date().toISOString(),
        providerId,
      );

    return next;
  }
}

export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeModels(models: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const model of models) {
    const trimmed = model.trim();

    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function rowToSettings(row: LlmProviderSettingsRow): LlmProviderSettings {
  return {
    providerId: row.provider_id,
    enabled: row.enabled === 1,
    baseUrl: normalizeOptionalText(row.base_url),
    defaultModel: normalizeOptionalText(row.default_model),
    models: parseModels(row.models_json),
  };
}

function parseModels(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? normalizeModels(parsed.filter((item): item is string => typeof item === "string"))
      : [];
  } catch {
    return [];
  }
}
