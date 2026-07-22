import type { McpServerCapabilities, SkillSummary } from "../../shared/protocol.ts";

export interface PromptContextInput {
  mcpCapabilities: McpServerCapabilities[];
  skills: SkillSummary[];
  tokenBudget: number;
}

export interface PromptContext {
  mcpCapabilities: McpServerCapabilities[];
  prunedSkills: SkillSummary[];
  skills: SkillSummary[];
  tokenBudget: number;
}

export function buildPromptContext(input: PromptContextInput): PromptContext {
  const activeSkills = input.skills.filter((skill) => skill.active);
  const prunedSkills = input.skills.filter((skill) => !skill.active);

  return {
    mcpCapabilities: input.mcpCapabilities,
    prunedSkills,
    skills: activeSkills,
    tokenBudget: input.tokenBudget,
  };
}
