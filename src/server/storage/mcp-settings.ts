import type { Database } from "bun:sqlite";
import type {
  CommandRunnerGuardAction,
  CommandRunnerSettingsSummary,
  McpSettingsSummary,
  McpSettingsUpdateRequest,
  PlaywrightMcpSettingsSummary,
} from "../../shared/protocol.ts";
import { normalizeOptionalText } from "./settings.ts";

interface McpSettingsRow {
  command_runner_dangerous_action: string;
  command_runner_guard_model_id: string | null;
  command_runner_guard_provider_id: string | null;
  command_runner_post_guard_enabled: boolean | number;
  command_runner_pre_guard_enabled: boolean | number;
  command_runner_risky_action: string;
  command_runner_safe_action: string;
  id: 1;
  playwright_mcp_enabled: boolean | number;
  playwright_mcp_tools: string;
  sanitizer_model_id: string | null;
  sanitizer_provider_id: string | null;
}

export const defaultCommandRunnerSettings: CommandRunnerSettingsSummary = {
  dangerousAction: "ask",
  guardModelId: null,
  guardProviderId: null,
  postExecutionGuardEnabled: true,
  preExecutionGuardEnabled: true,
  riskyAction: "ask",
  safeAction: "auto-allow",
};

export const defaultPlaywrightMcpSettings: PlaywrightMcpSettingsSummary = {
  enabled: false,
  tools: "*",
};

export class McpSettingsRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  ensureMcpSettings(): void {
    this.#db
      .query(
        `
          INSERT INTO mcp_settings (
            id,
            sanitizer_provider_id,
            sanitizer_model_id,
            command_runner_guard_provider_id,
            command_runner_guard_model_id,
            command_runner_pre_guard_enabled,
            command_runner_post_guard_enabled,
            command_runner_safe_action,
            command_runner_risky_action,
            command_runner_dangerous_action,
            playwright_mcp_enabled,
            playwright_mcp_tools,
            created_at,
            updated_at
          )
          VALUES (1, NULL, NULL, NULL, NULL, 1, 1, 'auto-allow', 'ask', 'ask', 0, '*', ?, ?)
          ON CONFLICT(id) DO NOTHING
        `,
      )
      .run(new Date().toISOString(), new Date().toISOString());
  }

  getMcpSettings(): McpSettingsSummary {
    const row = this.#db
      .query(
        `
          SELECT
            id,
            sanitizer_provider_id,
            sanitizer_model_id,
            command_runner_guard_provider_id,
            command_runner_guard_model_id,
            command_runner_pre_guard_enabled,
            command_runner_post_guard_enabled,
            command_runner_safe_action,
            command_runner_risky_action,
            command_runner_dangerous_action,
            playwright_mcp_enabled,
            playwright_mcp_tools
          FROM mcp_settings
          WHERE id = 1
        `,
      )
      .get() as McpSettingsRow | null;

    return row
      ? rowToSummary(row)
      : {
          commandRunner: { ...defaultCommandRunnerSettings },
          playwrightMcp: { ...defaultPlaywrightMcpSettings },
          sanitizerModelId: null,
          sanitizerProviderId: null,
        };
  }

  updateMcpSettings(update: McpSettingsUpdateRequest): McpSettingsSummary {
    const current = this.getMcpSettings();
    const commandRunnerUpdate = update.commandRunner ?? {};
    const commandRunner: CommandRunnerSettingsSummary = {
      dangerousAction: Object.hasOwn(commandRunnerUpdate, "dangerousAction")
        ? normalizeGuardAction(commandRunnerUpdate.dangerousAction, current.commandRunner.dangerousAction)
        : current.commandRunner.dangerousAction,
      guardModelId: Object.hasOwn(commandRunnerUpdate, "guardModelId")
        ? normalizeOptionalText(commandRunnerUpdate.guardModelId)
        : current.commandRunner.guardModelId,
      guardProviderId: Object.hasOwn(commandRunnerUpdate, "guardProviderId")
        ? normalizeOptionalText(commandRunnerUpdate.guardProviderId)
        : current.commandRunner.guardProviderId,
      postExecutionGuardEnabled: Object.hasOwn(commandRunnerUpdate, "postExecutionGuardEnabled")
        ? commandRunnerUpdate.postExecutionGuardEnabled === true
        : current.commandRunner.postExecutionGuardEnabled,
      preExecutionGuardEnabled: Object.hasOwn(commandRunnerUpdate, "preExecutionGuardEnabled")
        ? commandRunnerUpdate.preExecutionGuardEnabled === true
        : current.commandRunner.preExecutionGuardEnabled,
      riskyAction: Object.hasOwn(commandRunnerUpdate, "riskyAction")
        ? normalizeGuardAction(commandRunnerUpdate.riskyAction, current.commandRunner.riskyAction)
        : current.commandRunner.riskyAction,
      safeAction: Object.hasOwn(commandRunnerUpdate, "safeAction")
        ? normalizeGuardAction(commandRunnerUpdate.safeAction, current.commandRunner.safeAction)
        : current.commandRunner.safeAction,
    };
    const playwrightMcpUpdate = update.playwrightMcp ?? {};
    const playwrightMcp: PlaywrightMcpSettingsSummary = {
      enabled: Object.hasOwn(playwrightMcpUpdate, "enabled")
        ? playwrightMcpUpdate.enabled === true
        : current.playwrightMcp.enabled,
      tools: Object.hasOwn(playwrightMcpUpdate, "tools")
        ? normalizePlaywrightMcpTools(playwrightMcpUpdate.tools)
        : current.playwrightMcp.tools,
    };
    const next: McpSettingsSummary = {
      commandRunner,
      playwrightMcp,
      sanitizerModelId: Object.hasOwn(update, "sanitizerModelId")
        ? normalizeOptionalText(update.sanitizerModelId)
        : current.sanitizerModelId,
      sanitizerProviderId: Object.hasOwn(update, "sanitizerProviderId")
        ? normalizeOptionalText(update.sanitizerProviderId)
        : current.sanitizerProviderId,
    };

    this.#db
      .query(
        `
          UPDATE mcp_settings
          SET sanitizer_provider_id = ?,
              sanitizer_model_id = ?,
              command_runner_guard_provider_id = ?,
              command_runner_guard_model_id = ?,
              command_runner_pre_guard_enabled = ?,
              command_runner_post_guard_enabled = ?,
              command_runner_safe_action = ?,
              command_runner_risky_action = ?,
              command_runner_dangerous_action = ?,
              playwright_mcp_enabled = ?,
              playwright_mcp_tools = ?,
              updated_at = ?
          WHERE id = 1
        `,
      )
      .run(
        next.sanitizerProviderId,
        next.sanitizerModelId,
        next.commandRunner.guardProviderId,
        next.commandRunner.guardModelId,
        next.commandRunner.preExecutionGuardEnabled ? 1 : 0,
        next.commandRunner.postExecutionGuardEnabled ? 1 : 0,
        next.commandRunner.safeAction,
        next.commandRunner.riskyAction,
        next.commandRunner.dangerousAction,
        next.playwrightMcp.enabled ? 1 : 0,
        next.playwrightMcp.tools,
        new Date().toISOString(),
      );

    return next;
  }
}

