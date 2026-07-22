import type { Database } from "bun:sqlite";
import type {
  PlantUmlRenderFormat,
  RichFeatureSettingsSummary,
} from "../../shared/protocol.ts";
import {
  defaultPlantUmlPrompt,
  defaultPlantUmlServerUrl,
} from "../../shared/rich-feature-defaults.ts";

export interface RichFeatureSettingsUpdate {
  agenticToolTurnLimit?: number;
  agenticToolTurnLimitEnabled?: boolean;
  cardsEnabled?: boolean;
  calloutsEnabled?: boolean;
  followUpsEnabled?: boolean;
  katexEnabled?: boolean;
  plantUmlEnabled?: boolean;
  plantUmlFormat?: PlantUmlRenderFormat;
  plantUmlPrompt?: string;
  plantUmlServerUrl?: string;
  smartEventsEnabled?: boolean;
  smartEventsGoogleCalendarEnabled?: boolean;
  smartEventsIcsEnabled?: boolean;
  smartEventsOutlookCalendarEnabled?: boolean;
  smartTablesEnabled?: boolean;
  timelinesEnabled?: boolean;
}

interface RichFeatureSettingsRow {
  agentic_tool_turn_limit: number;
  agentic_tool_turn_limit_enabled: number;
  cards_enabled: number;
  callouts_enabled: number;
  follow_ups_enabled: number;
  katex_enabled: number;
  plantuml_enabled: number;
  plantuml_format: string;
  plantuml_prompt: string;
  plantuml_server_url: string;
  smart_events_enabled: number;
  smart_events_google_calendar_enabled: number;
  smart_events_ics_enabled: number;
  smart_events_outlook_calendar_enabled: number;
  smart_tables_enabled: number;
  timelines_enabled: number;
}

export class RichFeatureSettingsRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  ensureRichFeatureSettings(): void {
    const now = new Date().toISOString();

