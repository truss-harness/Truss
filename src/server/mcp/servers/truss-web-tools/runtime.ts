import { SecretEnvStore } from "../../../config/env.ts";
import {
  getLlmProviderSettingsDefaults,
  summarizeLlmProviders,
} from "../../../llm/registry.ts";
import { getLlmModelProfileDefaults } from "../../../llm/model-profiles.ts";
import { ensureTrussHome } from "../../../setup/truss-home.ts";
import { openAppDatabase, type AppDatabase } from "../../../storage/database.ts";
import { ModelProfilesRepository } from "../../../storage/model-profiles.ts";
import { SettingsRepository } from "../../../storage/settings.ts";
import type { TrussWebToolRuntime } from "../../../tools/truss-web-tools.ts";
import {
  acquireCamoufoxBrowser,
  type CamoufoxBrowser,
  type CamoufoxBrowserLease,
} from "../../../utils/camoufox-browser.ts";

export interface TrussWebToolsMcpRuntime {
  close(): Promise<void>;
  runtime: TrussWebToolRuntime;
}

export async function createTrussWebToolsMcpRuntime(
  trussHomeDir?: string,
): Promise<TrussWebToolsMcpRuntime> {
  const trussHome = await ensureTrussHome(trussHomeDir, {
    log: (message) => console.error(message),
  });
  const database = openAppDatabase(trussHome.dbPath);
  const settings = new SettingsRepository(database.db);
  const modelProfiles = new ModelProfilesRepository(database.db);
  const secretEnv = new SecretEnvStore({
    envPath: trussHome.envPath,
    envKeysPath: trussHome.envKeysPath,
  });
  const log = (channel: string, message: string, metadata?: Record<string, unknown>) => {
    const details = metadata ? ` ${safeJson(metadata)}` : "";

    console.error(`[${channel}] ${message}${details}`);
  };

  secretEnv.load();
  settings.ensureLlmProviders(getLlmProviderSettingsDefaults());
  modelProfiles.ensureModelProfiles(getLlmModelProfileDefaults());

  let browser: CamoufoxBrowser | null = null;
  let browserLease: CamoufoxBrowserLease | null = null;

  try {
    browserLease = await acquireCamoufoxBrowser({
      env: secretEnv.mergedWithProcessEnv(),
      log,
      shared: true,
      trussHomeDir: trussHome.dir,
    });
    browser = browserLease.browser;
  } catch (caught) {
    closeDatabase(database);
    throw caught;
  }

  return {
    close: async () => {
      try {
        await browserLease?.close();
      } finally {
        closeDatabase(database);
      }
    },
    runtime: {
      getBrowser: () => browser,
      getLlmProviders: () =>
        summarizeLlmProviders({
          env: secretEnv.mergedWithProcessEnv(),
          secretEnv,
          settings: settings.listLlmProviderSettingsMap(),
        }),
      getModelProfile: (profileId) => modelProfiles.getModelProfile(profileId),
      getSecretEnv: () => secretEnv.mergedWithProcessEnv(),
      getTrussHomeDir: () => trussHome.dir,
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
