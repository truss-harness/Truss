import type { Database } from "bun:sqlite";
import type { SpawnedProcessSummary } from "../../shared/protocol.ts";

interface SpawnedProcessRow {
  id: string;
  pid: number;
  port: number;
  workspace_path: string;
  started_at: string;
  last_active_at: string;
}

export class SpawnedProcessesRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  list(): SpawnedProcessSummary[] {
    return (this.#db
      .query(
        `SELECT id, pid, port, workspace_path, started_at, last_active_at
         FROM spawned_processes
         ORDER BY started_at DESC`,
      )
      .all() as SpawnedProcessRow[]).map(toSummary);
  }

  get(id: string): SpawnedProcessSummary | null {
    const row = this.#db
      .query(
        `SELECT id, pid, port, workspace_path, started_at, last_active_at
         FROM spawned_processes
         WHERE id = ?`,
      )
      .get(id) as SpawnedProcessRow | null;

    return row ? toSummary(row) : null;
  }

  upsert(process: SpawnedProcessSummary): void {
    this.#db
      .query("DELETE FROM spawned_processes WHERE port = ? AND id <> ?")
      .run(process.port, process.id);

    this.#db
      .query(
        `INSERT INTO spawned_processes (
          id, pid, port, workspace_path, started_at, last_active_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          pid = excluded.pid,
          port = excluded.port,
          workspace_path = excluded.workspace_path,
          started_at = excluded.started_at,
          last_active_at = excluded.last_active_at`,
      )
      .run(
        process.id,
        process.pid,
        process.port,
        process.workspacePath,
        process.startedAt,
        process.lastActiveAt,
      );
  }

  touch(id: string, lastActiveAt: string): void {
    this.#db
      .query("UPDATE spawned_processes SET last_active_at = ? WHERE id = ?")
      .run(lastActiveAt, id);
  }

  remove(id: string): void {
    this.#db.query("DELETE FROM spawned_processes WHERE id = ?").run(id);
  }
}

function toSummary(row: SpawnedProcessRow): SpawnedProcessSummary {
  return {
    id: row.id,
    lastActiveAt: row.last_active_at,
    pid: row.pid,
    port: row.port,
    startedAt: row.started_at,
    workspacePath: row.workspace_path,
  };
}
