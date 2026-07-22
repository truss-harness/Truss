import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { openAppDatabase, type AppDatabase } from "../../src/server/storage/database.ts";
import { SetupRepository } from "../../src/server/storage/setup.ts";

describe("setup settings", () => {
  it("hides workspace sessions in Global view by default and persists the toggle", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-setup-settings-"));
    let database: AppDatabase | null = null;

    try {
      database = openAppDatabase(join(root, "truss.db"));

      const setup = new SetupRepository(database.db);

      expect(setup.getSetup().showWorkspaceSessionsInGlobalView).toBe(false);
      expect(
        setup.updateSetup({ showWorkspaceSessionsInGlobalView: true })
          .showWorkspaceSessionsInGlobalView,
      ).toBe(true);
      expect(setup.getSetup().showWorkspaceSessionsInGlobalView).toBe(true);
      expect(setup.updateSetup({ nickname: "Ada" })).toMatchObject({
        nickname: "Ada",
        showWorkspaceSessionsInGlobalView: true,
      });
    } finally {
      database?.db.close();
      await rm(root, { force: true, recursive: true });
    }
  });
});
