import type { SkillDiscoverySummary, SkillSummary } from "../../shared/protocol.ts";

export interface SkillDocument {
  id: string;
  name: string;
  description?: string;
  path: string;
  body: string;
  scope: "global" | "workspace";
  source: string;
  tokenEstimate: number;
}

export interface SkillSearchRoot {
  path: string;
  scope: "global" | "workspace";
  source: string;
}

export interface SkillDiscovery {
  directories: string[];
  skills: SkillDocument[];
}

export interface SkillContextSelection {
  active: SkillDocument[];
  pruned: SkillDocument[];
  summary: SkillDiscoverySummary;
}

export type { SkillSummary };
