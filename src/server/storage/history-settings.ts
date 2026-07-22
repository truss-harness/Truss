import type { Database } from "bun:sqlite";
import type { HistorySettingsSummary } from "../../shared/protocol.ts";

export interface HistorySettingsUpdate {
  includeThinkingHistory?: boolean;
  includeToolHistory?: boolean;
  limitReasoningBudget?: boolean;
  maxReasoningTimeSeconds?: number;
  maxReasoningWords?: number;
}

interface HistorySettingsRow {
  include_thinking_history: number;
  include_tool_history: number;
  limit_reasoning_budget: number;
  max_reasoning_time_seconds: number;
  max_reasoning_words: number;
}

export class HistorySettingsRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  ensureHistorySettings(): void {
    const now = new Date().toISOString();

    this.#db
      .query(
        `
          INSERT INTO conversation_history_settings (
            id,
            include_thinking_history,
            include_tool_history,
            limit_reasoning_budget,
            max_reasoning_time_seconds,
            max_reasoning_words,
            created_at,
            updated_at
          )
          VALUES (1, 0, 0, 0, 300, 10000, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `,
      )
      .run(now, now);
  }

  getHistorySettings(): HistorySettingsSummary {
    this.ensureHistorySettings();

    const row = this.#db
      .query(
        `
          SELECT
            include_thinking_history,
            include_tool_history,
            limit_reasoning_budget,
            max_reasoning_time_seconds,
            max_reasoning_words
          FROM conversation_history_settings
          WHERE id = 1
        `,
      )
      .get() as HistorySettingsRow | null;

    if (!row) {
      throw new Error("Conversation history settings row was not created");
    }

    return rowToHistorySettings(row);
  }

  updateHistorySettings(update: HistorySettingsUpdate): HistorySettingsSummary {
    const current = this.getHistorySettings();
    const next: HistorySettingsSummary = {
      ...current,
      includeThinkingHistory:
        update.includeThinkingHistory ?? current.includeThinkingHistory,
      includeToolHistory: update.includeToolHistory ?? current.includeToolHistory,
      limitReasoningBudget:
        update.limitReasoningBudget ?? current.limitReasoningBudget,
      maxReasoningTimeSeconds:
        update.maxReasoningTimeSeconds ?? current.maxReasoningTimeSeconds,
      maxReasoningWords: update.maxReasoningWords ?? current.maxReasoningWords,
    };

    this.#db
      .query(
        `
          UPDATE conversation_history_settings
          SET include_thinking_history = ?,
              include_tool_history = ?,
              limit_reasoning_budget = ?,
              max_reasoning_time_seconds = ?,
              max_reasoning_words = ?,
              updated_at = ?
          WHERE id = 1
        `,
      )
      .run(
        next.includeThinkingHistory ? 1 : 0,
        next.includeToolHistory ? 1 : 0,
        next.limitReasoningBudget ? 1 : 0,
        next.maxReasoningTimeSeconds,
        next.maxReasoningWords,
        new Date().toISOString(),
      );

    return next;
  }
}

function rowToHistorySettings(row: HistorySettingsRow): HistorySettingsSummary {
  return {
    includeThinkingHistory: row.include_thinking_history === 1,
    includeToolHistory: row.include_tool_history === 1,
    limitReasoningBudget: row.limit_reasoning_budget === 1,
    maxReasoningTimeSeconds: row.max_reasoning_time_seconds,
    maxReasoningWords: row.max_reasoning_words,
    thinkingHistoryAvailable: true,
    toolHistoryAvailable: false,
  };
}
