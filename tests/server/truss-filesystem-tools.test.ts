import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  executeTrussFilesystemTool,
  executeTrussFilesystemToolValue,
  type TrussFilesystemToolName,
} from "../../src/server/mcp/servers/truss-filesystem-tools/server.ts";
import { createTrussFilesystemToolsMcpRuntime } from "../../src/server/mcp/servers/truss-filesystem-tools/runtime.ts";
import { ensureTrussHome } from "../../src/server/setup/truss-home.ts";
import { openAppDatabase, type AppDatabase } from "../../src/server/storage/database.ts";
import { FilesystemDirectoryGrantsRepository } from "../../src/server/storage/filesystem-directory-grants.ts";

const accessDeniedMessage = "Access denied. Path is outside the permitted boundary.";

describe("Truss Filesystem Tools MCP server", () => {
  it("requires a workspace path or granted directory", async () => {
    await expect(createTrussFilesystemToolsMcpRuntime()).rejects.toThrow(
      "Truss Filesystem Tools require --workspace-path or at least one granted directory.",
    );
  });

  it("returns active file-access grants without reading directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-filesystem-grants-"));
    const workspace = join(root, "workspace");
    const extra = join(root, "extra");

    try {
      await mkdir(workspace);
      await mkdir(extra);

      const runtime = await createTrussFilesystemToolsMcpRuntime(workspace, {
        allowedDirectories: [extra],
      });
      const grants = await callTool(runtime, "get_file_access_grants", {});
      const resolvedWorkspace = await realpath(workspace);
      const resolvedExtra = await realpath(extra);

      expect(grants.grants).toEqual([
        {
          access: "read-write",
          isPrimary: true,
          path: resolvedWorkspace,
          readOnly: false,
          scope: "workspace",
          source: "workspace",
        },
        {
          access: "read-write",
          isPrimary: false,
          path: resolvedExtra,
          readOnly: false,
          scope: "workspace",
          source: "cli-arg",
        },
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("lists, reads, writes, and searches files inside the workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "truss-filesystem-tools-"));

    try {
      await mkdir(join(workspace, "src"));
      await writeFile(join(workspace, "src", "alpha.txt"), "one\ntwo beta\nthree\n");

      const runtime = await createTrussFilesystemToolsMcpRuntime(workspace);

      const list = await callTool(runtime, "list_directory", { path: "src" });
      expect(list.entries.map((entry: { name: string }) => entry.name)).toEqual(["alpha.txt"]);

      const read = await callTool(runtime, "read_text_file", {
        lineCount: 1,
        path: "src/alpha.txt",
        startLine: 2,
      });
      expect(read.content).toBe("two beta");
      expect(read.totalLines).toBe(4);

      const write = await callTool(runtime, "write_text_file", {
        content: "created inside workspace\n",
        path: "src/generated.txt",
      });
      expect(write.path).toBe("src/generated.txt");
      expect(write.existed).toBe(false);

      const emptyWrite = await callTool(runtime, "write_text_file", {
        content: "",
        path: "src/empty.txt",
      });
      expect(emptyWrite.bytesWritten).toBe(0);

      const replacement = await callTool(runtime, "write_text_file", {
        content: "replace",
        path: "src/generated.txt",
      });
      expect(replacement.overwritten).toBe(true);
      expect(await readFile(join(workspace, "src", "generated.txt"), "utf8")).toBe("replace");

      await expect(
        executeTrussFilesystemTool({
          args: { content: "blocked", overwrite: false, path: "src/generated.txt" },
          runtime,
          toolName: "write_text_file",
        }),
      ).rejects.toThrow("already exists");

      const filenames = await callTool(runtime, "search_filenames", {
        path: ".",
        query: "generated",
      });
      expect(filenames.matches.map((match: { path: string }) => match.path)).toEqual([
        "src/generated.txt",
      ]);

      const regex = await callTool(runtime, "regex_search_files", {
        context_lines: 1,
        path: ".",
        pattern: "two\\s+beta",
      });
      expect(regex.matches).toContainEqual({
        after: [{ content: "three", line: 3 }],
        before: [{ content: "one", line: 1 }],
        column: 1,
        line: 2,
        path: "src/alpha.txt",
        preview: "two beta",
      });

      const fileRegex = await callTool(runtime, "regex_search_files", {
        path: "src/alpha.txt",
        pattern: "two\\s+beta",
      });
      expect(fileRegex).toMatchObject({
        count: 1,
        path: "src/alpha.txt",
        searchedFiles: 1,
        skippedDirectories: 0,
      });
      expect(fileRegex.matches).toContainEqual({
        after: [],
        before: [],
        column: 1,
        line: 2,
        path: "src/alpha.txt",
        preview: "two beta",
      });

      const tree = await callTool(runtime, "directory_tree", { limit: 2 });
      expect(tree.count).toBe(2);
      expect(tree.truncated).toBe(true);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("allows reads but blocks mutations in read-only skill directories", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "truss-filesystem-readonly-skills-"));

    try {
      const skillDirectory = join(workspace, ".codex", "skills", "docs");
      await mkdir(skillDirectory, { recursive: true });
      await writeFile(
        join(skillDirectory, "SKILL.md"),
        "---\nname: docs\ndescription: Documentation guidance\n---\n\n# Docs\n",
      );

      const runtime = await createTrussFilesystemToolsMcpRuntime(workspace, {
        readOnlyDirectories: [join(workspace, ".codex", "skills")],
      });
      const grants = await callTool(runtime, "get_file_access_grants", {});
      const read = await callTool(runtime, "read_text_file", {
        path: ".codex/skills/docs/SKILL.md",
      });

      expect(grants.grants).toContainEqual(
        expect.objectContaining({
          access: "read-only",
          path: await realpath(join(workspace, ".codex", "skills")),
          readOnly: true,
          source: "skill",
        }),
      );
      expect(read.content).toContain("Documentation guidance");

      await expect(
        executeTrussFilesystemTool({
          args: { content: "mutated", path: ".codex/skills/docs/SKILL.md" },
          runtime,
          toolName: "write_text_file",
        }),
      ).rejects.toThrow("read-only");
      await expect(
        executeTrussFilesystemTool({
          args: { path: ".codex/skills/new-skill" },
          runtime,
          toolName: "create_directory",
        }),
      ).rejects.toThrow("read-only");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("returns model-visible filesystem results as TOON", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "truss-filesystem-toon-"));

    try {
      await mkdir(join(workspace, "src"));
      await writeFile(join(workspace, "src", "alpha.txt"), "one\ntwo beta\nthree\n");

      const runtime = await createTrussFilesystemToolsMcpRuntime(workspace);
      const read = await executeTrussFilesystemTool({
        args: { lineCount: 3, path: "src/alpha.txt" },
        runtime,
        toolName: "read_text_file",
      });

      expect(read.startsWith("read_text_file:\n")).toBe(true);
      expect(read).toContain("  path: src/alpha.txt");
      expect(read).toContain("  content: |-\n    one\n    two beta\n    three");
      expect(read.trimStart().startsWith("{")).toBe(false);

      const list = await executeTrussFilesystemTool({
        args: { path: "src" },
        runtime,
        toolName: "list_directory",
      });

      expect(list.startsWith("list_directory:\n")).toBe(true);
      expect(list).toContain("  entries[1]:");
      expect(list).toContain("      name: alpha.txt");

      const regex = await executeTrussFilesystemTool({
        args: { pattern: "two\\s+beta", path: "." },
        runtime,
        toolName: "regex_search_files",
      });

      expect(regex.startsWith("regex_search_files:\n")).toBe(true);
      expect(regex).toContain("  matches[1]:");
      expect(regex).toContain("      path: src/alpha.txt");
      expect(regex).toContain("      preview: two beta");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("supports multi-file reads, surgical edits, metadata, directory creation, and file refactors", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "truss-filesystem-refactor-"));

    try {
      await mkdir(join(workspace, "app"));
      await writeFile(join(workspace, "app", "User.php"), "line one\nline two\nline three\nline four\n");
      await writeFile(join(workspace, "app", "User.js"), "console.log('ignore');\n");

      const runtime = await createTrussFilesystemToolsMcpRuntime(workspace);

      const createdDirectory = await callTool(runtime, "create_directory", {
        path: "app/Services/Nested",
      });
      expect(createdDirectory.created).toBe(true);
      expect(createdDirectory.path).toBe("app/Services/Nested");

      const metadata = await callTool(runtime, "get_file_metadata", { path: "app/User.php" });
      expect(metadata.type).toBe("file");
      expect(metadata.extension).toBe(".php");

      const multiRead = await callTool(runtime, "read_multiple_files", {
        lineCount: 1,
        paths: ["app/User.php", "app/missing.php"],
        startLine: 2,
      });
      expect(multiRead.count).toBe(2);
      expect(multiRead.failedCount).toBe(1);
      expect(multiRead.files[0].content).toBe("line two");
      expect(multiRead.files[1].ok).toBe(false);

      const patched = await callTool(runtime, "patch_text_file", {
        path: "app/User.php",
        replacements: [
          { content: "line 2a\nline 3a", endLine: 3, startLine: 2 },
          { content: "line five\n", endLine: 4, startLine: 5 },
        ],
      });
      expect(patched.replacements).toBe(2);
      expect(await readFile(join(workspace, "app", "User.php"), "utf8")).toBe(
        "line one\nline 2a\nline 3a\nline four\nline five\n",
      );

      const phpTree = await callTool(runtime, "directory_tree", {
        extensions: [".php"],
        path: "app",
      });
      expect(phpTree.entries).toEqual([
        expect.objectContaining({ path: "app/User.php" }),
      ]);

      const copied = await callTool(runtime, "copy_file", {
        destinationPath: "app/Services/UserCopy.php",
        sourcePath: "app/User.php",
      });
      expect(copied.destinationPath).toBe("app/Services/UserCopy.php");

      const moved = await callTool(runtime, "move_file", {
        destinationPath: "app/Services/UserMoved.php",
        sourcePath: "app/Services/UserCopy.php",
      });
      expect(moved.destinationPath).toBe("app/Services/UserMoved.php");

      const deleted = await callTool(runtime, "delete_file", {
        confirmDeletion: true,
        path: "app/Services/UserMoved.php",
      });
      expect(deleted.deleted).toBe(true);
      await expect(readFile(join(workspace, "app", "Services", "UserMoved.php"), "utf8")).rejects.toThrow();

      await writeFile(join(workspace, "app", "NeedsConfirm.php"), "confirm me\n");
      await expect(
        executeTrussFilesystemTool({
          args: { path: "app/NeedsConfirm.php" },
          runtime,
          toolName: "delete_file",
        }),
      ).rejects.toThrow("delete_file requires confirmDeletion: true.");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects binary text reads and skips binary files during regex search", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "truss-filesystem-binary-"));

    try {
      await writeFile(join(workspace, "binary.bin"), new Uint8Array([0, 159, 146, 150]));
      await writeFile(join(workspace, "notes.txt"), "hello searchable text\n");

      const runtime = await createTrussFilesystemToolsMcpRuntime(workspace);

      await expect(
        executeTrussFilesystemTool({
          args: { path: "binary.bin" },
          runtime,
          toolName: "read_text_file",
        }),
      ).rejects.toThrow("appears to be a binary file");

      const regex = await callTool(runtime, "regex_search_files", {
        pattern: "searchable",
      });
      expect(regex.matches).toEqual([
        expect.objectContaining({
          line: 1,
          path: "notes.txt",
        }),
      ]);
      expect(regex.skippedBinaryFiles).toBe(1);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it(
    "converts workspace HTML documents to Markdown",
    async () => {
      const workspace = await mkdtemp(join(tmpdir(), "truss-filesystem-docs-"));

      try {
        await writeFile(
          join(workspace, "page.html"),
          "<!doctype html><html><body><h1>Hello</h1><p>Converted document.</p></body></html>",
        );

        const runtime = await createTrussFilesystemToolsMcpRuntime(workspace);
        const document = await callTool(runtime, "read_document", { path: "page.html" });

        expect(document.converter).toBe("pandoc");
        expect(document.content).toContain("# Hello");
        expect(document.content).toContain("Converted document.");
      } finally {
        await rm(workspace, { force: true, recursive: true });
      }
    },
    10_000,
  );

  it("rejects reads and writes outside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-filesystem-boundary-"));
    const workspace = join(root, "workspace");

    try {
      await mkdir(workspace);
      await writeFile(join(root, "outside.txt"), "outside\n");
      await writeFile(join(workspace, "inside.txt"), "inside\n");

      const runtime = await createTrussFilesystemToolsMcpRuntime(workspace);

      await expect(
        executeTrussFilesystemTool({
          args: { path: "../outside.txt" },
          runtime,
          toolName: "read_text_file",
        }),
      ).rejects.toThrow(accessDeniedMessage);

      await expect(
        executeTrussFilesystemTool({
          args: { content: "nope", path: "../outside.txt", overwrite: true },
          runtime,
          toolName: "write_text_file",
        }),
      ).rejects.toThrow(accessDeniedMessage);

      await expect(
        executeTrussFilesystemTool({
          args: { path: resolve(root, "outside.txt") },
          runtime,
          toolName: "read_text_file",
        }),
      ).rejects.toThrow(accessDeniedMessage);

      await expect(
        executeTrussFilesystemTool({
          args: { path: resolve(root, "missing.txt") },
          runtime,
          toolName: "read_text_file",
        }),
      ).rejects.toThrow(accessDeniedMessage);

      await expect(
        executeTrussFilesystemTool({
          args: { path: "..%2Foutside.txt" },
          runtime,
          toolName: "read_text_file",
        }),
      ).rejects.toThrow(accessDeniedMessage);

      await expect(
        executeTrussFilesystemTool({
          args: { path: "../created" },
          runtime,
          toolName: "create_directory",
        }),
      ).rejects.toThrow(accessDeniedMessage);

      await expect(
        executeTrussFilesystemTool({
          args: { destinationPath: "../copy.txt", sourcePath: "inside.txt" },
          runtime,
          toolName: "copy_file",
        }),
      ).rejects.toThrow(accessDeniedMessage);

      await expect(
        executeTrussFilesystemTool({
          args: { destinationPath: "../moved.txt", sourcePath: "inside.txt" },
          runtime,
          toolName: "move_file",
        }),
      ).rejects.toThrow(accessDeniedMessage);

      await expect(
        executeTrussFilesystemTool({
          args: { confirmDeletion: true, path: "../outside.txt" },
          runtime,
          toolName: "delete_file",
        }),
      ).rejects.toThrow(accessDeniedMessage);

      const multiRead = await callTool(runtime, "read_multiple_files", {
        paths: ["../outside.txt"],
      });
      expect(multiRead.files[0]).toMatchObject({
        error: accessDeniedMessage,
        ok: false,
        path: "../outside.txt",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("supports granted directories and blocks ignored file patterns", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-filesystem-grants-"));
    const workspace = join(root, "workspace");
    const granted = join(root, "granted");

    try {
      await mkdir(workspace);
      await mkdir(granted);
      await writeFile(join(workspace, "visible.txt"), "workspace\n");
      await writeFile(join(workspace, ".env"), "SECRET=value\n");
      await writeFile(join(granted, "notes.txt"), "granted\n");
      await writeFile(join(granted, "vault.secret"), "hidden\n");

      const runtime = await createTrussFilesystemToolsMcpRuntime(workspace, {
        allowedDirectories: [granted],
        ignorePatterns: [".env", "*.secret"],
      });

      const grantedRead = await callTool(runtime, "read_text_file", {
        path: join(granted, "notes.txt"),
      });
      expect(grantedRead.content).toBe("granted\n");

      const list = await callTool(runtime, "list_directory", { path: "." });
      expect(list.entries.map((entry: { name: string }) => entry.name)).toEqual(["visible.txt"]);

      await expect(
        executeTrussFilesystemTool({
          args: { path: ".env" },
          runtime,
          toolName: "read_text_file",
        }),
      ).rejects.toThrow("ignored by Truss file-access patterns");

      await expect(
        executeTrussFilesystemTool({
          args: { path: join(granted, "vault.secret") },
          runtime,
          toolName: "read_text_file",
        }),
      ).rejects.toThrow("ignored by Truss file-access patterns");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("loads persisted grants only for the active workspace or global context", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-filesystem-scoped-grants-"));
    let database: AppDatabase | null = null;

    try {
      const workspaceA = join(root, "workspace-a");
      const workspaceB = join(root, "workspace-b");
      const extraA = join(root, "extra-a");
      const extraB = join(root, "extra-b");
      const globalExtra = join(root, "global-extra");
      const trussHome = await ensureTrussHome(join(root, "home"), { log: () => undefined });

      await mkdir(workspaceA);
      await mkdir(workspaceB);
      await mkdir(extraA);
      await mkdir(extraB);
      await mkdir(globalExtra);
      await writeFile(join(extraA, "a.txt"), "workspace a grant\n");
      await writeFile(join(extraB, "b.txt"), "workspace b grant\n");
      await writeFile(join(globalExtra, "global.txt"), "global grant\n");

      database = openAppDatabase(trussHome.dbPath);
      const grants = new FilesystemDirectoryGrantsRepository(database.db);

      await grants.upsertGrant({
        directoryPath: extraA,
        grantSource: "user-dialog",
        workspacePath: workspaceA,
      });
      await grants.upsertGrant({
        directoryPath: extraB,
        grantSource: "user-dialog",
        workspacePath: workspaceB,
      });
      await grants.upsertGrant({
        directoryPath: globalExtra,
        grantSource: "user-dialog",
        workspacePath: null,
      });
      database.db.close();
      database = null;

      const runtimeA = await createTrussFilesystemToolsMcpRuntime(workspaceA, {
        trussHomeDir: trussHome.dir,
      });
      const runtimeARestart = await createTrussFilesystemToolsMcpRuntime(workspaceA, {
        trussHomeDir: trussHome.dir,
      });
      const runtimeB = await createTrussFilesystemToolsMcpRuntime(workspaceB, {
        trussHomeDir: trussHome.dir,
      });
      const globalRuntime = await createTrussFilesystemToolsMcpRuntime(undefined, {
        trussHomeDir: trussHome.dir,
      });

      expect((await callTool(runtimeA, "read_text_file", { path: join(extraA, "a.txt") })).content)
        .toBe("workspace a grant\n");
      expect(
        (await callTool(runtimeARestart, "read_text_file", { path: join(extraA, "a.txt") }))
          .content,
      ).toBe("workspace a grant\n");
      expect((await callTool(runtimeB, "read_text_file", { path: join(extraB, "b.txt") })).content)
        .toBe("workspace b grant\n");
      expect(
        (await callTool(globalRuntime, "read_text_file", {
          path: join(globalExtra, "global.txt"),
        })).content,
      ).toBe("global grant\n");

      await expect(
        executeTrussFilesystemTool({
          args: { path: join(extraB, "b.txt") },
          runtime: runtimeA,
          toolName: "read_text_file",
        }),
      ).rejects.toThrow(accessDeniedMessage);
      await expect(
        executeTrussFilesystemTool({
          args: { path: join(globalExtra, "global.txt") },
          runtime: runtimeA,
          toolName: "read_text_file",
        }),
      ).rejects.toThrow(accessDeniedMessage);
      await expect(
        executeTrussFilesystemTool({
          args: { path: join(extraA, "a.txt") },
          runtime: globalRuntime,
          toolName: "read_text_file",
        }),
      ).rejects.toThrow(accessDeniedMessage);
    } finally {
      database?.db.close();
      await rm(root, { force: true, recursive: true });
    }
  });

  it("loads persisted read-only grants as non-writable runtime roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-filesystem-readonly-grants-"));
    let database: AppDatabase | null = null;

    try {
      const extra = join(root, "readonly-extra");
      const trussHome = await ensureTrussHome(join(root, "home"), { log: () => undefined });

      await mkdir(extra);
      await writeFile(join(extra, "notes.txt"), "readable only\n");

      database = openAppDatabase(trussHome.dbPath);
      const grants = new FilesystemDirectoryGrantsRepository(database.db);
      const grant = await grants.upsertGrant({
        directoryPath: extra,
        grantSource: "user-dialog",
        readOnly: true,
        workspacePath: null,
      });

      expect(grant.readOnly).toBe(true);

      database.db.close();
      database = null;

      const runtime = await createTrussFilesystemToolsMcpRuntime(undefined, {
        trussHomeDir: trussHome.dir,
      });
      const resolvedExtra = await realpath(extra);
      const access = await callTool(runtime, "get_file_access_grants", {});
      const read = await callTool(runtime, "read_text_file", {
        path: join(extra, "notes.txt"),
      });

      expect(access.grants).toContainEqual({
        access: "read-only",
        isPrimary: true,
        path: resolvedExtra,
        readOnly: true,
        scope: "global",
        source: "user",
      });
      expect(read.content).toBe("readable only\n");

      await expect(
        executeTrussFilesystemTool({
          args: { content: "mutated", path: join(extra, "notes.txt") },
          runtime,
          toolName: "write_text_file",
        }),
      ).rejects.toThrow(`Access denied: Directory ${resolvedExtra} is granted as read-only.`);
    } finally {
      database?.db.close();
      await rm(root, { force: true, recursive: true });
    }
  });

  it("drops expired persisted directory grants", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-filesystem-expired-grants-"));
    let database: AppDatabase | null = null;

    try {
      const trussHome = await ensureTrussHome(join(root, "home"), { log: () => undefined });
      const extra = join(root, "extra");

      await mkdir(extra);

      database = openAppDatabase(trussHome.dbPath);
      const grants = new FilesystemDirectoryGrantsRepository(database.db);

      await grants.upsertGrant({
        directoryPath: extra,
        grantSource: "user-dialog",
        workspacePath: null,
      });
      database.db
        .query("UPDATE filesystem_directory_grants SET expires_at = ?")
        .run("2000-01-01T00:00:00.000Z");

      expect(grants.listGrantsForContext(null)).toEqual([]);
    } finally {
      database?.db.close();
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects overly complex ignore patterns before regex matching", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "truss-filesystem-ignore-pattern-"));

    try {
      await writeFile(join(workspace, "notes.txt"), "hello\n");

      const runtime = await createTrussFilesystemToolsMcpRuntime(workspace, {
        ignorePatterns: ["**/**/**/**"],
      });

      await expect(
        executeTrussFilesystemTool({
          args: { path: "." },
          runtime,
          toolName: "list_directory",
        }),
      ).rejects.toThrow("Ignore pattern is too complex");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("does not follow symlinks outside the selected access directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-filesystem-symlink-"));
    const workspace = join(root, "workspace");

    try {
      await mkdir(workspace);
      await writeFile(join(root, "outside.txt"), "outside\n");
      await mkdir(join(root, "outside-dir"));
      await writeFile(join(root, "outside-dir", "exists.txt"), "outside\n");

      try {
        await symlink(join(root, "outside.txt"), join(workspace, "linked.txt"));
        await symlink(
          join(root, "outside-dir"),
          join(workspace, "linked-dir"),
          process.platform === "win32" ? "junction" : "dir",
        );
      } catch (caught) {
        if (isSymlinkPrivilegeError(caught)) {
          return;
        }

        throw caught;
      }

      const runtime = await createTrussFilesystemToolsMcpRuntime(workspace);

      await expect(
        executeTrussFilesystemTool({
          args: { path: "linked.txt" },
          runtime,
          toolName: "read_text_file",
        }),
      ).rejects.toThrow(accessDeniedMessage);

      await expect(
        executeTrussFilesystemTool({
          args: { path: "linked-dir/exists.txt" },
          runtime,
          toolName: "read_text_file",
        }),
      ).rejects.toThrow(accessDeniedMessage);

      await expect(
        executeTrussFilesystemTool({
          args: { path: "linked-dir/missing.txt" },
          runtime,
          toolName: "read_text_file",
        }),
      ).rejects.toThrow(accessDeniedMessage);

      const list = await callTool(runtime, "list_directory", { path: "." });
      expect(list.entries).toContainEqual(
        expect.objectContaining({
          name: "linked.txt",
          targetWithinWorkspace: false,
          type: "symlink",
        }),
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

async function callTool(
  runtime: Awaited<ReturnType<typeof createTrussFilesystemToolsMcpRuntime>>,
  toolName: TrussFilesystemToolName,
  args: Record<string, unknown>,
): Promise<any> {
  return executeTrussFilesystemToolValue({
    args,
    runtime,
    toolName,
  });
}

function isSymlinkPrivilegeError(caught: unknown): boolean {
  if (!caught || typeof caught !== "object") {
    return false;
  }

  const code = (caught as { code?: unknown }).code;

  return code === "EPERM" || code === "EACCES";
}
