import type { Database } from "bun:sqlite";
import type {
  LlmGenerationParameters,
  LlmModelProfileId,
} from "../../shared/protocol.ts";
import { normalizeOptionalText } from "./settings.ts";

export interface LlmModelProfile {
  id: LlmModelProfileId;
  label: string;
  description: string;
  providerId: string;
  modelId: string;
  parameters: LlmGenerationParameters;
}

export interface LlmModelProfileDefaults extends LlmModelProfile {}

export interface LlmModelProfileUpdate {
  providerId?: string;
  modelId?: string;
  parameters?: Partial<LlmGenerationParameters>;
}

interface LlmModelProfileRow {
  profile_id: LlmModelProfileId;
  label: string;
  description: string;
  provider_id: string;
  model_id: string;
  temperature: number | null;
  top_p: number | null;
  top_k: number | null;
  context_size: number | null;
}

export class ModelProfilesRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  ensureModelProfiles(defaults: LlmModelProfileDefaults[]): void {
    const insert = this.#db.query(`
      INSERT INTO llm_model_profiles (
        profile_id,
        label,
        description,
        provider_id,
        model_id,
        temperature,
        top_p,
        top_k,
        context_size,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        label = excluded.label,
        description = excluded.description
    `);

    const seed = this.#db.transaction((items: LlmModelProfileDefaults[]) => {
      const now = new Date().toISOString();

      for (const item of items) {
        insert.run(
          item.id,
          item.label,
          item.description,
          item.providerId,
          item.modelId,
          item.parameters.temperature,
          item.parameters.topP,
          item.parameters.topK,
          item.parameters.contextSize,
          now,
          now,
        );
      }
    });

    seed(defaults);
  }

  listModelProfiles(): LlmModelProfile[] {
    const rows = this.#db
      .query(
        `
          SELECT profile_id, label, description, provider_id, model_id,
                 temperature, top_p, top_k, context_size
          FROM llm_model_profiles
          ORDER BY
            CASE profile_id
              WHEN 'fast-helper' THEN 0
              WHEN 'conversation' THEN 1
              WHEN 'agentic' THEN 2
              ELSE 3
            END
        `,
      )
      .all() as LlmModelProfileRow[];

    return rows.map(rowToProfile);
  }

  getModelProfile(profileId: LlmModelProfileId): LlmModelProfile | null {
    const row = this.#db
      .query(
        `
          SELECT profile_id, label, description, provider_id, model_id,
                 temperature, top_p, top_k, context_size
          FROM llm_model_profiles
          WHERE profile_id = ?
        `,
      )
      .get(profileId) as LlmModelProfileRow | null;

    return row ? rowToProfile(row) : null;
  }

  updateModelProfile(
    profileId: LlmModelProfileId,
    update: LlmModelProfileUpdate,
  ): LlmModelProfile {
    const current = this.getModelProfile(profileId);

    if (!current) {
      throw new Error(`Unknown model profile: ${profileId}`);
    }

    const next: LlmModelProfile = {
      ...current,
      providerId: normalizeRequiredText(update.providerId, current.providerId),
      modelId: normalizeRequiredText(update.modelId, current.modelId),
      parameters: {
        ...current.parameters,
        ...normalizeGenerationParameterPatch(update.parameters ?? {}),
      },
    };

    this.#db
      .query(
        `
          UPDATE llm_model_profiles
          SET provider_id = ?,
              model_id = ?,
              temperature = ?,
              top_p = ?,
              top_k = ?,
              context_size = ?,
              updated_at = ?
          WHERE profile_id = ?
        `,
      )
      .run(
        next.providerId,
        next.modelId,
        next.parameters.temperature,
        next.parameters.topP,
        next.parameters.topK,
        next.parameters.contextSize,
        new Date().toISOString(),
        profileId,
      );

    return next;
  }
}

export function normalizeGenerationParameterPatch(
  parameters: Partial<LlmGenerationParameters>,
): Partial<LlmGenerationParameters> {
  const next: Partial<LlmGenerationParameters> = {};

  if (Object.hasOwn(parameters, "temperature")) {
    next.temperature = normalizeNullableNumber(parameters.temperature);
  }

  if (Object.hasOwn(parameters, "topP")) {
    next.topP = normalizeNullableNumber(parameters.topP);
  }

  if (Object.hasOwn(parameters, "topK")) {
    next.topK = normalizeNullableInteger(parameters.topK);
  }

  if (Object.hasOwn(parameters, "contextSize")) {
    next.contextSize = normalizeNullableInteger(parameters.contextSize);
  }

  return next;
}

function rowToProfile(row: LlmModelProfileRow): LlmModelProfile {
  return {
    id: row.profile_id,
    label: row.label,
    description: row.description,
    providerId: row.provider_id,
    modelId: row.model_id,
    parameters: {
      temperature: row.temperature,
      topP: row.top_p,
      topK: row.top_k,
      contextSize: row.context_size,
    },
  };
}

function normalizeRequiredText(value: string | null | undefined, fallback: string): string {
  return normalizeOptionalText(value) ?? fallback;
}

function normalizeNullableNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeNullableInteger(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.trunc(value);
}
