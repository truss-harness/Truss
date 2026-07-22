import type { Database } from "bun:sqlite";
import type {
  CommandRunnerWhitelistAddedBy,
  CommandRunnerWhitelistEntrySummary,
  CommandRunnerWhitelistEntryUpdate,
  CommandRunnerWhitelistExpiry,
  CommandRunnerWhitelistPatternType,
} from "../../shared/protocol.ts";

interface CommandRunnerWhitelistEntryRow {
  added_by: CommandRunnerWhitelistAddedBy;
  created_at: string;
  expires_at: string | null;
  id: number;
  pattern: string;
  reason: string | null;
  type: CommandRunnerWhitelistPatternType;
}

const maxWhitelistEntries = 200;
const maxPatternLength = 1_000;
const maxReasonLength = 1_200;

export const defaultCommandRunnerWhitelistEntries: CommandRunnerWhitelistEntryUpdate[] = [
  {
    pattern: "^(?:pwd|date)$",
    reason: "Built-in safe read-only shell status command.",
    type: "regex",
  },
  {
    pattern: "^(?:git|node|npm|bun)\\s+--version$",
    reason: "Built-in safe read-only version check.",
    type: "regex",
  },
  {
    pattern: "^git\\s+status(?:\\s+--short)?$",
    reason: "Built-in safe read-only Git status check.",
    type: "regex",
  },
  {
    pattern: "^git\\s+branch\\s+--show-current$",
    reason: "Built-in safe read-only Git branch check.",
    type: "regex",
  },
  {
    pattern: "^git\\s+rev-parse\\s+--show-toplevel$",
    reason: "Built-in safe read-only Git workspace check.",
    type: "regex",
  },
];

export class CommandRunnerWhitelistRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  ensureDefaultEntries(): CommandRunnerWhitelistEntrySummary[] {
    if (this.defaultEntriesSeeded()) {
      return this.listEntries();
    }

    this.deleteExpiredEntries();

    const row = this.#db
      .query("SELECT COUNT(*) AS count FROM command_runner_whitelist_entries")
      .get() as { count: number } | null;

    if ((row?.count ?? 0) === 0) {
      const entries = uniqueEntries(defaultCommandRunnerWhitelistEntries.map(normalizeEntryUpdate));
      const seed = this.#db.transaction((items: NormalizedWhitelistEntry[]) => {
        this.insertEntries(items);
      });

      seed(entries);
    }

    this.markDefaultEntriesSeeded();
    return this.listEntries();
  }

  listEntries(): CommandRunnerWhitelistEntrySummary[] {
    this.deleteExpiredEntries();

    const rows = this.#db
      .query(
        `
          SELECT id, pattern, type, expires_at, added_by, reason, created_at
          FROM command_runner_whitelist_entries
          WHERE expires_at IS NULL OR expires_at > ?
          ORDER BY created_at DESC, id DESC
        `,
      )
      .all(new Date().toISOString()) as CommandRunnerWhitelistEntryRow[];

    return rows.map(rowToEntry);
  }

  replaceEntries(entries: CommandRunnerWhitelistEntryUpdate[]): CommandRunnerWhitelistEntrySummary[] {
    const normalized = uniqueEntries(entries.map(normalizeEntryUpdate));
    const replace = this.#db.transaction((items: NormalizedWhitelistEntry[]) => {
      this.#db.query("DELETE FROM command_runner_whitelist_entries").run();
      this.insertEntries(items);
    });

    replace(normalized);
    this.markDefaultEntriesSeeded();
    return this.listEntries();
  }

  addEntry({
    addedBy,
    expiry,
    pattern,
    reason,
    type,
  }: {
    addedBy: CommandRunnerWhitelistAddedBy;
    expiry: CommandRunnerWhitelistExpiry;
    pattern: string;
    reason?: string | null;
    type: CommandRunnerWhitelistPatternType;
  }): CommandRunnerWhitelistEntrySummary {
    const now = new Date().toISOString();
    const entry = normalizeEntryUpdate({
      addedBy,
      expiresAt: expiresAtForExpiry(expiry, now),
      pattern,
      reason: reason ?? null,
      type,
    });

    this.deleteExpiredEntries();

    this.#db
      .query(
        `
          DELETE FROM command_runner_whitelist_entries
          WHERE pattern = ? AND type = ?
        `,
      )
      .run(entry.pattern, entry.type);

    this.#db
      .query(
        `
          INSERT INTO command_runner_whitelist_entries (
            pattern,
            type,
            expires_at,
            added_by,
            reason,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(entry.pattern, entry.type, entry.expiresAt, entry.addedBy, entry.reason, entry.createdAt);
    this.markDefaultEntriesSeeded();

    const saved = this.listEntries().find(
      (candidate) => candidate.pattern === entry.pattern && candidate.type === entry.type,
    );

    if (!saved) {
      throw new Error("Failed to save command whitelist entry.");
    }

    return saved;
  }

  matchingEntry(command: string): CommandRunnerWhitelistEntrySummary | null {
    const normalizedCommand = command.trim();

    if (!normalizedCommand) {
      return null;
    }

    return this.listEntries().find((entry) => commandMatchesEntry(normalizedCommand, entry)) ?? null;
  }

  private deleteExpiredEntries(): void {
    this.#db
      .query(
        `
          DELETE FROM command_runner_whitelist_entries
          WHERE expires_at IS NOT NULL AND expires_at <= ?
        `,
      )
      .run(new Date().toISOString());
  }

  private defaultEntriesSeeded(): boolean {
    this.ensureMetadataRow();

    const row = this.#db
      .query("SELECT seeded_defaults FROM command_runner_whitelist_metadata WHERE id = 1")
      .get() as { seeded_defaults: boolean | number } | null;

    return row?.seeded_defaults === true || row?.seeded_defaults === 1;
  }

  private ensureMetadataRow(): void {
    this.#db
      .query(
        `
          INSERT INTO command_runner_whitelist_metadata (id, seeded_defaults)
          VALUES (1, 0)
          ON CONFLICT(id) DO NOTHING
        `,
      )
      .run();
  }

  private insertEntries(entries: NormalizedWhitelistEntry[]): void {
    const insert = this.#db.query(
      `
        INSERT INTO command_runner_whitelist_entries (
          pattern,
          type,
          expires_at,
          added_by,
          reason,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
    );

    for (const entry of entries) {
      insert.run(
        entry.pattern,
        entry.type,
        entry.expiresAt,
        entry.addedBy,
        entry.reason,
        entry.createdAt,
      );
    }
  }

  private markDefaultEntriesSeeded(): void {
    this.ensureMetadataRow();
    this.#db
      .query(
        `
          UPDATE command_runner_whitelist_metadata
          SET seeded_defaults = 1
          WHERE id = 1
        `,
      )
      .run();
  }
}

