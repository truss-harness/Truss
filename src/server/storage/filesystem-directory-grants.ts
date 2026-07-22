import type { Database } from "bun:sqlite";
import type {
  FileAccessDirectoryUpdate,
  FileAccessGrantSource,
} from "../../shared/protocol.ts";
import { normalizeFileAccessDirectory } from "../security/file-access.ts";

export interface FilesystemDirectoryGrant {
  directoryPath: string;
  expiresAt: string;
  grantedAt: string;
  grantSource: FileAccessGrantSource;
  id: number;
  readOnly: boolean;
  workspacePath: string | null;
}

interface FilesystemDirectoryGrantRow {
  directory_path: string;
  expires_at: string;
  granted_at: string;
  grant_source: FileAccessGrantSource;
  id: number;
  read_only: boolean | number;
  workspace_path: string | null;
}

interface NormalizedDirectoryGrantInput {
  directoryPath: string;
  readOnly: boolean;
  scope?: string;
}

const defaultGrantDurationMs = 24 * 60 * 60 * 1000;

export class FilesystemDirectoryGrantsRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  listGrantsForContext(workspacePath: string | null): FilesystemDirectoryGrant[] {
    this.deleteExpiredGrants();

    const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
    const rows = this.#db
      .query(
        `
          SELECT id, workspace_path, directory_path, granted_at, expires_at, grant_source, read_only
          FROM filesystem_directory_grants
          WHERE (workspace_path IS NULL OR workspace_path = ?) AND expires_at > ?
          ORDER BY directory_path COLLATE NOCASE ASC
        `,
      )
      .all(normalizedWorkspacePath, new Date().toISOString());

