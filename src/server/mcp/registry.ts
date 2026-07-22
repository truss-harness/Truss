import { claudeConfigLoader } from "./loaders/claude-config.ts";
import { codexConfigLoader } from "./loaders/codex-config.ts";
import { cursorConfigLoader } from "./loaders/cursor-config.ts";
import { githubCopilotConfigLoader } from "./loaders/github-copilot-config.ts";
import { junieConfigLoader } from "./loaders/junie-config.ts";
import type { McpConfigLoader } from "./types.ts";

export const mcpConfigLoaders: McpConfigLoader[] = [
  claudeConfigLoader,
  codexConfigLoader,
  cursorConfigLoader,
  githubCopilotConfigLoader,
  junieConfigLoader,
];
