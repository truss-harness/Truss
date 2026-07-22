import process from "node:process";
import { existsSync, statSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { existingFiles, readMcpJsonFile } from "./config-json.ts";
import type { McpLoaderResult } from "./types.ts";
import type { TrussHome } from "../setup/truss-home.ts";
import { isStandaloneRuntime } from "../runtime/project-root.ts";
import {
  resolveFileAccessPolicy,
  type FileAccessDirectoryGrantInput,
  type EffectiveFileAccessPolicy,
} from "../security/file-access.ts";
import { skillFilesystemAccessDirectories } from "../skills/discovery.ts";
import { openAppDatabase, type AppDatabase } from "../storage/database.ts";
import { FilesystemDirectoryGrantsRepository } from "../storage/filesystem-directory-grants.ts";
import { McpSettingsRepository } from "../storage/mcp-settings.ts";

const globalSource = "truss-global";
const bundledMcpServers = [
  {
    cliName: "truss-web-tools",
    key: "truss-web-tools",
    name: "Truss Web Tools",
  },
  {
    cliName: "truss-playwright-mcp",
    key: "truss-playwright-mcp",
    name: "Truss Playwright Browser",
  },
  {
    cliName: "truss-chat-tools",
    key: "truss-chat-tools",
    name: "Truss Chat Tools",
  },
  {
    cliName: "truss-filesystem-tools",
    key: "truss-filesystem-tools",
    name: "Truss Filesystem Tools",
  },
  {
    cliName: "truss-command-runner",
    key: "truss-command-runner",
    name: "Truss Command Runner",
  },
  {
    cliName: "truss-orchestration-tools",
    key: "truss-orchestration-tools",
    name: "Truss Orchestration Tools",
  },
] as const;

type BundledMcpServer = (typeof bundledMcpServers)[number];

export interface GlobalMcpConfigOptions {
  conversationWorkspacePath: string | null;
  filesystemGrants?: FilesystemDirectoryGrantsRepository;
  mcpSettings?: McpSettingsRepository;
  projectRoot: string;
  trussHome: TrussHome;
  workspacePath: string;
}

export async function ensureGlobalMcpConfig(options: GlobalMcpConfigOptions): Promise<void> {
  const current = await readGlobalMcpJson(options.trussHome.mcpConfigPath);
  const fileAccessPolicy = await resolveManagedFileAccessPolicy(options);
  const playwrightMcpEnabled = await resolveManagedPlaywrightMcpEnabled(options);

  if (current === null) {
    await writeGlobalMcpJson(options.trussHome.mcpConfigPath, {
      mcpServers: bundledMcpServerDefinitions(options, fileAccessPolicy, playwrightMcpEnabled),
    });
    return;
  }

  if (current === undefined) {
    return;
  }

  const rawServers = current.mcpServers;
  const mcpServers: Record<string, unknown> =
    rawServers && typeof rawServers === "object" && !Array.isArray(rawServers)
      ? { ...rawServers }
      : {};

  const nextServers = { ...mcpServers };
  let changed = false;

  for (const server of bundledMcpServers) {
    const nextBundledDefinition = bundledMcpServerDefinition(
      options,
      server,
      fileAccessPolicy,
      playwrightMcpEnabled,
    );
    const currentBundledDefinition = nextServers[server.key];

    if (isManagedServerOptOut(currentBundledDefinition)) {
      continue;
    }

    if (jsonEqual(currentBundledDefinition, nextBundledDefinition)) {
      continue;
    }

    nextServers[server.key] = nextBundledDefinition;
    changed = true;
  }

  if (!changed) {
    return;
  }

  await writeGlobalMcpJson(options.trussHome.mcpConfigPath, {
    ...current,
    mcpServers: nextServers,
  });
}

export async function loadGlobalMcpServers(
  trussHome: TrussHome,
): Promise<McpLoaderResult> {
  const configFiles = await existingFiles([trussHome.mcpConfigPath]);
  const servers = (
    await Promise.all(configFiles.map((path) => readMcpJsonFile(path, globalSource)))
  ).flat();

  return { source: globalSource, configFiles, servers };
}

export async function restoreGlobalMcpManagedServer(
  options: GlobalMcpConfigOptions,
): Promise<void> {
  const current = await readGlobalMcpJson(options.trussHome.mcpConfigPath);
  const fileAccessPolicy = await resolveManagedFileAccessPolicy(options);
  const playwrightMcpEnabled = await resolveManagedPlaywrightMcpEnabled(options);
  const base = current ?? {};
  const rawServers = base.mcpServers;
  const mcpServers: Record<string, unknown> =
    rawServers && typeof rawServers === "object" && !Array.isArray(rawServers)
      ? { ...rawServers }
      : {};

  await writeGlobalMcpJson(options.trussHome.mcpConfigPath, {
    ...base,
    mcpServers: {
      ...mcpServers,
      ...bundledMcpServerDefinitions(options, fileAccessPolicy, playwrightMcpEnabled),
    },
  });
}

function bundledMcpServerDefinitions(
  options: GlobalMcpConfigOptions,
  fileAccessPolicy: EffectiveFileAccessPolicy,
  playwrightMcpEnabled: boolean,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    bundledMcpServers.map((server) => [
      server.key,
      bundledMcpServerDefinition(options, server, fileAccessPolicy, playwrightMcpEnabled),
    ]),
  );
}