    this.#db
      .query(
        `
          INSERT INTO rich_feature_settings (
            id,
            cards_enabled,
            callouts_enabled,
            follow_ups_enabled,
            timelines_enabled,
            smart_tables_enabled,
            smart_events_enabled,
            smart_events_google_calendar_enabled,
            smart_events_outlook_calendar_enabled,
            smart_events_ics_enabled,
            plantuml_enabled,
            plantuml_server_url,
            plantuml_format,
            plantuml_prompt,
            katex_enabled,
            created_at,
            updated_at
          )
          VALUES (1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, ?, 'svg', ?, 0, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `,
      )
      .run(defaultPlantUmlServerUrl, defaultPlantUmlPrompt, now, now);
  }

  getRichFeatureSettings(): RichFeatureSettingsSummary {
    this.ensureRichFeatureSettings();

    const row = this.#db
      .query(
        `
          SELECT
            agentic_tool_turn_limit,
            agentic_tool_turn_limit_enabled,
            callouts_enabled,
            cards_enabled,
            follow_ups_enabled,
            timelines_enabled,
            smart_tables_enabled,
            smart_events_enabled,
            smart_events_google_calendar_enabled,
            smart_events_outlook_calendar_enabled,
            smart_events_ics_enabled,
            plantuml_enabled,
            plantuml_server_url,
            plantuml_format,
            plantuml_prompt,
            katex_enabled
          FROM rich_feature_settings
          WHERE id = 1
        `,
      )
      .get() as RichFeatureSettingsRow | null;

    if (!row) {
      throw new Error("Rich feature settings row was not created");
    }

    return rowToRichFeatureSettings(row);
  }

  updateRichFeatureSettings(update: RichFeatureSettingsUpdate): RichFeatureSettingsSummary {
    const current = this.getRichFeatureSettings();
    const next: RichFeatureSettingsSummary = {
      ...current,
      agenticToolTurnLimit:
        update.agenticToolTurnLimit ?? current.agenticToolTurnLimit,
      agenticToolTurnLimitEnabled:
        update.agenticToolTurnLimitEnabled ?? current.agenticToolTurnLimitEnabled,
      cardsEnabled: update.cardsEnabled ?? current.cardsEnabled,
      calloutsEnabled: update.calloutsEnabled ?? current.calloutsEnabled,
      followUpsEnabled: update.followUpsEnabled ?? current.followUpsEnabled,
      katexEnabled: update.katexEnabled ?? current.katexEnabled,
      plantUmlEnabled: update.plantUmlEnabled ?? current.plantUmlEnabled,
      plantUmlFormat: update.plantUmlFormat ?? current.plantUmlFormat,
      plantUmlPrompt:
        update.plantUmlPrompt === undefined
          ? current.plantUmlPrompt
          : normalizeInstructionText(update.plantUmlPrompt),
      plantUmlServerUrl:
        update.plantUmlServerUrl === undefined
          ? current.plantUmlServerUrl
          : normalizePlantUmlServerUrl(update.plantUmlServerUrl),
      smartEventsEnabled: update.smartEventsEnabled ?? current.smartEventsEnabled,
      smartEventsGoogleCalendarEnabled:
        update.smartEventsGoogleCalendarEnabled ??
        current.smartEventsGoogleCalendarEnabled,
      smartEventsIcsEnabled:
        update.smartEventsIcsEnabled ?? current.smartEventsIcsEnabled,
      smartEventsOutlookCalendarEnabled:
        update.smartEventsOutlookCalendarEnabled ??
        current.smartEventsOutlookCalendarEnabled,
      smartTablesEnabled: update.smartTablesEnabled ?? current.smartTablesEnabled,
      timelinesEnabled: update.timelinesEnabled ?? current.timelinesEnabled,
    };

    this.#db
      .query(
        `
          UPDATE rich_feature_settings
          SET agentic_tool_turn_limit_enabled = ?,
              agentic_tool_turn_limit = ?,
              cards_enabled = ?,
              callouts_enabled = ?,
              follow_ups_enabled = ?,
              timelines_enabled = ?,
              smart_tables_enabled = ?,
              smart_events_enabled = ?,
              smart_events_google_calendar_enabled = ?,
              smart_events_outlook_calendar_enabled = ?,
              smart_events_ics_enabled = ?,
              plantuml_enabled = ?,
              plantuml_server_url = ?,
              plantuml_format = ?,
              plantuml_prompt = ?,
              katex_enabled = ?,
              updated_at = ?
          WHERE id = 1
        `,
      )
      .run(
        next.agenticToolTurnLimitEnabled ? 1 : 0,
        next.agenticToolTurnLimit,
        next.cardsEnabled ? 1 : 0,
        next.calloutsEnabled ? 1 : 0,
        next.followUpsEnabled ? 1 : 0,
        next.timelinesEnabled ? 1 : 0,
        next.smartTablesEnabled ? 1 : 0,
        next.smartEventsEnabled ? 1 : 0,
        next.smartEventsGoogleCalendarEnabled ? 1 : 0,
        next.smartEventsOutlookCalendarEnabled ? 1 : 0,
        next.smartEventsIcsEnabled ? 1 : 0,
        next.plantUmlEnabled ? 1 : 0,
        next.plantUmlServerUrl,
        next.plantUmlFormat,
        next.plantUmlPrompt,
        next.katexEnabled ? 1 : 0,
        new Date().toISOString(),
      );

    return next;
  }
}

function rowToRichFeatureSettings(row: RichFeatureSettingsRow): RichFeatureSettingsSummary {
  return {
    agenticToolTurnLimit: row.agentic_tool_turn_limit,
    agenticToolTurnLimitEnabled: row.agentic_tool_turn_limit_enabled === 1,
    cardsEnabled: row.cards_enabled === 1,
    calloutsEnabled: row.callouts_enabled === 1,
    followUpsEnabled: row.follow_ups_enabled === 1,
    katexEnabled: row.katex_enabled === 1,
    plantUmlEnabled: row.plantuml_enabled === 1,
    plantUmlFormat: row.plantuml_format === "png" ? "png" : "svg",
    plantUmlPrompt: normalizeInstructionText(row.plantuml_prompt),
    plantUmlServerUrl: normalizePlantUmlServerUrl(row.plantuml_server_url),
    smartEventsEnabled: row.smart_events_enabled === 1,
    smartEventsGoogleCalendarEnabled:
      row.smart_events_google_calendar_enabled === 1,
    smartEventsIcsEnabled: row.smart_events_ics_enabled === 1,
    smartEventsOutlookCalendarEnabled:
      row.smart_events_outlook_calendar_enabled === 1,
    smartTablesEnabled: row.smart_tables_enabled === 1,
    timelinesEnabled: row.timelines_enabled === 1,
  };
}

export function normalizePlantUmlServerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/g, "");
  return trimmed || defaultPlantUmlServerUrl;
}

function normalizeInstructionText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}
