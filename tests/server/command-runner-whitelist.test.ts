import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  openAppDatabase,
  type AppDatabase,
} from "../../src/server/storage/database.ts";
import {
  CommandRunnerWhitelistRepository,
  defaultCommandRunnerWhitelistEntries,
} from "../../src/server/storage/command-runner-whitelist.ts";

describe("CommandRunnerWhitelistRepository", () => {
  it("matches prefix, glob, and regex entries and removes expired entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-command-whitelist-"));
    let database: AppDatabase | null = null;

    try {
      database = openAppDatabase(join(root, "truss.db"));
      const whitelist = new CommandRunnerWhitelistRepository(database.db);
      const expired = new Date(Date.now() - 1_000).toISOString();

      whitelist.replaceEntries([
        { pattern: "git ", type: "prefix" },
        { pattern: "npm run *", type: "glob" },
        { pattern: "^bun\\s+test\\s+", type: "regex" },
        { expiresAt: expired, pattern: "expired ", type: "prefix" },
      ]);

      expect(whitelist.matchingEntry("git status")?.type).toBe("prefix");
      expect(whitelist.matchingEntry("npm run check")?.type).toBe("glob");
      expect(whitelist.matchingEntry("bun test tests/server/foo.test.ts")?.type).toBe("regex");
      expect(whitelist.matchingEntry("expired command")).toBeNull();
      expect(whitelist.listEntries().some((entry) => entry.pattern === "expired ")).toBe(false);
    } finally {
      database?.db.close();
      await rm(root, { force: true, recursive: true });
    }
  });

  it("requires reasons for LLM-requested entries and validates regex patterns", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-command-whitelist-"));
    let database: AppDatabase | null = null;

    try {
      database = openAppDatabase(join(root, "truss.db"));
      const whitelist = new CommandRunnerWhitelistRepository(database.db);

      expect(() =>
        whitelist.addEntry({
          addedBy: "llm-request",
          expiry: "24-hours",
          pattern: "git ",
          reason: "",
          type: "prefix",
        }),
      ).toThrow("require a reason");
      expect(() =>
        whitelist.addEntry({
          addedBy: "user",
          expiry: "permanent",
          pattern: "[",
          type: "regex",
        }),
      ).toThrow("Invalid command whitelist regex");
    } finally {
      database?.db.close();
      await rm(root, { force: true, recursive: true });
    }
  });

  it("seeds safe default entries once and preserves an explicit clear", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-command-whitelist-"));
    let database: AppDatabase | null = null;

    try {
      database = openAppDatabase(join(root, "truss.db"));
      const whitelist = new CommandRunnerWhitelistRepository(database.db);

      whitelist.ensureDefaultEntries();

      expect(whitelist.listEntries()).toHaveLength(defaultCommandRunnerWhitelistEntries.length);
      expect(whitelist.matchingEntry("git status")?.reason).toContain("Built-in safe");
      expect(whitelist.matchingEntry("git status; rm -rf .")).toBeNull();

      whitelist.replaceEntries([]);
      whitelist.ensureDefaultEntries();

      expect(whitelist.listEntries()).toHaveLength(0);
    } finally {
      database?.db.close();
      await rm(root, { force: true, recursive: true });
    }
  });
});
