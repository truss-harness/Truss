import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { inspectFileAccessWorkspaceTree } from "../../src/server/security/file-access-inspection.ts";

describe("inspectFileAccessWorkspaceTree", () => {
  test("explains workspace, read-only grant, and ignore-pattern access rules", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "truss-file-access-inspection-"));
    const readonlyDirectory = join(workspace, "readonly");

    try {
      await mkdir(join(workspace, "src"));
      await mkdir(readonlyDirectory);
      await writeFile(join(workspace, "src", "app.ts"), "console.log('ok');\n");
      await writeFile(join(workspace, ".env"), "SECRET=value\n");
      await writeFile(join(readonlyDirectory, "notes.md"), "# Notes\n");

      const root = await inspectFileAccessWorkspaceTree({
        conversationWorkspacePath: workspace,
        directoryGrants: [
          {
            directoryPath: readonlyDirectory,
            grantSource: "user-dialog",
            readOnly: true,
          },
        ],
      });
      const entries = new Map(root.children.map((entry) => [entry.name, entry]));

      expect(root.directory.access).toBe("read-write");
      expect(root.directory.rule).toContain("active workspace root");
      expect(entries.get("src")?.access).toBe("read-write");
      expect(entries.get("readonly")?.access).toBe("read-only");
      expect(entries.get("readonly")?.rule).toContain("user-approved directory grant");
      expect(entries.get(".env")?.access).toBe("deny");
      expect(entries.get(".env")?.rule).toContain('ignore pattern ".env"');

      const readonly = await inspectFileAccessWorkspaceTree({
        conversationWorkspacePath: workspace,
        directoryGrants: [
          {
            directoryPath: readonlyDirectory,
            grantSource: "user-dialog",
            readOnly: true,
          },
        ],
        directoryPath: readonlyDirectory,
      });

      expect(readonly.directory.access).toBe("read-only");
      expect(readonly.children[0]?.name).toBe("notes.md");
      expect(readonly.children[0]?.access).toBe("read-only");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