async function resolveManagedFileAccessPolicy(
  options: GlobalMcpConfigOptions,
): Promise<EffectiveFileAccessPolicy> {
  const [grants, readOnlyDirectories] = await Promise.all([
    withFilesystemGrants(options, (repository) =>
      repository.listGrantsForContext(options.conversationWorkspacePath),
    ),
    skillFilesystemAccessDirectories(options.conversationWorkspacePath),
  ]);

  return resolveFileAccessPolicy({
    conversationWorkspacePath: options.conversationWorkspacePath,
    directoryGrants: grants.map(
      (grant): FileAccessDirectoryGrantInput => ({
        directoryPath: grant.directoryPath,
        grantSource: grant.grantSource,
        readOnly: grant.readOnly,
      }),
    ),
    readOnlyDirectories,
    trussHome: options.trussHome,
  });
}

async function withFilesystemGrants<T>(
  options: GlobalMcpConfigOptions,
  callback: (repository: FilesystemDirectoryGrantsRepository) => T | Promise<T>,
): Promise<T> {
  if (options.filesystemGrants) {
    return callback(options.filesystemGrants);
  }

  let database: AppDatabase | null = null;

  try {
    database = openAppDatabase(options.trussHome.dbPath);
    return await callback(new FilesystemDirectoryGrantsRepository(database.db));
  } finally {
    database?.db.close();
  }
}

async function resolveManagedPlaywrightMcpEnabled(
  options: GlobalMcpConfigOptions,
): Promise<boolean> {
  return withMcpSettings(options, (repository) => {
    repository.ensureMcpSettings();
    return repository.getMcpSettings().playwrightMcp.enabled;
  });
}

async function withMcpSettings<T>(
  options: GlobalMcpConfigOptions,
  callback: (repository: McpSettingsRepository) => T | Promise<T>,
): Promise<T> {
  if (options.mcpSettings) {
    return callback(options.mcpSettings);
  }

  let database: AppDatabase | null = null;

  try {
    database = openAppDatabase(options.trussHome.dbPath);
    return await callback(new McpSettingsRepository(database.db));
  } finally {
    database?.db.close();
  }
}

