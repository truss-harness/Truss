import {
  normalizeFileAccessDirectory,
  resolveFileAccessPolicy,
  type FileAccessDirectoryGrantInput,
  type FileAccessRoot,
} from "../../../security/file-access.ts";
import { ensureTrussHome } from "../../../setup/truss-home.ts";
import { skillFilesystemAccessDirectories } from "../../../skills/discovery.ts";
import { openAppDatabase, type AppDatabase } from "../../../storage/database.ts";
import { FilesystemDirectoryGrantsRepository } from "../../../storage/filesystem-directory-grants.ts";

export interface TrussFilesystemToolsRuntime {
  accessRoots: FileAccessRoot[];
  close(): void;
  ignorePatterns: string[];
  workspaceRoot: string;
}

export async function createTrussFilesystemToolsMcpRuntime(
  workspacePath?: string,
  options: {
    allowedDirectories?: string[];
    ignorePatterns?: string[];
    includeSkillDirectories?: boolean;
    readOnlyDirectories?: string[];
    trussHomeDir?: string;
  } = {},
): Promise<TrussFilesystemToolsRuntime> {
  const normalizedWorkspacePath = await normalizeWorkspacePath(workspacePath);
  const trussHome = options.trussHomeDir
    ? await ensureTrussHome(options.trussHomeDir, {
        log: (message) => console.error(message),
      })
    : null;
  const directoryGrants = trussHome
    ? await loadPersistedDirectoryGrants({
        allowedDirectories: options.allowedDirectories ?? [],
        dbPath: trussHome.dbPath,
        workspacePath: normalizedWorkspacePath,
      })
    : [];
  const readOnlyDirectories = [
    ...(options.readOnlyDirectories ?? []),
    ...((options.includeSkillDirectories ?? Boolean(trussHome))
      ? await skillFilesystemAccessDirectories(normalizedWorkspacePath)
      : []),
  ];
  const policy = await resolveFileAccessPolicy({
    allowedDirectories: trussHome ? [] : options.allowedDirectories,
    conversationWorkspacePath: normalizedWorkspacePath,
    directoryGrants,
    readOnlyDirectories,
    trussHome,
  });

  const primaryRoot = policy.roots[0];

  if (!primaryRoot) {
    throw new Error(
      "Truss Filesystem Tools require --workspace-path or at least one granted directory.",
    );
  }

  return {
    accessRoots: policy.roots,
    close: () => undefined,
    ignorePatterns: options.ignorePatterns ?? policy.ignorePatterns,
    workspaceRoot: primaryRoot.path,
  };
}

async function normalizeWorkspacePath(value: string | null | undefined): Promise<string | null> {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  try {
    return await normalizeFileAccessDirectory(trimmed);
  } catch {
    return null;
  }
}

async function loadPersistedDirectoryGrants({
  allowedDirectories,
  dbPath,
  workspacePath,
}: {
  allowedDirectories: string[];
  dbPath: string;
  workspacePath: string | null;
}): Promise<FileAccessDirectoryGrantInput[]> {
  let database: AppDatabase | null = null;

  try {
    database = openAppDatabase(dbPath);
    const repository = new FilesystemDirectoryGrantsRepository(database.db);

    for (const directoryPath of allowedDirectories) {
      await repository.upsertGrant({
        directoryPath,
        grantSource: "cli-arg",
        workspacePath,
      });
    }

    return repository
      .listGrantsForContext(workspacePath)
      .map((grant) => ({
        directoryPath: grant.directoryPath,
        grantSource: grant.grantSource,
        readOnly: grant.readOnly,
      }));
  } finally {
    database?.db.close();
  }
}
