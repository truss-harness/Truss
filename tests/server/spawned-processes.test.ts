import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { SpawnLifecycle } from "../../src/server/http/spawn-lifecycle.ts";
import { openAppDatabase, type AppDatabase } from "../../src/server/storage/database.ts";
import { SpawnedProcessesRepository } from "../../src/server/storage/spawned-processes.ts";

describe("spawned processes", () => {
  it("persists spawned-process summaries and removes them during shutdown", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-spawned-processes-"));
    let database: AppDatabase | null = null;

    try {
      database = openAppDatabase(join(root, "truss.db"));
      const processes = new SpawnedProcessesRepository(database.db);
      let serverStopped = false;
      let mcpClosed = false;
      let stopped = false;
      const lifecycle = new SpawnLifecycle({
        closeMcp: async () => {
          mcpClosed = true;
        },
        onStopped: () => {
          stopped = true;
        },
        port: 43123,
        processes,
        server: { stop: () => { serverStopped = true; } } as unknown as Bun.Server<undefined>,
        workspacePath: root,
      });

      processes.upsert({
        id: "stale-process",
        lastActiveAt: "2026-01-01T00:00:00.000Z",
        pid: 12345,
        port: 43123,
        startedAt: "2026-01-01T00:00:00.000Z",
        workspacePath: "C:\\stale",
      });
      lifecycle.start();

      expect(processes.list()).toEqual([
        expect.objectContaining({
          id: lifecycle.id,
          port: 43123,
          workspacePath: root,
        }),
      ]);

      await lifecycle.stop();

      expect(serverStopped).toBe(true);
      expect(mcpClosed).toBe(true);
      expect(stopped).toBe(true);
      expect(processes.list()).toEqual([]);
    } finally {
      database?.db.close();
      await rm(root, { force: true, recursive: true });
    }
  });
});