    return (rows as FilesystemDirectoryGrantRow[]).map(rowToGrant);
  }

  async upsertGrant(input: {
    directoryPath: string;
    grantSource: FileAccessGrantSource;
    readOnly?: boolean;
    workspacePath: string | null;
  }): Promise<FilesystemDirectoryGrant> {
    const directoryPath = await normalizeFileAccessDirectory(input.directoryPath);
    const workspacePath = normalizeWorkspacePath(input.workspacePath);
    const readOnly = input.readOnly === true;
    const now = new Date().toISOString();
    const expiresAt = grantExpiresAt(now);

    this.#db
      .query(
        `
          INSERT OR IGNORE INTO filesystem_directory_grants (
            workspace_path,
            directory_path,
            granted_at,
            expires_at,
            grant_source,
            read_only
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(workspacePath, directoryPath, now, expiresAt, input.grantSource, readOnly ? 1 : 0);

    if (workspacePath) {
      this.#db
        .query(
          `
            UPDATE filesystem_directory_grants
            SET granted_at = ?, expires_at = ?, grant_source = ?, read_only = ?
            WHERE workspace_path = ? AND directory_path = ?
          `,
        )
        .run(now, expiresAt, input.grantSource, readOnly ? 1 : 0, workspacePath, directoryPath);
    } else {
      this.#db
        .query(
          `
            UPDATE filesystem_directory_grants
            SET granted_at = ?, expires_at = ?, grant_source = ?, read_only = ?
            WHERE workspace_path IS NULL AND directory_path = ?
          `,
        )
        .run(now, expiresAt, input.grantSource, readOnly ? 1 : 0, directoryPath);
    }

    const grant = this.findGrant(workspacePath, directoryPath);

    if (!grant) {
      throw new Error("Failed to store filesystem directory grant.");
    }

    return grant;
  }

  async replaceContextGrants(
    workspacePath: string | null,
    directoryGrants: Array<string | FileAccessDirectoryUpdate>,
    grantSource: FileAccessGrantSource,
  ): Promise<FilesystemDirectoryGrant[]> {
    const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
    const grants = uniqueGrants(
      await Promise.all(directoryGrants.map((grant) => normalizeDirectoryGrantInput(grant))),
    );
    const replace = this.#db.transaction((items: NormalizedDirectoryGrantInput[]) => {
      if (normalizedWorkspacePath) {
        this.#db
          .query("DELETE FROM filesystem_directory_grants WHERE workspace_path = ?")
          .run(normalizedWorkspacePath);
      } else {
        this.#db
          .query("DELETE FROM filesystem_directory_grants WHERE workspace_path IS NULL")
          .run();
      }

      const now = new Date().toISOString();
      const expiresAt = grantExpiresAt(now);
      const insert = this.#db.query(
        `
          INSERT OR IGNORE INTO filesystem_directory_grants (
            workspace_path,
            directory_path,
            granted_at,
            expires_at,
            grant_source,
            read_only
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      );

      for (const grant of items) {
        insert.run(
          grant.scope === "global" ? null : normalizedWorkspacePath,
          grant.directoryPath,
          now,
          expiresAt,
          grantSource,
          grant.readOnly ? 1 : 0,
        );
      }
    });

    replace(grants);

    return this.listGrantsForContext(normalizedWorkspacePath);
  }

  deleteGrant(grantId: number, workspacePath: string | null): boolean {
    const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
    const changes = normalizedWorkspacePath
      ? this.#db
          .query("DELETE FROM filesystem_directory_grants WHERE id = ? AND workspace_path = ?")
          .run(grantId, normalizedWorkspacePath).changes
      : this.#db
          .query("DELETE FROM filesystem_directory_grants WHERE id = ? AND workspace_path IS NULL")
          .run(grantId).changes;

    return changes > 0;
  }

  private findGrant(
    workspacePath: string | null,
    directoryPath: string,
  ): FilesystemDirectoryGrant | null {
    const row = workspacePath
      ? this.#db
          .query(
            `
              SELECT id, workspace_path, directory_path, granted_at, expires_at, grant_source, read_only
              FROM filesystem_directory_grants
              WHERE workspace_path = ? AND directory_path = ?
            `,
          )
          .get(workspacePath, directoryPath)
      : this.#db
          .query(
            `
              SELECT id, workspace_path, directory_path, granted_at, expires_at, grant_source, read_only
              FROM filesystem_directory_grants
              WHERE workspace_path IS NULL AND directory_path = ?
            `,
          )
          .get(directoryPath);

    return row ? rowToGrant(row as FilesystemDirectoryGrantRow) : null;
  }

  private deleteExpiredGrants(): void {
    this.#db
      .query("DELETE FROM filesystem_directory_grants WHERE expires_at <= ?")
      .run(new Date().toISOString());
  }
}

function rowToGrant(row: FilesystemDirectoryGrantRow): FilesystemDirectoryGrant {
  return {
    directoryPath: row.directory_path,
    expiresAt: row.expires_at,
    grantedAt: row.granted_at,
    grantSource: row.grant_source,
    id: row.id,
    readOnly: row.read_only === true || row.read_only === 1,
    workspacePath: row.workspace_path,
  };
}

function grantExpiresAt(grantedAt: string): string {
  return new Date(new Date(grantedAt).getTime() + defaultGrantDurationMs).toISOString();
}

function normalizeWorkspacePath(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

async function normalizeDirectoryGrantInput(
  grant: string | FileAccessDirectoryUpdate,
): Promise<NormalizedDirectoryGrantInput> {
  const directoryPath = typeof grant === "string" ? grant : grant.path;

  return {
    directoryPath: await normalizeFileAccessDirectory(directoryPath),
    readOnly: typeof grant === "string" ? false : grant.readOnly === true,
    scope: typeof grant === "string" ? undefined : grant.scope,
  };
}

function uniqueGrants(grants: NormalizedDirectoryGrantInput[]): NormalizedDirectoryGrantInput[] {
  const seen = new Set<string>();
  const unique: NormalizedDirectoryGrantInput[] = [];

  for (const grant of grants) {
    const key = comparablePath(grant.directoryPath);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(grant);
  }

  return unique;
}

function comparablePath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}