function bundledMcpServerDefinition(
  options: GlobalMcpConfigOptions,
  server: BundledMcpServer,
  fileAccessPolicy: EffectiveFileAccessPolicy,
  playwrightMcpEnabled: boolean,
): Record<string, unknown> {
  const entrypoint = resolveManagedEntrypoint(options);
  const filesystemServer = server.cliName === "truss-filesystem-tools";
  const playwrightMcpServer = server.cliName === "truss-playwright-mcp";
  const disabled =
    (filesystemServer && fileAccessPolicy.roots.length === 0) ||
    (playwrightMcpServer && !playwrightMcpEnabled);

  return {
    _trussManaged: true,
    ...(disabled
      ? {
          _trussDisabledReason: filesystemServer
            ? managedFilesystemDisabledReason(options)
            : managedPlaywrightMcpDisabledReason(),
          disabled: true,
        }
      : {}),
    name: server.name,
    type: "stdio",
    command: entrypoint.command,
    cwd: resolveManagedCwd(options),
    args: [
      ...entrypoint.args,
      "mcp-server",
      server.cliName,
      "--truss-home",
      options.trussHome.dir,
      ...((server.cliName === "truss-chat-tools" ||
        server.cliName === "truss-filesystem-tools") &&
      options.conversationWorkspacePath
        ? ["--workspace-path", options.conversationWorkspacePath]
        : []),
    ],
  };
}

function managedPlaywrightMcpDisabledReason(): string {
  return "Truss Playwright Browser is disabled by default because it exposes interactive browser automation. Enable mcp.playwright_mcp_enabled in Truss MCP Settings to connect it.";
}

function managedFilesystemDisabledReason(options: GlobalMcpConfigOptions): string {
  if (options.conversationWorkspacePath) {
    return "Truss Filesystem Tools are force-disabled because no usable directory is currently granted for the active workspace.";
  }

  return "Truss Filesystem Tools are force-disabled because Truss is running globally, no directory is granted for the global context in Security, and no readable global skill directory is available. File access through Truss's first-party filesystem tools stays disabled until a global grant or readable global skill directory is available.";
}

function isManagedServerOptOut(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)._trussManaged === false
  );
}

function resolveManagedEntrypoint(options: GlobalMcpConfigOptions): {
  args: string[];
  command: string;
} {
  if (isStandaloneRuntime()) {
    return {
      command: process.execPath,
      args: [],
    };
  }

  return {
    command: resolveManagedBunCommand(),
    args: [resolve(options.projectRoot, "src", "server", "index.ts")],
  };
}

function resolveManagedCwd(options: GlobalMcpConfigOptions): string {
  try {
    const workspaceStat = statSync(options.workspacePath);

    return workspaceStat.isDirectory() ? options.workspacePath : dirname(options.workspacePath);
  } catch {
    return options.projectRoot;
  }
}

function resolveManagedBunCommand(): string {
  const executableName = process.platform === "win32" ? "bun.exe" : "bun";
  const installDir = process.env.BUN_INSTALL;
  const candidates = [
    installDir ? join(installDir, "bin", executableName) : null,
    join(homedir(), ".bun", "bin", executableName),
    ...bunPathCandidates(),
    isVersionedNodeModuleBun(process.execPath) ? null : process.execPath,
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return "bun";
}

function bunPathCandidates(): string[] {
  const path = process.env.PATH ?? "";

  return path
    .split(delimiter)
    .filter(Boolean)
    .flatMap((entry) => bunNamesForPlatform().map((name) => join(entry, name)))
    .filter((candidate) => !isVersionedNodeModuleBun(candidate));
}

function bunNamesForPlatform(): string[] {
  return process.platform === "win32" ? ["bun.exe", "bun.cmd", "bun"] : ["bun"];
}

function isVersionedNodeModuleBun(candidate: string): boolean {
  const normalized = candidate.replace(/\\/g, "/").toLowerCase();

  return (
    normalized.endsWith("/node_modules/bun/bin/bun.exe") ||
    dirname(normalized).endsWith("/node_modules/bun/bin")
  );
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function readGlobalMcpJson(
  configPath: string,
): Promise<Record<string, unknown> | null | undefined> {
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return null;
  }

  try {
    const parsed = (await file.json()) as unknown;

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

async function writeGlobalMcpJson(
  configPath: string,
  value: Record<string, unknown>,
): Promise<void> {
  await Bun.write(configPath, `${JSON.stringify(value, null, 2)}\n`);
}
