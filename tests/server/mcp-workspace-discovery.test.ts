import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import { writeGlobalMcpConfigText } from "../../src/server/mcp/config-write.ts";
import { loadWorkspaceMcpServers } from "../../src/server/mcp/discovery.ts";
import { loadRuntimeMcpServers } from "../../src/server/mcp/runtime.ts";
import { ensureTrussHome } from "../../src/server/setup/truss-home.ts";

describe("workspace MCP discovery", () => {
  it("loads supported assistant MCP config locations and shapes", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "truss-mcp-discovery-"));

    try {
      await writeJson(join(workspace, ".junie", "mcp", "mcp.json"), {
        mcpServers: {
          "junie-files": {
            command: "node",
            args: ["junie-server.js"],
          },
        },
      });
      await writeText(
        join(workspace, ".codex", "config.toml"),
        [
          "[mcp_servers.codex_docs]",
          'command = "npx"',
          'args = ["-y", "@upstash/context7-mcp"]',
          "",
          "[mcp_servers.codex_docs.env]",
          'DOCS_REGION = "us-east-1"',
          "",
          "[mcp_servers.codex_remote]",
          'url = "https://mcp.example.com/mcp"',
          'bearer_token_env_var = "CODEX_TOKEN"',
          'http_headers = { "X-Client" = "codex" }',
          'env_http_headers = { "X-Token" = "CODEX_TOKEN" }',
          "",
        ].join("\n"),
      );
      await writeJson(join(workspace, ".mcp.json"), {
        mcpServers: {
          "claude-remote": {
            type: "http",
            url: "https://claude.example.com/mcp",
          },
        },
      });
      await writeJson(join(workspace, ".cursor", "mcp.json"), {
        mcpServers: {
          "cursor-sse": {
            type: "sse",
            url: "https://cursor.example.com/sse",
          },
        },
      });
      await writeJson(join(workspace, ".vscode", "mcp.json"), {
        servers: {
          "copilot-vscode": {
            type: "stdio",
            command: "node",
            args: ["copilot-vscode.js"],
          },
        },
      });
      await writeJson(join(workspace, ".github", "mcp.json"), {
        mcpServers: {
          "copilot-cli": {
            type: "local",
            command: "node",
            args: ["copilot-cli.js"],
          },
        },
      });

      const result = await loadWorkspaceMcpServers(workspace);
      const serversById = Object.fromEntries(
        result.servers.map((server) => [server.id, server]),
      );

      expect(result.source).toBe("workspace-discovered");
      expect(result.sources?.map((source) => source.source).sort()).toEqual([
        "claude",
        "codex",
        "cursor",
        "github-copilot",
        "junie",
      ]);
      expect(serversById["junie:junie-files"]?.configPath).toBe(
        join(workspace, ".junie", "mcp", "mcp.json"),
      );
      expect(serversById["codex:codex_docs"]?.transport).toBe("stdio");
      expect(serversById["codex:codex_docs"]?.env).toEqual({
        DOCS_REGION: "us-east-1",
      });
      expect(serversById["codex:codex_remote"]?.transport).toBe("streamable-http");
      expect(serversById["codex:codex_remote"]?.auth).toEqual({
        type: "api-key",
        envVar: "CODEX_TOKEN",
        headerName: "Authorization",
        prefix: "Bearer",
      });
      expect(serversById["codex:codex_remote"]?.headers).toEqual({
        "X-Client": "codex",
      });
      expect(serversById["codex:codex_remote"]?.envHeaders).toEqual({
        "X-Token": "CODEX_TOKEN",
      });
      expect(serversById["claude:claude-remote"]?.transport).toBe("streamable-http");
      expect(serversById["cursor:cursor-sse"]?.transport).toBe("http-sse");
      expect(serversById["github-copilot:copilot-vscode"]?.transport).toBe("stdio");
      expect(serversById["github-copilot:copilot-cli"]?.transport).toBe("stdio");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("overlays workspace MCP servers only for scoped runtime loading", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-mcp-runtime-"));
    const previousGlobalSkillDirs = process.env.TRUSS_GLOBAL_SKILL_DIRS;
    process.env.TRUSS_GLOBAL_SKILL_DIRS = "";

    try {
      const workspace = join(root, "workspace");
      const trussHome = await ensureTrussHome(join(root, "home"), { log: () => undefined });

      await mkdir(workspace, { recursive: true });
      await writeJson(join(workspace, ".cursor", "mcp.json"), {
        mcpServers: {
          "workspace-only": {
            command: "node",
            args: ["workspace-only.js"],
          },
        },
      });

      const unscoped = await loadRuntimeMcpServers({
        conversationWorkspacePath: null,
        projectRoot: process.cwd(),
        trussHome,
        workspacePath: workspace,
      });
      const scoped = await loadRuntimeMcpServers({
        conversationWorkspacePath: workspace,
        projectRoot: process.cwd(),
        trussHome,
        workspacePath: workspace,
      });
      const globalConfigText = await Bun.file(trussHome.mcpConfigPath).text();
      const unscopedFilesystemTools = unscoped.servers.find(
        (server) => server.id === "truss-global:truss-filesystem-tools",
      );
      const scopedFilesystemTools = scoped.servers.find(
        (server) => server.id === "truss-global:truss-filesystem-tools",
      );

      expect(unscoped.servers.some((server) => server.id === "cursor:workspace-only")).toBe(false);
      expect(unscopedFilesystemTools?.disabled).toBe(true);
      expect(unscopedFilesystemTools?.disabledReason).toContain("no readable global skill directory");
      expect(scoped.servers.some((server) => server.id === "cursor:workspace-only")).toBe(true);
      expect(scopedFilesystemTools?.disabled).toBe(false);
      expect(scoped.sources?.some((source) => source.source === "cursor")).toBe(true);
      expect(globalConfigText).not.toContain("workspace-only");
    } finally {
      restoreEnv("TRUSS_GLOBAL_SKILL_DIRS", previousGlobalSkillDirs);
      await rm(root, { force: true, recursive: true });
    }
  });

  it("keeps global skills available through the filesystem MCP in global mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-mcp-global-skills-"));
    const previousGlobalSkillDirs = process.env.TRUSS_GLOBAL_SKILL_DIRS;

    try {
      const workspace = join(root, "workspace");
      const globalSkills = join(root, "global-skills");
      const trussHome = await ensureTrussHome(join(root, "home"), { log: () => undefined });

      process.env.TRUSS_GLOBAL_SKILL_DIRS = globalSkills;
      await mkdir(join(globalSkills, "docs"), { recursive: true });
      await mkdir(workspace, { recursive: true });
      await Bun.write(join(globalSkills, "docs", "SKILL.md"), "# Docs\n");

      const runtimeServers = await loadRuntimeMcpServers({
        conversationWorkspacePath: null,
        projectRoot: process.cwd(),
        trussHome,
        workspacePath: workspace,
      });
      const filesystemTools = runtimeServers.servers.find(
        (server) => server.id === "truss-global:truss-filesystem-tools",
      );

      expect(filesystemTools?.disabled).toBe(false);
    } finally {
      restoreEnv("TRUSS_GLOBAL_SKILL_DIRS", previousGlobalSkillDirs);
      await rm(root, { force: true, recursive: true });
    }
  });

  it("requires explicit approval before saving external stdio MCP commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-mcp-stdio-approval-"));

    try {
      const workspace = join(root, "workspace");
      const trussHome = await ensureTrussHome(join(root, "home"), { log: () => undefined });
      const mcpConfigText = JSON.stringify(
        {
          mcpServers: {
            external: {
              command: "node",
              args: ["external-server.js"],
            },
          },
        },
        null,
        2,
      );

      await mkdir(workspace, { recursive: true });

      await expect(
        writeGlobalMcpConfigText({
          approveStdioServers: false,
          mcpConfigText,
          options: {
            conversationWorkspacePath: null,
            projectRoot: process.cwd(),
            trussHome,
            workspacePath: workspace,
          },
        }),
      ).rejects.toThrow("Approve the local command changes");

      await writeGlobalMcpConfigText({
        approveStdioServers: true,
        mcpConfigText,
        options: {
          conversationWorkspacePath: null,
          projectRoot: process.cwd(),
          trussHome,
          workspacePath: workspace,
        },
      });

      const runtimeServers = await loadRuntimeMcpServers({
        conversationWorkspacePath: null,
        projectRoot: process.cwd(),
        trussHome,
        workspacePath: workspace,
      });
      const external = runtimeServers.servers.find(
        (server) => server.id === "truss-global:external",
      );

      expect(external?.stdioCommandApproved).toBe(true);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, value);
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
