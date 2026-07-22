import type { Database } from "bun:sqlite";
import type { SystemPromptMode } from "../../shared/protocol.ts";

export interface SystemPromptSetting {
  mode: SystemPromptMode;
  template: string;
  updatedAt: string;
}

export interface SystemPromptSettingDefaults {
  mode: SystemPromptMode;
  template: string;
}

interface SystemPromptSettingRow {
  mode: SystemPromptMode;
  template: string;
  updated_at: string;
}

export class SystemPromptsRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  ensureSystemPrompts(defaults: SystemPromptSettingDefaults[]): void {
    const insert = this.#db.query(`
      INSERT INTO system_prompt_settings (
        mode,
        template,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?)
      ON CONFLICT(mode) DO NOTHING
    `);

    const seed = this.#db.transaction((items: SystemPromptSettingDefaults[]) => {
      const now = new Date().toISOString();

      for (const item of items) {
        insert.run(item.mode, item.template, now, now);
      }
    });

    seed(defaults);
  }

  listSystemPrompts(): SystemPromptSetting[] {
    const rows = this.#db
      .query(
        `
          SELECT mode, template, updated_at
          FROM system_prompt_settings
          ORDER BY
            CASE mode
              WHEN 'conversation' THEN 0
              WHEN 'agentic' THEN 1
              ELSE 2
            END
        `,
      )
      .all() as SystemPromptSettingRow[];

    return rows.map(rowToSystemPrompt);
  }

  getSystemPrompt(mode: SystemPromptMode): SystemPromptSetting | null {
    const row = this.#db
      .query(
        `
          SELECT mode, template, updated_at
          FROM system_prompt_settings
          WHERE mode = ?
        `,
      )
      .get(mode) as SystemPromptSettingRow | null;

    return row ? rowToSystemPrompt(row) : null;
  }

  updateSystemPrompt(mode: SystemPromptMode, template: string): SystemPromptSetting {
    const current = this.getSystemPrompt(mode);

    if (!current) {
      throw new Error(`Unknown system prompt mode: ${mode}`);
    }

    const updatedAt = new Date().toISOString();

    this.#db
      .query(
        `
          UPDATE system_prompt_settings
          SET template = ?,
              updated_at = ?
          WHERE mode = ?
        `,
      )
      .run(template, updatedAt, mode);

    return {
      mode,
      template,
      updatedAt,
    };
  }
}

function rowToSystemPrompt(row: SystemPromptSettingRow): SystemPromptSetting {
  return {
    mode: row.mode,
    template: row.template,
    updatedAt: row.updated_at,
  };
}