function rowToSummary(row: McpSettingsRow): McpSettingsSummary {
  return {
    commandRunner: {
      dangerousAction: normalizeGuardAction(
        row.command_runner_dangerous_action,
        defaultCommandRunnerSettings.dangerousAction,
      ),
      guardModelId: normalizeOptionalText(row.command_runner_guard_model_id),
      guardProviderId: normalizeOptionalText(row.command_runner_guard_provider_id),
      postExecutionGuardEnabled: row.command_runner_post_guard_enabled === true ||
        row.command_runner_post_guard_enabled === 1,
      preExecutionGuardEnabled: row.command_runner_pre_guard_enabled === true ||
        row.command_runner_pre_guard_enabled === 1,
      riskyAction: normalizeGuardAction(
        row.command_runner_risky_action,
        defaultCommandRunnerSettings.riskyAction,
      ),
      safeAction: normalizeGuardAction(
        row.command_runner_safe_action,
        defaultCommandRunnerSettings.safeAction,
      ),
    },
    playwrightMcp: {
      enabled: row.playwright_mcp_enabled === true || row.playwright_mcp_enabled === 1,
      tools: normalizePlaywrightMcpTools(row.playwright_mcp_tools),
    },
    sanitizerModelId: normalizeOptionalText(row.sanitizer_model_id),
    sanitizerProviderId: normalizeOptionalText(row.sanitizer_provider_id),
  };
}

function normalizeGuardAction(
  value: unknown,
  fallback: CommandRunnerGuardAction,
): CommandRunnerGuardAction {
  return value === "auto-allow" || value === "ask" || value === "auto-deny"
    ? value
    : fallback;
}

function normalizePlaywrightMcpTools(value: unknown): string {
  if (typeof value !== "string") {
    return defaultPlaywrightMcpSettings.tools;
  }

  const normalized = value
    .split(/[,\r\n]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .join(", ");

  return normalized || defaultPlaywrightMcpSettings.tools;
}
