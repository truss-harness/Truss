import { stat, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  CommandRunnerSecuritySummary,
  FileAccessGrantSource,
  FileAccessDirectorySummary,
  FileAccessSecurityResponse,
} from "../../shared/protocol.ts";
import type { TrussHome } from "../setup/truss-home.ts";
import type {
  FilesystemDirectoryGrant,
  FilesystemDirectoryGrantsRepository,
} from "../storage/filesystem-directory-grants.ts";

export type FileAccessRootAccess = "read-only" | "read-write";
export type FileAccessRootSource = "cli-arg" | "skill" | "user" | "workspace";

export interface FileAccessRoot {
  access: FileAccessRootAccess;
  path: string;
  scope: "global" | "workspace";
  source: FileAccessRootSource;
}

export interface FileAccessDirectoryGrantInput {
  directoryPath: string;
  grantSource?: FileAccessGrantSource;
  readOnly?: boolean;
}

export interface StoredFileAccessSettings {
  directories: string[];
  ignorePatterns: string[];
}

export interface EffectiveFileAccessPolicy {
  ignorePatterns: string[];
  roots: FileAccessRoot[];
  stored: StoredFileAccessSettings;
  usingDefaultIgnorePatterns: boolean;
}

export interface ResolveFileAccessPolicyOptions {
  allowedDirectories?: string[];
  conversationWorkspacePath?: string | null;
  directoryGrants?: Array<string | FileAccessDirectoryGrantInput>;
  readOnlyDirectories?: string[];
  trussHome?: TrussHome | null;
}

export interface UpdateFileAccessSettingsInput {
  directories?: string[];
  ignorePatterns?: string[];
}

export const defaultFileIgnorePatterns = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  ".npmrc",
  ".pypirc",
  ".netrc",
  "credentials.json",
  "service-account*.json",
  "secrets.*",
  "*.kdbx",
];

const maxDirectories = 50;
const maxDirectoryLength = 4_000;
const maxIgnorePatterns = 500;
const maxIgnorePatternLength = 2_000;
const maxIgnorePatternGlobstars = 3;
const maxIgnorePatternWildcards = 64;
const emptyStoredFileAccessSettings: StoredFileAccessSettings = {
  directories: [],
  ignorePatterns: [],
};

export async function readStoredFileAccessSettings(
  trussHome: TrussHome,
): Promise<StoredFileAccessSettings> {
  const file = Bun.file(trussHome.fileAccessConfigPath);

  if (!(await file.exists())) {
    return { ...emptyStoredFileAccessSettings };
  }

  try {
    const parsed = (await file.json()) as unknown;
    return normalizeStoredFileAccessSettings(parsed);
  } catch {
    return { ...emptyStoredFileAccessSettings };
  }
}

export async function writeStoredFileAccessSettings(
  trussHome: TrussHome,
  settings: StoredFileAccessSettings,
): Promise<StoredFileAccessSettings> {
  const normalized = normalizeStoredFileAccessSettings(settings);

  await Bun.write(
    trussHome.fileAccessConfigPath,
    `${JSON.stringify(
      {
        directories: normalized.directories,
        ignorePatterns: normalized.ignorePatterns,
      },
      null,
      2,
    )}\n`,
  );

  return normalized;
}

export async function updateStoredFileAccessSettings(
  trussHome: TrussHome,
  input: UpdateFileAccessSettingsInput,
): Promise<StoredFileAccessSettings> {
  const current = await readStoredFileAccessSettings(trussHome);
  const next: StoredFileAccessSettings = {
    directories: Object.hasOwn(input, "directories")
      ? await normalizeDirectoryInputs(input.directories ?? [])
      : current.directories,
    ignorePatterns: Object.hasOwn(input, "ignorePatterns")
      ? normalizeIgnorePatterns(input.ignorePatterns ?? [])
      : current.ignorePatterns,
  };

  return writeStoredFileAccessSettings(trussHome, next);
}

export async function grantFileAccessDirectory(
  trussHome: TrussHome,
  directoryPath: string,
): Promise<StoredFileAccessSettings> {
  const directory = await normalizeFileAccessDirectory(directoryPath);
  const current = await readStoredFileAccessSettings(trussHome);
  const directories = uniquePaths([...current.directories, directory]);

  return writeStoredFileAccessSettings(trussHome, {
    ...current,
    directories,
  });
}

