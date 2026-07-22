import type {
  AgentSessionType,
  LlmModelProfileId,
  LlmModelProfileSummary,
} from "../../shared/protocol.ts";
import type {
  LlmModelProfile,
  LlmModelProfileDefaults,
} from "../storage/model-profiles.ts";
import { getLlmProvider } from "./registry.ts";

export function getLlmModelProfileDefaults(): LlmModelProfileDefaults[] {
  return [
    {
      id: "fast-helper",
      label: "Fast helper",
      description: "Small, quick utility model for titles and lightweight internal niceties.",
      providerId: "ollama",
      modelId: "llama3.2",
      parameters: {
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
        contextSize: 4096,
      },
    },
    {
      id: "conversation",
      label: "Conversation",
      description: "Default model profile for ordinary chat sessions.",
      providerId: "ollama",
      modelId: "llama3.1",
      parameters: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        contextSize: 8192,
      },
    },
    {
      id: "agentic",
      label: "Agentic",
      description: "Default model profile for tool-using and multi-step agent sessions.",
      providerId: "ollama",
      modelId: "codellama",
      parameters: {
        temperature: 0.25,
        topP: 0.9,
        topK: 40,
        contextSize: 16384,
      },
    },
  ];
}

export function summarizeModelProfiles(
  profiles: LlmModelProfile[],
): LlmModelProfileSummary[] {
  return profiles.map((profile) => {
    const provider = getLlmProvider(profile.providerId);

    return {
      id: profile.id,
      label: profile.label,
      description: profile.description,
      providerId: profile.providerId,
      providerLabel: provider?.label ?? profile.providerId,
      modelId: profile.modelId,
      parameters: profile.parameters,
    };
  });
}

export function defaultProfileIdForAgentSessionType(
  type: AgentSessionType,
): LlmModelProfileId {
  return type === "conversation" ? "conversation" : "agentic";
}
