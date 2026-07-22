import { Database } from "bun:sqlite";
import { runMigrations } from "./migrations.ts";

export interface AppDatabase {
  db: Database;
  path: string;
}

export function openAppDatabase(dbPath: string): AppDatabase {
  const db = new Database(dbPath, { create: true });

  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  runMigrations(db);

  return { db, path: dbPath };
}
