import { join } from "node:path";
import { existingFiles, readMcpJsonFile } from "../config-json.ts";
import type { McpConfigLoader, McpLoaderResult } from "../types.ts";

export const claudeConfigLoader: McpConfigLoader = {
  source: "claude",
  candidatePaths: (workspacePath) => [
    join(workspacePath, ".mcp.json"),
  ],
  async load(workspacePath): Promise<McpLoaderResult> {
    const configFiles = await existingFiles(this.candidatePaths(workspacePath));
    const servers = (
      await Promise.all(configFiles.map((path) => readMcpJsonFile(path, this.source)))
    ).flat();

    return { source: this.source, configFiles, servers };
  },
};
