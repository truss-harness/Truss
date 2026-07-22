import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import { discoverSkills } from "../../src/server/skills/discovery.ts";
import type { SkillSearchRoot } from "../../src/server/skills/types.ts";

describe("skill discovery", () => {
  it("loads global skills and workspace provider skills only in workspace mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-skills-discovery-"));

    try {
      const workspace = join(root, "workspace");
      const globalSkills = join(root, "global", "skills");
      const globalRoots: SkillSearchRoot[] = [
        { path: globalSkills, scope: "global", source: "codex" },
      ];

      await writeSkill(join(globalSkills, "global-docs", "SKILL.md"), {
        description: "Global documentation guidance",
        name: "global-docs",
      });
      await writeSkill(join(workspace, ".codex", "skills", "codex-docs", "SKILL.md"), {
        description: "Codex workspace guidance",
        name: "codex-docs",
      });
      await writeSkill(join(workspace, ".claude", "skills", "claude-docs", "SKILL.md"), {
        description: "Claude workspace guidance",
        name: "claude-docs",
      });
      await writeSkill(join(workspace, ".cursor", "skills", "cursor-docs", "SKILL.md"), {
        description: "Cursor workspace guidance",
        name: "cursor-docs",
      });
      await writeSkill(join(workspace, ".github", "skills", "copilot-docs", "SKILL.md"), {
        description: "GitHub Copilot workspace guidance",
        name: "copilot-docs",
      });
      await writeSkill(join(workspace, ".junie", "skills", "junie-docs", "SKILL.md"), {
        description: "Junie workspace guidance",
        name: "junie-docs",
      });

      const globalOnly = await discoverSkills({
        globalRoots,
        workspacePath: null,
      });
      const scoped = await discoverSkills({
        globalRoots,
        workspacePath: workspace,
      });

      expect(globalOnly.skills.map((skill) => skill.name).sort()).toEqual(["global-docs"]);
      expect(scoped.skills.map((skill) => skill.name).sort()).toEqual([
        "claude-docs",
        "codex-docs",
        "copilot-docs",
        "cursor-docs",
        "global-docs",
        "junie-docs",
      ]);
      expect(scoped.skills.find((skill) => skill.name === "global-docs")).toMatchObject({
        scope: "global",
        source: "codex",
      });
      expect(scoped.skills.find((skill) => skill.name === "copilot-docs")).toMatchObject({
        scope: "workspace",
        source: "github-copilot",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

async function writeSkill(
  path: string,
  frontmatter: {
    description: string;
    name: string;
  },
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(
    path,
    [
      "---",
      `name: ${frontmatter.name}`,
      `description: ${frontmatter.description}`,
      "---",
      "",
      `# ${frontmatter.name}`,
      "",
    ].join("\n"),
  );
}
