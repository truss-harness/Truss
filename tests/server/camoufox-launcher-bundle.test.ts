import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const nodeBuiltins = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "stream/promises",
  "string_decoder",
  "sys",
  "timers",
  "timers/promises",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
  // node: prefixed variants
  "node:assert",
  "node:async_hooks",
  "node:buffer",
  "node:child_process",
  "node:cluster",
  "node:console",
  "node:constants",
  "node:crypto",
  "node:dgram",
  "node:diagnostics_channel",
  "node:dns",
  "node:domain",
  "node:events",
  "node:fs",
  "node:fs/promises",
  "node:http",
  "node:http2",
  "node:https",
  "node:inspector",
  "node:module",
  "node:net",
  "node:os",
  "node:path",
  "node:perf_hooks",
  "node:process",
  "node:punycode",
  "node:querystring",
  "node:readline",
  "node:repl",
  "node:stream",
  "node:stream/promises",
  "node:string_decoder",
  "node:sys",
  "node:timers",
  "node:timers/promises",
  "node:tls",
  "node:trace_events",
  "node:tty",
  "node:url",
  "node:util",
  "node:v8",
  "node:vm",
  "node:wasi",
  "node:worker_threads",
  "node:zlib",
]);

describe("Camoufox launcher bundle", () => {
  it("is self-contained and has no top-level npm imports", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "truss-camoufox-bundle-"));

    try {
      const bundleResult = spawnSync(
        "bun",
        ["run", "src/server/cli/bundle-launcher.ts", tempDir],
        {
          encoding: "utf8",
          windowsHide: true,
        },
      );

      expect(bundleResult.status).toBe(0);
      expect(bundleResult.stderr).toBe("");

      const bundlePath = join(tempDir, "camoufox-launcher.mjs");
      const bundle = await readFile(bundlePath, "utf8");

      // Top-level ESM imports in the bundle should only reference Node built-ins.
      // Any npm package left as an external import (e.g. "playwright") will break
      // the installed Windows version where no node_modules exist.
      const topLevelImportRe = /^import\s+[\s\S]*?\s+from\s+["']([^"\']+)["']/gm;
      const externalImports: string[] = [];

      for (const match of bundle.matchAll(topLevelImportRe)) {
        const specifier = match[1];
        if (!specifier) {
          continue;
        }
        if (
          !specifier.startsWith("node:") &&
          !nodeBuiltins.has(specifier) &&
          !specifier.startsWith(".")
        ) {
          externalImports.push(specifier);
        }
      }

      expect(externalImports).toEqual([]);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
