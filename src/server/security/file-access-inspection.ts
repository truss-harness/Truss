import type { Dirent } from "node:fs";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type {
  FileAccessActiveScopeSummary,
  FileAccessWorkspaceTreeNode,
  FileAccessWorkspaceTreeResponse,
} from "../../shared/protocol.ts";
import type { TrussHome } from "../setup/truss-home.ts";
import {
  type FileAccessDirectoryGrantInput,
  type FileAccessRoot,
  normalizeFileAccessDirectory,
  resolveFileAccessPolicy,
} from "./file-access.ts";
import {
  fileAccessIgnoreMatch,
  fileAccessRootForPath,
  isFileAccessPathWithin,
} from "./file-access-rules.ts";

interface InspectFileAccessWorkspaceTreeOptions {
  conversationWorkspacePath: string | null;
  directoryGrants?: Array<string | FileAccessDirectoryGrantInput>;
  directoryPath?: string | null;
  limit?: number;
  readOnlyDirectories?: string[];
  trussHome?: TrussHome | null;
}

type FileAccessTreeNodeType = FileAccessWorkspaceTreeNode["type"];

const defaultWorkspaceTreeLimit = 1_000;
const maxWorkspaceTreeLimit = 5_000;

export async function inspectFileAccessWorkspaceTree({
  conversationWorkspacePath,
  directoryGrants = [],
  directoryPath,
  limit,
  readOnlyDirectories = [],
  trussHome = null,
}: InspectFileAccessWorkspaceTreeOptions): Promise<FileAccessWorkspaceTreeResponse> {
  if (!conversationWorkspacePath) {
    throw new Error("Workspace access inspection is available only in workspace mode.");
  }

  const workspaceRoot = await normalizeFileAccessDirectory(conversationWorkspacePath);
  const policy = await resolveFileAccessPolicy({
    conversationWorkspacePath: workspaceRoot,
    directoryGrants,
    readOnlyDirectories,
    trussHome,
  });
  const childLimit = normalizeWorkspaceTreeLimit(limit);
  const directory = await resolveInspectionDirectory(workspaceRoot, directoryPath);
  const directoryNode = await workspaceTreeNode({
    absolutePath: directory,
    accessRoots: policy.roots,
    ignorePatterns: policy.ignorePatterns,
    name: nodeName(directory, workspaceRoot),
    type: "directory",
    workspaceRoot,
  });

  let entries: Dirent[] = [];
  let directoryError: string | undefined;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (caught) {
    directoryError = caught instanceof Error ? caught.message : String(caught);
  }

  const sortedEntries = entries.sort(compareDirents);
  const visibleEntries = sortedEntries.slice(0, childLimit);
  const children = await Promise.all(
    visibleEntries.map((entry) =>
      workspaceTreeNode({
        absolutePath: join(directory, entry.name),
        accessRoots: policy.roots,
        entry,
        ignorePatterns: policy.ignorePatterns,
        name: entry.name,
        workspaceRoot,
      }),
    ),
  );

  return {
    activeScope: fileAccessWorkspaceScope(workspaceRoot),
    children,
    directory: {
      ...directoryNode,
      ...(directoryError ? { error: directoryError } : {}),
    },
    limit: childLimit,
    truncated: sortedEntries.length > visibleEntries.length,
  };
}

async function resolveInspectionDirectory(
  workspaceRoot: string,
  directoryPath: string | null | undefined,
): Promise<string> {
  const trimmed = directoryPath?.trim();
  const candidate = trimmed
    ? isAbsolute(trimmed)
      ? resolve(trimmed)
      : resolve(workspaceRoot, trimmed)
    : workspaceRoot;
  const directory = await realpath(candidate);

  if (!isFileAccessPathWithin(workspaceRoot, directory)) {
    throw new Error("Workspace access inspection can only browse the active workspace.");
  }

  const directoryStat = await stat(directory);

  if (!directoryStat.isDirectory()) {
    throw new Error(`Workspace access inspection path is not a directory: ${directoryPath ?? "."}`);
  }

  return directory;
}

