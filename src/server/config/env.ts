import { existsSync, readFileSync } from "node:fs";
import * as dotenvx from "@dotenvx/dotenvx";
import type { LlmProviderSecretSummary } from "../../shared/protocol.ts";

export interface SecretEnvStoreOptions {
  envKeysPath: string;
  envPath: string;
}

export class SecretEnvStore {
  readonly #envKeysPath: string;
  readonly #envPath: string;
  #values: Record<string, string> = {};

  constructor(options: SecretEnvStoreOptions) {
    this.#envPath = options.envPath;
    this.#envKeysPath = options.envKeysPath;
  }

  get envPath(): string {
    return this.#envPath;
  }

  get envKeysPath(): string {
    return this.#envKeysPath;
  }

  load(): Record<string, string> {
    const processEnv: Record<string, string> = {};
    const result = dotenvx.config({
      envKeysFile: this.#envKeysPath,
      ignore: ["MISSING_ENV_FILE"],
      noArmor: true,
      path: this.#envPath,
      processEnv,
      quiet: true,
      overload: true,
    });

    if (result.error) {
      console.warn(`[config] Could not load Truss secret env: ${result.error.message}`);
    }

    this.#values = toStringRecord(result.parsed ?? processEnv);
    return this.values();
  }

  values(): Record<string, string> {
    return { ...this.#values };
  }

  mergedWithProcessEnv(): NodeJS.ProcessEnv {
    return { ...process.env, ...this.#values };
  }

  async setSecret(envVar: string, value: string): Promise<void> {
    assertEnvVarName(envVar);

    const trimmed = value.trim();

    if (!trimmed) {
      await this.removeSecret(envVar);
      return;
    }

    const result = dotenvx.set(envVar, trimmed, {
      encrypt: true,
      envKeysFile: this.#envKeysPath,
      noArmor: true,
      path: this.#envPath,
    });

    const error = result.processedEnvs.find((item) => item.error)?.error;

    if (error) {
      throw error;
    }

    this.load();
  }

  async removeSecret(envVar: string): Promise<void> {
    assertEnvVarName(envVar);

    if (!existsSync(this.#envPath)) {
      delete this.#values[envVar];
      return;
    }

    const source = await Bun.file(this.#envPath).text();
    const keyPattern = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(envVar)}\\s*=`);
    const next = source
      .split(/\r?\n/)
      .filter((line) => !keyPattern.test(line))
      .join("\n")
      .trimEnd();

    await Bun.write(this.#envPath, `${next}\n`);
    this.load();
  }

  describeSecret(envVar: string, processEnv: NodeJS.ProcessEnv = process.env): LlmProviderSecretSummary {
    assertEnvVarName(envVar);

    const trussValue = this.#values[envVar];

    if (trussValue) {
      return {
        envVar,
        configured: true,
        encrypted: this.#isEncryptedInEnvFile(envVar),
        source: "truss-env",
      };
    }

    if (processEnv[envVar]) {
      return {
        envVar,
        configured: true,
        encrypted: false,
        source: "process-env",
      };
    }

    return {
      envVar,
      configured: false,
      encrypted: false,
      source: "missing",
    };
  }

  listSecrets(prefix = "", processEnv: NodeJS.ProcessEnv = process.env): LlmProviderSecretSummary[] {
    const names = new Set([
      ...Object.keys(this.#values),
      ...Object.keys(processEnv).filter((key) => typeof processEnv[key] === "string"),
      ...this.#envFileSecretNames(),
    ]);

    return [...names]
      .filter((name) => (!prefix || name.startsWith(prefix)) && /^[A-Z_][A-Z0-9_]*$/.test(name))
      .sort((left, right) => left.localeCompare(right))
      .map((name) => this.describeSecret(name, processEnv));
  }

  #isEncryptedInEnvFile(envVar: string): boolean {
    if (!existsSync(this.#envPath)) {
      return false;
    }

    const source = readFileSync(this.#envPath, "utf8");
    const match = source.match(
      new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(envVar)}\\s*=\\s*(.+)$`, "m"),
    );

    if (!match?.[1]) {
      return false;
    }

    return stripQuotes(match[1].trim()).startsWith("encrypted:");
  }

  #envFileSecretNames(): string[] {
    if (!existsSync(this.#envPath)) {
      return [];
    }

    const source = readFileSync(this.#envPath, "utf8");

    return source
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/)?.[1] ?? "")
      .filter(Boolean);
  }
}

function toStringRecord(value: Record<string, string> | undefined): Record<string, string> {
  const record: Record<string, string> = {};

  for (const [key, item] of Object.entries(value ?? {})) {
    if (typeof item === "string") {
      record[key] = item;
    }
  }

  return record;
}

function assertEnvVarName(envVar: string): void {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(envVar)) {
    throw new Error(`Invalid environment variable name: ${envVar}`);
  }
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
