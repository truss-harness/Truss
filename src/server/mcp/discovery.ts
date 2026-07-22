import type { McpDiscoverySummary } from "../../shared/protocol.ts";
import { mcpConfigLoaders } from "./registry.ts";
import type { McpLoaderResult, McpSourceResult } from "./types.ts";

export async function discoverMcpServers(workspacePath: string): Promise<McpDiscoverySummary> {
  const result = await loadWorkspaceMcpServers(workspacePath);

  return {
    availableTools: 0,
    configPath: "",
    connectedServers: 0,
    connectingServers: 0,
    discoveredServers: result.servers.length,
    failedServers: 0,
    servers: [],
    sources: loaderSourceSummaries(result),
  };
}

export async function loadWorkspaceMcpServers(workspacePath: string): Promise<McpLoaderResult> {
  return combineMcpLoaderResults(
    await Promise.all(mcpConfigLoaders.map((loader) => loader.load(workspacePath))),
    "workspace-discovered",
  );
}

export function combineMcpLoaderResults(
  results: McpLoaderResult[],
  source: string,
): McpLoaderResult {
  return {
    source,
    configFiles: results.flatMap((result) => result.configFiles),
    servers: results.flatMap((result) => result.servers),
    sources: results.flatMap(loaderSourceSummaries),
  };
}

export function loaderSourceSummaries(result: McpLoaderResult): McpSourceResult[] {
  return result.sources ?? [
    {
      source: result.source,
      configFiles: result.configFiles,
      serverCount: result.servers.length,
    },
  ];
}