async function workspaceTreeNode({
  absolutePath,
  accessRoots,
  entry,
  ignorePatterns,
  name,
  type,
  workspaceRoot,
}: {
  absolutePath: string;
  accessRoots: FileAccessRoot[];
  entry?: Dirent;
  ignorePatterns: string[];
  name: string;
  type?: FileAccessTreeNodeType;
  workspaceRoot: string;
}): Promise<FileAccessWorkspaceTreeNode> {
  const nodeType = type ?? direntType(entry);
  const isDirectoryPath = nodeType === "directory";
  const access = await nodeAccessRule({
    absolutePath,
    accessRoots,
    ignorePatterns,
    isDirectoryPath,
    type: nodeType,
  });
  let error: string | undefined;

  try {
    await lstat(absolutePath);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  return {
    access: access.access,
    hasChildren: isDirectoryPath,
    name,
    path: absolutePath,
    relativePath: workspaceRelativePath(workspaceRoot, absolutePath),
    rule: access.rule,
    type: nodeType,
    ...(error ? { error } : {}),
  };
}

async function nodeAccessRule({
  absolutePath,
  accessRoots,
  ignorePatterns,
  isDirectoryPath,
  type,
}: {
  absolutePath: string;
  accessRoots: FileAccessRoot[];
  ignorePatterns: string[];
  isDirectoryPath: boolean;
  type: FileAccessTreeNodeType;
}): Promise<Pick<FileAccessWorkspaceTreeNode, "access" | "rule">> {
  const root = fileAccessRootForPath(accessRoots, absolutePath);

  if (!root) {
    return {
      access: "deny",
      rule: "Denied because no active workspace root or directory grant covers this path.",
    };
  }

  if (type === "symlink") {
    try {
      const target = await realpath(absolutePath);

      if (!isFileAccessPathWithin(root.path, target)) {
        return {
          access: "deny",
          rule: `Denied because this symlink resolves outside the granting root: ${root.path}.`,
        };
      }
    } catch {
      return {
        access: "deny",
        rule: "Denied because this symlink target cannot be resolved.",
      };
    }
  }

  const ignoreMatch = fileAccessIgnoreMatch({
    absolutePath,
    accessRoots,
    ignorePatterns,
    isDirectoryPath,
  });

  if (ignoreMatch.ignored) {
    return {
      access: "deny",
      rule: ignoreMatch.pattern
        ? `Denied by ignore pattern "${ignoreMatch.pattern}" under ${ignoreMatch.rootPath ?? root.path}.`
        : "Denied because no active workspace root or directory grant covers this path.",
    };
  }

  return {
    access: root.access === "read-only" ? "read-only" : "read-write",
    rule: `${root.access === "read-only" ? "Read-only" : "Read-write"} access is granted by ${rootRuleLabel(root)}: ${root.path}.`,
  };
}

function rootRuleLabel(root: FileAccessRoot): string {
  switch (root.source) {
    case "cli-arg":
      return "a CLI directory grant";
    case "skill":
      return "a Truss skill directory";
    case "user":
      return "a user-approved directory grant";
    case "workspace":
      return "the active workspace root";
  }
}

function direntType(entry: Dirent | undefined): FileAccessTreeNodeType {
  if (!entry) {
    return "other";
  }

  if (entry.isSymbolicLink()) {
    return "symlink";
  }

  if (entry.isDirectory()) {
    return "directory";
  }

  if (entry.isFile()) {
    return "file";
  }

  return "other";
}

function compareDirents(left: Dirent, right: Dirent): number {
  if (left.isDirectory() !== right.isDirectory()) {
    return left.isDirectory() ? -1 : 1;
  }

  return left.name.localeCompare(right.name);
}

function workspaceRelativePath(workspaceRoot: string, absolutePath: string): string {
  const value = relative(workspaceRoot, absolutePath).replace(/\\/g, "/");

  return value || ".";
}

function nodeName(absolutePath: string, workspaceRoot: string): string {
  return workspaceRelativePath(workspaceRoot, absolutePath) === "."
    ? basename(workspaceRoot) || workspaceRoot
    : basename(absolutePath);
}

function fileAccessWorkspaceScope(workspaceRoot: string): FileAccessActiveScopeSummary {
  return {
    label: workspaceRoot,
    mode: "workspace",
    workspacePath: workspaceRoot,
  };
}

function normalizeWorkspaceTreeLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultWorkspaceTreeLimit;
  }

  return Math.min(Math.max(Math.floor(value), 1), maxWorkspaceTreeLimit);
}