export async function fileAccessSettingsResponse({
  commandRunner,
  conversationWorkspacePath,
  filesystemGrants,
  trussHome,
}: {
  commandRunner: CommandRunnerSecuritySummary;
  conversationWorkspacePath: string | null;
  filesystemGrants: FilesystemDirectoryGrantsRepository;
  trussHome: TrussHome;
}): Promise<FileAccessSecurityResponse> {
  const stored = await readStoredFileAccessSettings(trussHome);
  const activeScope = fileAccessActiveScope(conversationWorkspacePath);
  const workspaceDirectory = conversationWorkspacePath
    ? await directorySummary({
        directory: conversationWorkspacePath,
        source: "workspace",
        workspacePath: conversationWorkspacePath,
      })
    : null;
  const grants = filesystemGrants.listGrantsForContext(conversationWorkspacePath);
  const directories = await Promise.all(
    grants.map((grant) => grantDirectorySummary(grant)),
  );
  const effectiveDirectories = [
    ...(workspaceDirectory?.exists ? [workspaceDirectory] : []),
    ...directories.filter((directory) => directory.exists),
  ];
  const usingDefaultIgnorePatterns = stored.ignorePatterns.length === 0;

  return {
    activeScope,
    commandRunner,
    configPath: trussHome.fileAccessConfigPath,
    defaultIgnorePatterns: defaultFileIgnorePatterns,
    directories,
    effectiveDirectories,
    ignorePatterns: usingDefaultIgnorePatterns
      ? defaultFileIgnorePatterns
      : stored.ignorePatterns,
    usingDefaultIgnorePatterns,
    workspaceDirectory,
  };
}

export async function resolveFileAccessPolicy(
  options: ResolveFileAccessPolicyOptions,
): Promise<EffectiveFileAccessPolicy> {
  const stored = options.trussHome
    ? await readStoredFileAccessSettings(options.trussHome)
    : { ...emptyStoredFileAccessSettings };
  const ignorePatterns =
    stored.ignorePatterns.length > 0 ? stored.ignorePatterns : defaultFileIgnorePatterns;
  const roots: FileAccessRoot[] = [];
  const scope = options.conversationWorkspacePath ? "workspace" : "global";

  if (options.conversationWorkspacePath) {
    const workspaceRoot = await directoryRootOrNull(options.conversationWorkspacePath);

    if (workspaceRoot) {
      roots.push({
        access: "read-write",
        path: workspaceRoot,
        scope,
        source: "workspace",
      });
    }
  }

  const directoryGrants = [
    ...(options.directoryGrants ?? []).map((grant) => normalizeDirectoryGrantInput(grant, "user")),
    ...(options.allowedDirectories ?? []).map((directoryPath) => ({
      directoryPath,
      readOnly: false,
      source: "cli-arg" as const,
    })),
  ];

  for (const grant of directoryGrants) {
    const root = await directoryRootOrNull(grant.directoryPath);

    if (!root || roots.some((item) => samePath(item.path, root))) {
      continue;
    }

    roots.push({
      access: grant.readOnly ? "read-only" : "read-write",
      path: root,
      scope,
      source: grant.source,
    });
  }

  for (const directoryPath of options.readOnlyDirectories ?? []) {
    const root = await directoryRootOrNull(directoryPath);

    if (!root || roots.some((item) => samePath(item.path, root))) {
      continue;
    }

    roots.push({
      access: "read-only",
      path: root,
      scope,
      source: "skill",
    });
  }

  return {
    ignorePatterns,
    roots,
    stored,
    usingDefaultIgnorePatterns: stored.ignorePatterns.length === 0,
  };
}

function normalizeDirectoryGrantInput(
  grant: string | FileAccessDirectoryGrantInput,
  fallbackSource: "cli-arg" | "user",
): { directoryPath: string; readOnly: boolean; source: "cli-arg" | "user" } {
  if (typeof grant === "string") {
    return { directoryPath: grant, readOnly: false, source: fallbackSource };
  }

  return {
    directoryPath: grant.directoryPath,
    readOnly: grant.readOnly === true,
    source: grant.grantSource === "cli-arg" ? "cli-arg" : "user",
  };
}

async function normalizeDirectoryInputs(value: string[]): Promise<string[]> {
  if (!Array.isArray(value)) {
    throw new Error("directories must be an array of strings.");
  }

  if (value.length > maxDirectories) {
    throw new Error(`directories may include at most ${maxDirectories} entries.`);
  }

  const directories = await Promise.all(value.map(normalizeFileAccessDirectory));
  return uniquePaths(directories);
}

export async function normalizeFileAccessDirectory(value: string): Promise<string> {
  if (typeof value !== "string") {
    throw new Error("directories must be an array of strings.");
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error("directories cannot include empty entries.");
  }

  if (trimmed.length > maxDirectoryLength) {
    throw new Error("directory path is too long.");
  }

  const directory = await realpath(resolve(trimmed));
  const directoryStat = await stat(directory);

  if (!directoryStat.isDirectory()) {
    throw new Error(`File access path must be a directory: ${trimmed}`);
  }

  return directory;
}

