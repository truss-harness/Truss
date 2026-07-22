import type {
  LlmProviderSummary,
  LlmModelProfileSummary,
  McpDiscoverySummary,
  SessionInfo,
  FirstRunSetupSummary,
  SkillDiscoverySummary,
} from "../../shared/protocol.ts";

export interface SessionSnapshotOptions {
  llmProviders: LlmProviderSummary[];
  modelProfiles: LlmModelProfileSummary[];
  mcp: McpDiscoverySummary;
  setup: FirstRunSetupSummary;
  port: number;
  skills: SkillDiscoverySummary;
  startedAt: string;
  databasePath: string;
  conversationWorkspacePath: string | null;
  workspacePath: string;
}

export function createSessionSnapshot(options: SessionSnapshotOptions): SessionInfo {
  return {
    appName: "Truss",
    workspacePath: options.workspacePath,
    conversationScope: {
      databasePath: options.databasePath,
      mode: options.conversationWorkspacePath ? "workspace" : "all",
      workspacePath: options.conversationWorkspacePath ?? options.workspacePath,
    },
    startedAt: options.startedAt,
    port: options.port,
    transports: {
      downstream: "sse",
      upstream: "http-post",
    },
    capabilities: [
      "dynamic-local-port",
      "server-sent-events",
      "http-post-commands",
      "tool-interception",
      "custom-markdown-rendering",
      "workspace-scoped-spawn",
      "global-mcp-config",
      "llm-provider-registry",
      "llm-provider-settings",
      "llm-model-profiles",
      "agent-session-storage",
      "sqlite-settings-storage",
      "dotenvx-secret-env",
      "skill-autoloading",
      "context-window-pruning",
      "mcp-json-rpc-routing",
      "mcp-tool-execution",
      "mcp-approval-callbacks",
    ],
    mcp: options.mcp,
    llmProviders: options.llmProviders,
    modelProfiles: options.modelProfiles,
    setup: options.setup,
    skills: options.skills,
  };
}
