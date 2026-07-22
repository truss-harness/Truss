import type { ToolRequestEvent } from "../../shared/protocol.ts";
import { createNativeToolEnvelope } from "./envelope.ts";

export function createClarificationToolRequest(): ToolRequestEvent {
  return createNativeToolEnvelope({
    toolId: "clarify_next_step",
    title: "Clarify the next harness action",
    args: {
      question: "Which initialization path should the local agentic loop take next?",
      options: [
        "Scan this workspace for MCP server configs",
        "Load local SKILL.md files",
        "Start with a clean chat session",
      ],
    },
  });
}
