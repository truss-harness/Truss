import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  isStandaloneRuntime,
  resolveProjectRoot,
} from "../../src/server/runtime/project-root.ts";

describe("project root resolution", () => {
  it("uses the package root when running from source", () => {
    const importMetaDir = resolve("repo", "src", "server");

    expect(resolveProjectRoot(importMetaDir, { execPath: resolve("bun") })).toBe(
      resolve(importMetaDir, "../.."),
    );
  });

  it("uses the executable directory when running as a standalone binary", () => {
    const executablePath = resolve("installed", "truss.exe");

    expect(
      resolveProjectRoot(resolve("embedded", "src", "server"), {
        execPath: executablePath,
        isStandaloneExecutable: true,
      }),
    ).toBe(dirname(executablePath));
  });

  it("detects Bun embedded root paths from compiled executables", () => {
    expect(
      isStandaloneRuntime({
        argvEntry: "B:/~BUN/root/src/server/index.ts",
      }),
    ).toBe(true);
  });

  it("uses the package root when running from a bundled dist file", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "truss-project-root-"));

    try {
      await mkdir(resolve(root, "dist"), { recursive: true });
      await mkdir(resolve(root, "public"), { recursive: true });
      await writeFile(resolve(root, "package.json"), "{}\n");

      expect(resolveProjectRoot(resolve(root, "dist"), { execPath: resolve("bun") })).toBe(root);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