interface NormalizedWhitelistEntry {
  addedBy: CommandRunnerWhitelistAddedBy;
  createdAt: string;
  expiresAt: string | null;
  pattern: string;
  reason: string | null;
  type: CommandRunnerWhitelistPatternType;
}

function normalizeEntryUpdate(value: CommandRunnerWhitelistEntryUpdate): NormalizedWhitelistEntry {
  const pattern = normalizePattern(value.pattern);
  const type = normalizeType(value.type);
  const addedBy = value.addedBy === "llm-request" ? "llm-request" : "user";
  const reason = normalizeReason(value.reason);

  if (addedBy === "llm-request" && !reason) {
    throw new Error("LLM-requested command whitelist entries require a reason.");
  }

  if (type === "regex") {
    try {
      new RegExp(pattern);
    } catch (caught) {
      throw new Error(`Invalid command whitelist regex: ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }

  return {
    addedBy,
    createdAt: new Date().toISOString(),
    expiresAt: normalizeExpiresAt(value.expiresAt),
    pattern,
    reason,
    type,
  };
}

function normalizePattern(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Command whitelist pattern must be a string.");
  }

  const pattern = value.trim();

  if (!pattern) {
    throw new Error("Command whitelist pattern cannot be empty.");
  }

  if (pattern.length > maxPatternLength) {
    throw new Error(`Command whitelist pattern is too long. Maximum is ${maxPatternLength} characters.`);
  }

  return pattern;
}

function normalizeType(value: unknown): CommandRunnerWhitelistPatternType {
  if (value === "prefix" || value === "glob" || value === "regex") {
    return value;
  }

  throw new Error("Command whitelist entry type must be prefix, glob, or regex.");
}

function normalizeReason(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Command whitelist reason must be a string.");
  }

  const reason = value.trim();

  if (reason.length > maxReasonLength) {
    throw new Error(`Command whitelist reason is too long. Maximum is ${maxReasonLength} characters.`);
  }

  return reason || null;
}

function normalizeExpiresAt(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Command whitelist expiry must be an ISO timestamp or null.");
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Command whitelist expiry must be an ISO timestamp or null.");
  }

  return date.toISOString();
}

function expiresAtForExpiry(expiry: CommandRunnerWhitelistExpiry, now: string): string | null {
  const startedAt = new Date(now).getTime();

  if (expiry === "permanent") {
    return null;
  }

  if (expiry === "1-month") {
    return new Date(startedAt + 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  return new Date(startedAt + 24 * 60 * 60 * 1000).toISOString();
}

function uniqueEntries(entries: NormalizedWhitelistEntry[]): NormalizedWhitelistEntry[] {
  if (entries.length > maxWhitelistEntries) {
    throw new Error(`Command whitelist may include at most ${maxWhitelistEntries} entries.`);
  }

  const seen = new Set<string>();
  const unique: NormalizedWhitelistEntry[] = [];

  for (const entry of entries) {
    const key = `${entry.type}\0${entry.pattern}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(entry);
  }

  return unique;
}

function commandMatchesEntry(
  command: string,
  entry: CommandRunnerWhitelistEntrySummary,
): boolean {
  if (entry.type === "prefix") {
    return command.startsWith(entry.pattern);
  }

  if (entry.type === "regex") {
    try {
      return new RegExp(entry.pattern).test(command);
    } catch {
      return false;
    }
  }

  return globToRegExp(entry.pattern).test(command);
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");

  return new RegExp(`^${escaped}$`);
}

function rowToEntry(row: CommandRunnerWhitelistEntryRow): CommandRunnerWhitelistEntrySummary {
  return {
    addedBy: row.added_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    id: row.id,
    pattern: row.pattern,
    reason: row.reason,
    type: row.type,
  };
}
