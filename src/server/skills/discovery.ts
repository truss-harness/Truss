import type { Dirent } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { parseSkillFile } from "./parser.ts";
import type { SkillDiscovery, SkillDocument, SkillSearchRoot } from "./types.ts";

const MAX_DISCOVERY_DEPTH = 4;
const globalSkillDirsEnv = "TRUSS_GLOBAL_SKILL_DIRS";

export interface DiscoverSkillsOptions {
  globalRoots?: SkillSearchRoot[];
  workspacePath?: string | null;
  workspaceRoots?: SkillSearchRoot[];
}

export async function discoverSkills(options: DiscoverSkillsOptions = {}): Promise<SkillDiscovery> {
  const roots = skillSearchRoots(options);
  const skillFiles = (
    await Promise.all(
      roots.map(async (root) =>
        (await findSkillFiles(root.path)).map((path) => ({
          path,
          root,
        })),
      ),
    )
  ).flat();
  const skills = (await Promise.all(skillFiles.map((item) => parseSkillFile(item.path, item.root)))).filter(
    (skill): skill is SkillDocument => Boolean(skill),
  );

  return {
    directories: roots.map((root) => root.path),
    skills,
  };
}

export function skillSearchRoots(options: DiscoverSkillsOptions = {}): SkillSearchRoot[] {
  return uniqueSkillRoots([
    ...(options.globalRoots ?? defaultGlobalSkillRoots()),
    ...(options.workspaceRoots ?? defaultWorkspaceSkillRoots(options.workspacePath ?? null)),
  ]);
}

export async function skillFilesystemAccessDirectories(
  workspacePath?: string | null,
): Promise<string[]> {
  const roots = skillSearchRoots({ workspacePath });
  const directories = await Promise.all(roots.map(existingDirectoryRealpath));

  return uniquePaths(directories.filter((path): path is string => Boolean(path)));
}

async function findSkillFiles(directory: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DISCOVERY_DEPTH) {
    return [];
  }

  let entries: Dirent<string>[];

  try {
    entries = await readdir(directory, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return [];
  }

  const directSkill = entries.find((entry) => entry.isFile() && entry.name === "SKILL.md");
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => findSkillFiles(join(directory, entry.name), depth + 1)),
  );

  return [
    ...(directSkill ? [join(directory, directSkill.name)] : []),
    ...nested.flat(),
  ];
}

function defaultGlobalSkillRoots(): SkillSearchRoot[] {
  const configuredDirectories = configuredGlobalSkillDirectories();

  if (configuredDirectories !== null) {
    return configuredDirectories.map((path) => ({
      path,
      scope: "global" as const,
      source: "configured",
    }));
  }

  const home = homedir();
  const codexHome = process.env.CODEX_HOME?.trim()
    ? resolve(process.env.CODEX_HOME)
    : join(home, ".codex");

  return [
    { path: join(codexHome, "skills"), scope: "global", source: "codex" },
    { path: join(home, ".claude", "skills"), scope: "global", source: "claude" },
    { path: join(home, ".cursor", "skills"), scope: "global", source: "cursor" },
    { path: join(home, ".github", "copilot", "skills"), scope: "global", source: "github-copilot" },
    { path: join(home, ".github", "skills"), scope: "global", source: "github-copilot" },
    { path: join(home, ".junie", "skills"), scope: "global", source: "junie" },
  ];
}

function defaultWorkspaceSkillRoots(workspacePath: string | null): SkillSearchRoot[] {
  if (!workspacePath) {
    return [];
  }

  return [
    { path: join(workspacePath, ".skills"), scope: "workspace", source: "generic" },
    { path: join(workspacePath, "skills"), scope: "workspace", source: "generic" },
    { path: join(workspacePath, ".codex", "skills"), scope: "workspace", source: "codex" },
    { path: join(workspacePath, ".claude", "skills"), scope: "workspace", source: "claude" },
    { path: join(workspacePath, ".cursor", "skills"), scope: "workspace", source: "cursor" },
    { path: join(workspacePath, ".github", "copilot", "skills"), scope: "workspace", source: "github-copilot" },
    { path: join(workspacePath, ".github", "skills"), scope: "workspace", source: "github-copilot" },
    { path: join(workspacePath, ".junie", "skills"), scope: "workspace", source: "junie" },
  ];
}

function configuredGlobalSkillDirectories(): string[] | null {
  const raw = process.env[globalSkillDirsEnv];

  if (raw === undefined) {
    return null;
  }

  return raw
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolve(entry));
}

async function existingDirectoryRealpath(root: SkillSearchRoot): Promise<string | null> {
  try {
    const path = await realpath(root.path);
    const pathStat = await stat(path);

    return pathStat.isDirectory() ? path : null;
  } catch {
    return null;
  }
}

function uniqueSkillRoots(roots: SkillSearchRoot[]): SkillSearchRoot[] {
  const seen = new Set<string>();
  const unique: SkillSearchRoot[] = [];

  for (const root of roots) {
    const key = comparablePath(root.path);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(root);
  }

  return unique;
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

function comparablePath(path: string): string {
  const normalized = resolve(path);

  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
