import process from "node:process";
import { runCli } from "./cli/run.ts";
import { resolveProjectRoot } from "./runtime/project-root.ts";

const projectRoot = resolveProjectRoot(import.meta.dir);

void runCli({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  projectRoot,
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