function normalizeIgnorePatterns(value: string[]): string[] {
  if (!Array.isArray(value)) {
    throw new Error("ignorePatterns must be an array of strings.");
  }

  if (value.length > maxIgnorePatterns) {
    throw new Error(`ignorePatterns may include at most ${maxIgnorePatterns} entries.`);
  }

  const patterns: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error("ignorePatterns must be an array of strings.");
    }

    const pattern = item.trim();

    if (!pattern || pattern.startsWith("#")) {
      continue;
    }

    if (pattern.length > maxIgnorePatternLength) {
      throw new Error("ignore pattern is too long.");
    }

    validateIgnorePatternComplexity(pattern);

    if (seen.has(pattern)) {
      continue;
    }

    seen.add(pattern);
    patterns.push(pattern);
  }

  return patterns;
}

function validateIgnorePatternComplexity(pattern: string): void {
  let globstars = 0;
  let wildcards = 0;
  const characters = pattern.replace(/^!/, "").replace(/^\/+/, "").split("");

  for (const [index, char] of characters.entries()) {
    if (char === "*") {
      if (characters[index + 1] === "*") {
        globstars += 1;
        wildcards += 1;
        continue;
      }

      if (characters[index - 1] === "*") {
        continue;
      }

      wildcards += 1;
      continue;
    }

    if (char === "?") {
      wildcards += 1;
    }
  }

  if (globstars > maxIgnorePatternGlobstars || wildcards > maxIgnorePatternWildcards) {
    throw new Error("ignore pattern is too complex.");
  }
}

function normalizeStoredFileAccessSettings(value: unknown): StoredFileAccessSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...emptyStoredFileAccessSettings };
  }

  const settings = value as Partial<StoredFileAccessSettings>;

  return {
    directories: normalizeStoredStringArray(settings.directories, maxDirectories, maxDirectoryLength),
    ignorePatterns: normalizeIgnorePatterns(
      normalizeStoredStringArray(settings.ignorePatterns, maxIgnorePatterns, maxIgnorePatternLength),
    ),
  };
}

function normalizeStoredStringArray(
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const item of value.slice(0, maxItems)) {
    if (typeof item !== "string") {
      continue;
    }

    const trimmed = item.trim();

    if (!trimmed || trimmed.length > maxLength || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

async function directorySummary(
  options: {
    directory: string;
    expiresAt?: string;
    grantId?: number;
    grantSource?: FileAccessGrantSource;
    grantedAt?: string;
    readOnly?: boolean;
    source: "user" | "workspace";
    workspacePath: string | null;
  },
): Promise<FileAccessDirectorySummary> {
  const trimmed = options.directory.trim();
  const scope = options.workspacePath ? "workspace" : "global";

  try {
    const path = await normalizeFileAccessDirectory(trimmed);

    return {
      exists: true,
      ...(options.grantId !== undefined ? { grantId: options.grantId } : {}),
      ...(options.grantSource ? { grantSource: options.grantSource } : {}),
      ...(options.grantedAt ? { grantedAt: options.grantedAt } : {}),
      ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
      path,
      readOnly: options.readOnly === true,
      scope,
      source: options.source,
      workspacePath: options.workspacePath,
    };
  } catch (caught) {
    return {
      error: caught instanceof Error ? caught.message : String(caught),
      exists: false,
      ...(options.grantId !== undefined ? { grantId: options.grantId } : {}),
      ...(options.grantSource ? { grantSource: options.grantSource } : {}),
      ...(options.grantedAt ? { grantedAt: options.grantedAt } : {}),
      ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
      path: trimmed,
      readOnly: options.readOnly === true,
      scope,
      source: options.source,
      workspacePath: options.workspacePath,
    };
  }
}

function grantDirectorySummary(
  grant: FilesystemDirectoryGrant,
): Promise<FileAccessDirectorySummary> {
  return directorySummary({
    directory: grant.directoryPath,
    expiresAt: grant.expiresAt,
    grantId: grant.id,
    grantSource: grant.grantSource,
    grantedAt: grant.grantedAt,
    readOnly: grant.readOnly,
    source: "user",
    workspacePath: grant.workspacePath,
  });
}

async function directoryRootOrNull(directory: string): Promise<string | null> {
  try {
    return await normalizeFileAccessDirectory(directory);
  } catch {
    return null;
  }
}

function fileAccessActiveScope(workspacePath: string | null): FileAccessSecurityResponse["activeScope"] {
  return workspacePath
    ? {
        label: workspacePath,
        mode: "workspace",
        workspacePath,
      }
    : {
        label: "Global",
        mode: "global",
        workspacePath: null,
      };
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const path of paths) {
    const key = comparablePath(path);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(path);
  }

  return unique;
}

function samePath(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right);
}

function comparablePath(path: string): string {
  const normalized = resolve(path);

  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
