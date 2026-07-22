import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";

export interface StandaloneRuntimeSignals {
  argvEntry?: string;
  bunMain?: string;
  execPath?: string;
  isStandaloneExecutable?: boolean;
}

export function currentStandaloneRuntimeSignals(): StandaloneRuntimeSignals {
  const runtime = Bun as unknown as { isStandaloneExecutable?: boolean };

  return {
    argvEntry: process.argv[1],
    bunMain: Bun.main,
    execPath: process.execPath,
    isStandaloneExecutable: runtime.isStandaloneExecutable,
  };
}

export function isStandaloneRuntime(
  signals: StandaloneRuntimeSignals = currentStandaloneRuntimeSignals(),
): boolean {
  return (
    signals.isStandaloneExecutable === true ||
    isEmbeddedBunPath(signals.bunMain) ||
    isEmbeddedBunPath(signals.argvEntry)
  );
}

export function resolveProjectRoot(
  importMetaDir: string,
  signals: StandaloneRuntimeSignals = currentStandaloneRuntimeSignals(),
): string {
  if (isStandaloneRuntime(signals) && signals.execPath) {
    return dirname(signals.execPath);
  }

  return resolveSourceProjectRoot(importMetaDir);
}

function isEmbeddedBunPath(value: string | undefined): boolean {
  return Boolean(value?.replace(/\\/g, "/").includes("/~BUN/root/"));
}

function resolveSourceProjectRoot(importMetaDir: string): string {
  const sourceRoot = resolve(importMetaDir, "../..");
  const bundledRoot = resolve(importMetaDir, "..");

  if (looksLikeProjectRoot(sourceRoot)) {
    return sourceRoot;
  }

  if (looksLikeProjectRoot(bundledRoot)) {
    return bundledRoot;
  }

  return sourceRoot;
}

function looksLikeProjectRoot(candidate: string): boolean {
  return existsSync(resolve(candidate, "package.json")) && existsSync(resolve(candidate, "public"));
}
