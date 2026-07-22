import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  executeTrussChatTool,
} from "../../src/server/mcp/servers/truss-chat-tools/server.ts";
import type { TrussChatToolsRuntime } from "../../src/server/mcp/servers/truss-chat-tools/runtime.ts";
import { discoverSkills } from "../../src/server/skills/discovery.ts";

describe("Truss Chat Tools skills", () => {
  it("reads a discovered global skill by skill id", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-chat-tools-skills-"));
    const previousGlobalSkillDirs = process.env.TRUSS_GLOBAL_SKILL_DIRS;

    try {
      const globalSkills = join(root, "global-skills");
      process.env.TRUSS_GLOBAL_SKILL_DIRS = globalSkills;

      await writeSkill(join(globalSkills, "global-docs", "SKILL.md"));

      const discovery = await discoverSkills({ workspacePath: null });
      const skill = discovery.skills.find((item) => item.name === "global-docs");

      expect(skill).toBeTruthy();

      const resultText = await executeTrussChatTool({
        args: { skillId: skill?.id },
        runtime: { workspacePath: null } as TrussChatToolsRuntime,
        toolName: "read_skill",
      });
      const result = JSON.parse(resultText) as {
        body: string;
        skill: { id: string; name: string; scope: string; source: string };
      };

      expect(result.skill).toMatchObject({
        id: skill?.id,
        name: "global-docs",
        scope: "global",
        source: "configured",
      });
      expect(result.body).toContain("Use when reading global documentation.");
    } finally {
      restoreEnv("TRUSS_GLOBAL_SKILL_DIRS", previousGlobalSkillDirs);
      await rm(root, { force: true, recursive: true });
    }
  });
});

async function writeSkill(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(
    path,
    [
      "---",
      "name: global-docs",
      "description: Global documentation guidance",
      "---",
      "",
      "# global-docs",
      "",
      "Use when reading global documentation.",
      "",
    ].join("\n"),
  );
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
