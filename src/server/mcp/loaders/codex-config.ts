import { join } from "node:path";
import { existingFiles, readCodexConfigFile } from "../config-json.ts";
import type { McpConfigLoader, McpLoaderResult } from "../types.ts";

export const codexConfigLoader: McpConfigLoader = {
  source: "codex",
  candidatePaths: (workspacePath) => [
    join(workspacePath, ".codex", "config.toml"),
  ],
  async load(workspacePath): Promise<McpLoaderResult> {
    const configFiles = await existingFiles(this.candidatePaths(workspacePath));
    const servers = (
      await Promise.all(configFiles.map((path) => readCodexConfigFile(path, this.source)))
    ).flat();

    return { source: this.source, configFiles, servers };
  },
};
