import { join } from "node:path";
import { existingFiles, readMcpJsonFile } from "../config-json.ts";
import type { McpConfigLoader, McpLoaderResult } from "../types.ts";

export const cursorConfigLoader: McpConfigLoader = {
  source: "cursor",
  candidatePaths: (workspacePath) => [
    join(workspacePath, ".cursor", "mcp.json"),
  ],
  async load(workspacePath): Promise<McpLoaderResult> {
    const configFiles = await existingFiles(this.candidatePaths(workspacePath));
    const servers = (
      await Promise.all(configFiles.map((path) => readMcpJsonFile(path, this.source)))
    ).flat();

    return { source: this.source, configFiles, servers };
  },
};
