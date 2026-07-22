import { build } from "bun";
import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";

async function main() {
  const args = process.argv.slice(2);
  const outdir = args[0] ? resolve(args[0]) : resolve(".tmp/launcher");

  console.log(`Bundling Camoufox launcher to ${outdir}...`);

  const result = await build({
    entrypoints: [resolve("src/server/utils/camoufox-launcher-child.ts")],
    outdir,
    target: "node",
    external: ["electron"],
    // @playwright/mcp depends on "playwright" which is just a thin wrapper around "playwright-core".
    // Aliasing here ensures the bundle is self-contained (no runtime node_modules lookup needed),
    // which is required for the installed version where no node_modules exist on the path.
    // @ts-expect-error Bun's BuildConfig type does not yet include the alias option, but it is supported at runtime.
    alias: { playwright: "playwright-core" },
    plugins: [{
      name: "patch-package-json",
      setup(build) {
        build.onLoad({ filter: /@playwright(\\|\/)mcp(\\|\/)lib(\\|\/)package\.js$/ }, async () => {
          return {
            contents: `export const packageJSON = { version: "0.0.29" };`,
            loader: "js"
          };
        });
      }
    }],
    naming: "camoufox-launcher.mjs",
  });

  if (!result.success) {
    console.error("Bundle failed:");
    for (const error of result.logs) {
      console.error(error);
    }
    process.exit(1);
  }

  console.log("Bundle successful!");
}

void main();

