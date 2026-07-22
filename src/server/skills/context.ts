import { toSkillSummary } from "./parser.ts";
import type { SkillContextSelection, SkillDiscovery, SkillDocument } from "./types.ts";

const DEFAULT_SKILL_CONTEXT_TOKEN_BUDGET = 6_000;

export function createSkillContext(
  discovery: SkillDiscovery,
  tokenBudget = DEFAULT_SKILL_CONTEXT_TOKEN_BUDGET,
): SkillContextSelection {
  const active: SkillDocument[] = [];
  const pruned: SkillDocument[] = [];
  let usedTokens = 0;

  for (const skill of discovery.skills) {
    if (usedTokens + skill.tokenEstimate <= tokenBudget) {
      active.push(skill);
      usedTokens += skill.tokenEstimate;
    } else {
      pruned.push(skill);
    }
  }

  return {
    active,
    pruned,
    summary: {
      discoveredSkills: discovery.skills.length,
      activeSkills: active.length,
      directories: discovery.directories,
      skills: [
        ...active.map((skill) => toSkillSummary(skill, true)),
        ...pruned.map((skill) => toSkillSummary(skill, false)),
      ],
    },
  };
}
