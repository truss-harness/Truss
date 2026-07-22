import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface TrussHome {
  /** Absolute path to the ~/.truss directory. */
  dir: string;
  /** Absolute path to the SQLite database file. */
  dbPath: string;
  /** Absolute path to the file-access security configuration file. */
  fileAccessConfigPath: string;
  /** Absolute path to the global MCP server configuration file. */
  mcpConfigPath: string;
  /** Absolute path to the dotenvx-encrypted env file. */
  envPath: string;
  /** Absolute path to the private dotenvx key file. */
  envKeysPath: string;
}

export interface EnsureTrussHomeOptions {
  log?(message: string): void;
}

export function trussHomeFromDir(dir: string): TrussHome {
  const resolvedDir = resolve(dir);

  return {
    dir: resolvedDir,
    dbPath: join(resolvedDir, "truss.db"),
    envPath: join(resolvedDir, ".env"),
    envKeysPath: join(resolvedDir, ".env.keys"),
    fileAccessConfigPath: join(resolvedDir, "file-access.json"),
    mcpConfigPath: join(resolvedDir, "mcp.json"),
  };
}

/**
 * Resolves the ~/.truss directory and creates it on first run.
 * Also creates the encrypted .env file if it does not yet exist,
 * so dotenvx has a file to work with on the very first startup.
 */
export async function ensureTrussHome(
  dir = join(homedir(), ".truss"),
  options: EnsureTrussHomeOptions = {},
): Promise<TrussHome> {
  const home = trussHomeFromDir(dir);
  const log = options.log ?? ((message: string) => console.log(message));

  if (!existsSync(home.dir)) {
    await mkdir(home.dir, { recursive: true });
    log(`[setup] Created Truss home directory: ${home.dir}`);
  }

  // Create an empty .env stub so dotenvx can encrypt it on first run.
  if (!existsSync(home.envPath)) {
    await Bun.write(home.envPath, "# Truss secrets - managed by dotenvx\n");
    log(`[setup] Created env file: ${home.envPath}`);
  }

  return home;
}
