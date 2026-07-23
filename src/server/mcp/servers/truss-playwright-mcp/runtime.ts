import { ensureTrussHome } from "../../../setup/truss-home.ts";
import { openAppDatabase, type AppDatabase } from "../../../storage/database.ts";
import {
  defaultPlaywrightMcpSettings,
  McpSettingsRepository,
} from "../../../storage/mcp-settings.ts";
import { connectCamoufoxBrowserBroker } from "../../../browser/broker-client.ts";
import type { CamoufoxBrowser } from "../../../utils/camoufox-browser.ts";
import { clearBrowserBrokerCredentialsFromEnv } from "../../../browser/broker-protocol.ts";
import type { PlaywrightMcpSettingsSummary } from "../../../../shared/protocol.ts";

export interface TrussPlaywrightMcpRuntime {
  close(): Promise<void>;
  runtime: TrussPlaywrightMcpRuntimeState;
}

export interface TrussPlaywrightMcpRuntimeState {
  getBrowser(): CamoufoxBrowser | null;
  getSettings(): PlaywrightMcpSettingsSummary;
  log(channel: string, message: string, metadata?: Record<string, unknown>): void;
}

export async function createTrussPlaywrightMcpRuntime(
  trussHomeDir?: string,
): Promise<TrussPlaywrightMcpRuntime> {
  const trussHome = await ensureTrussHome(trussHomeDir, {
    log: (message) => console.error(message),
  });
  const database = openAppDatabase(trussHome.dbPath);
  const mcpSettings = new McpSettingsRepository(database.db);
  const log = (channel: string, message: string, metadata?: Record<string, unknown>) => {
    const details = metadata ? ` ${safeJson(metadata)}` : "";

    console.error(`[${channel}] ${message}${details}`);
  };

  mcpSettings.ensureMcpSettings();

  const settings = mcpSettings.getMcpSettings().playwrightMcp ?? {
    ...defaultPlaywrightMcpSettings,
  };
  let browser: CamoufoxBrowser;

  try {
    browser = await connectCamoufoxBrowserBroker({
      env: process.env,
    });
    clearBrowserBrokerCredentialsFromEnv(process.env);
  } catch (caught) {
    closeDatabase(database);
    throw caught;
  }

  return {
    close: async () => {
      try {
        await browser.close();
      } finally {
        closeDatabase(database);
      }
    },
    runtime: {
      getBrowser: () => browser,
      getSettings: () => settings,
      log,
    },
  };
}

function closeDatabase(database: AppDatabase): void {
  try {
    database.db.close();
  } catch {
    // Process shutdown should not be blocked by a failed close.
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
