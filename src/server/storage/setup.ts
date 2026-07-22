import type { Database } from "bun:sqlite";
import type {
  FirstRunSetupSummary,
  FirstRunSetupUpdateRequest,
} from "../../shared/protocol.ts";
import { normalizeOptionalText } from "./settings.ts";

interface FirstRunSetupRow {
  completed: number;
  nickname: string | null;
  preferred_language: string | null;
  location: string | null;
  model_catalog_url: string | null;
  show_workspace_sessions_in_global_view: number;
}

export class SetupRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  ensureSetup(): void {
    const now = new Date().toISOString();

    this.#db
      .query(
        `
          INSERT INTO first_run_setup (
            id,
            completed,
            nickname,
            preferred_language,
            location,
            model_catalog_url,
            show_workspace_sessions_in_global_view,
            created_at,
            updated_at
          )
          VALUES (1, 0, NULL, NULL, NULL, NULL, 0, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `,
      )
      .run(now, now);
  }

  getSetup(): FirstRunSetupSummary {
    this.ensureSetup();

    const row = this.#db
      .query(
        `
          SELECT completed, nickname, preferred_language, location, model_catalog_url,
                 show_workspace_sessions_in_global_view
          FROM first_run_setup
          WHERE id = 1
        `,
      )
      .get() as FirstRunSetupRow | null;

    if (!row) {
      throw new Error("First-run setup row was not created");
    }

    return rowToSetup(row);
  }

  updateSetup(update: FirstRunSetupUpdateRequest): FirstRunSetupSummary {
    const current = this.getSetup();
    const next: FirstRunSetupSummary = {
      completed: update.completed ?? current.completed,
      nickname: Object.hasOwn(update, "nickname")
        ? normalizeOptionalText(update.nickname)
        : current.nickname,
      preferredLanguage: Object.hasOwn(update, "preferredLanguage")
        ? normalizeOptionalText(update.preferredLanguage)
        : current.preferredLanguage,
      location: Object.hasOwn(update, "location")
        ? normalizeOptionalText(update.location)
        : current.location,
      modelCatalogUrl: Object.hasOwn(update, "modelCatalogUrl")
        ? normalizeOptionalText(update.modelCatalogUrl)
        : current.modelCatalogUrl,
      showWorkspaceSessionsInGlobalView: Object.hasOwn(
        update,
        "showWorkspaceSessionsInGlobalView",
      )
        ? update.showWorkspaceSessionsInGlobalView === true
        : current.showWorkspaceSessionsInGlobalView,
    };

    this.#db
      .query(
        `
          UPDATE first_run_setup
          SET completed = ?,
              nickname = ?,
              preferred_language = ?,
              location = ?,
              model_catalog_url = ?,
              show_workspace_sessions_in_global_view = ?,
              updated_at = ?
          WHERE id = 1
        `,
      )
      .run(
        next.completed ? 1 : 0,
        next.nickname,
        next.preferredLanguage,
        next.location,
        next.modelCatalogUrl,
        next.showWorkspaceSessionsInGlobalView ? 1 : 0,
        new Date().toISOString(),
      );

    return next;
  }
}

function rowToSetup(row: FirstRunSetupRow): FirstRunSetupSummary {
  return {
    completed: row.completed === 1,
    nickname: normalizeOptionalText(row.nickname),
    preferredLanguage: normalizeOptionalText(row.preferred_language),
    location: normalizeOptionalText(row.location),
    modelCatalogUrl: normalizeOptionalText(row.model_catalog_url),
    showWorkspaceSessionsInGlobalView: row.show_workspace_sessions_in_global_view === 1,
  };
}
