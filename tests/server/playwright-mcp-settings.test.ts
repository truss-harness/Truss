import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { ensureGlobalMcpConfig } from "../../src/server/mcp/global-config.ts";
import { ensureTrussHome } from "../../src/server/setup/truss-home.ts";
import { openAppDatabase, type AppDatabase } from "../../src/server/storage/database.ts";
import { McpSettingsRepository } from "../../src/server/storage/mcp-settings.ts";

describe("Playwright MCP settings", () => {
  it("keeps the managed Playwright MCP server disabled until explicitly enabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-playwright-mcp-settings-"));
    let database: AppDatabase | null = null;

    try {
      const trussHome = await ensureTrussHome(join(root, "home"), { log: () => undefined });
      const workspace = resolve(root, "workspace");

      await mkdir(workspace);
      database = openAppDatabase(trussHome.dbPath);

      const settings = new McpSettingsRepository(database.db);

      settings.ensureMcpSettings();
      database.db
        .query(
          "UPDATE mcp_settings SET playwright_mcp_headless = 0, playwright_mcp_shared_browser = 0 WHERE id = 1",
        )
        .run();
      expect(settings.getMcpSettings().playwrightMcp).toEqual({
        enabled: false,
        tools: "*",
      });

      await ensureGlobalMcpConfig({
        conversationWorkspacePath: null,
        mcpSettings: settings,
        projectRoot: process.cwd(),
        trussHome,
        workspacePath: workspace,
      });

      const disabledConfig = await readMcpConfig(trussHome.mcpConfigPath);
      const disabledServer = disabledConfig.mcpServers["truss-playwright-mcp"];

      expect(disabledServer?.disabled).toBe(true);
      expect(disabledServer?._trussDisabledReason).toContain("disabled by default");

      settings.updateMcpSettings({
        playwrightMcp: {
          enabled: true,
          tools: "browser_navigate, browser_click",
        },
      });

      await ensureGlobalMcpConfig({
        conversationWorkspacePath: null,
        mcpSettings: settings,
        projectRoot: process.cwd(),
        trussHome,
        workspacePath: workspace,
      });

      const enabledConfig = await readMcpConfig(trussHome.mcpConfigPath);
      const enabledServer = enabledConfig.mcpServers["truss-playwright-mcp"];

      expect(enabledServer?.disabled).toBeUndefined();
      expect(enabledServer?.args).toContain("truss-playwright-mcp");
      expect(settings.getMcpSettings().playwrightMcp).toMatchObject({
        enabled: true,
        tools: "browser_navigate, browser_click",
      });
      expect(
        database.db
          .query(
            "SELECT playwright_mcp_headless AS headless, playwright_mcp_shared_browser AS sharedBrowser FROM mcp_settings WHERE id = 1",
          )
          .get(),
      ).toEqual({
        headless: 0,
        sharedBrowser: 0,
      });
    } finally {
      database?.db.close();
      await rm(root, { force: true, recursive: true });
    }
  });
});

async function readMcpConfig(path: string): Promise<{
  mcpServers: Record<string, { _trussDisabledReason?: string; args?: string[]; disabled?: boolean }>;
}> {
  return (await Bun.file(path).json()) as {
    mcpServers: Record<string, { _trussDisabledReason?: string; args?: string[]; disabled?: boolean }>;
  };
}
