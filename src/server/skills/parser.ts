import { basename, dirname } from "node:path";
import type { SkillDocument, SkillSearchRoot } from "./types.ts";

interface ParsedSkillHeader {
  description?: string;
  name?: string;
}

export async function parseSkillFile(
  path: string,
  root: SkillSearchRoot = {
    path: dirname(path),
    scope: "workspace",
    source: "workspace",
  },
): Promise<SkillDocument | null> {
  const file = Bun.file(path);

  if (!(await file.exists())) {
    return null;
  }

  const body = await file.text();
  const header = parseSkillHeader(body);
  const inferredName = basename(dirname(path));

  return {
    id: createSkillId(path),
    name: header.name ?? inferredName,
    description: header.description,
    path,
    body,
    scope: root.scope,
    source: root.source,
    tokenEstimate: estimateTokens(body),
  };
}

export function toSkillSummary(skill: SkillDocument, active: boolean) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    path: skill.path,
    active,
    scope: skill.scope,
    source: skill.source,
    tokenEstimate: skill.tokenEstimate,
  };
}

function parseSkillHeader(body: string): ParsedSkillHeader {
  const firstHeading = body.match(/^#\s+(.+)$/m);
  const name = body.match(/^name:\s*(.+)$/im);
  const description = body.match(/^description:\s*(.+)$/im);

  return {
    name: name?.[1]?.trim() ?? firstHeading?.[1]?.trim(),
    description: description?.[1]?.trim(),
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.trim().split(/\s+/).filter(Boolean).length * 1.35);
}

function createSkillId(path: string): string {
  return `skill:${path.replace(/[^a-zA-Z0-9]+/g, ":").replace(/^:+|:+$/g, "").toLowerCase()}`;
}
