import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { parseCli } from "../../src/server/cli/parse.ts";

describe("parseCli", () => {
  const cwd = process.cwd();

  it("defaults to spawning the current workspace with browser launch enabled", () => {
    expect(parseCli([], cwd)).toEqual({
      command: "spawn",
      conversationWorkspacePath: undefined,
      openBrowser: true,
      port: undefined,
      workspacePath: resolve(cwd, "."),
      workspacePathSpecified: false,
    });
  });

  it("supports non-launching aliases", () => {
    expect(parseCli(["spawn", "--no-autolaunch"], cwd).openBrowser).toBe(false);
    expect(parseCli(["spawn", "--no-open"], cwd).openBrowser).toBe(false);
  });

  it("parses workspace and inline port arguments without treating flags as paths", () => {
    const options = parseCli(["spawn", "fixtures/demo", "--port=17771", "--no-open"], cwd);

    expect(options).toMatchObject({
      command: "spawn",
      openBrowser: false,
      port: 17771,
      workspacePath: resolve(cwd, "fixtures/demo"),
      workspacePathSpecified: true,
    });
  });

  it("parses the bundled MCP server command with a Truss home override", () => {
    expect(parseCli(["mcp-server", "truss-web-tools", "--truss-home", ".tmp/truss"], cwd)).toEqual({
      command: "mcp-server",
      conversationWorkspacePath: undefined,
      mcpServer: "truss-web-tools",
      openBrowser: false,
      trussHomeDir: ".tmp/truss",
      workspacePath: cwd,
      workspacePathSpecified: false,
    });
  });

  it("parses the bundled chat tools MCP server command with a scoped workspace", () => {
    expect(
      parseCli(
        [
          "mcp-server",
          "truss-chat-tools",
          "--truss-home=.tmp/truss",
          "--workspace-path",
          ".tmp/workspace",
        ],
        cwd,
      ),
    ).toEqual({
      command: "mcp-server",
      conversationWorkspacePath: ".tmp/workspace",
      mcpServer: "truss-chat-tools",
      openBrowser: false,
      trussHomeDir: ".tmp/truss",
      workspacePath: cwd,
      workspacePathSpecified: false,
    });
  });

  it("parses the bundled orchestration tools MCP server command", () => {
    expect(parseCli(["mcp-server", "truss-orchestration-tools"], cwd)).toEqual({
      command: "mcp-server",
      conversationWorkspacePath: undefined,
      mcpServer: "truss-orchestration-tools",
      openBrowser: false,
      trussHomeDir: undefined,
      workspacePath: cwd,
      workspacePathSpecified: false,
    });
  });

  it("parses the bundled Playwright MCP server command", () => {
    expect(parseCli(["mcp-server", "truss-playwright-mcp", "--truss-home", ".tmp/truss"], cwd)).toEqual({
      command: "mcp-server",
      conversationWorkspacePath: undefined,
      mcpServer: "truss-playwright-mcp",
      openBrowser: false,
      trussHomeDir: ".tmp/truss",
      workspacePath: cwd,
      workspacePathSpecified: false,
    });
  });

  it("parses the bundled command runner MCP server command", () => {
    expect(parseCli(["mcp-server", "truss-command-runner"], cwd)).toEqual({
      command: "mcp-server",
      conversationWorkspacePath: undefined,
      mcpServer: "truss-command-runner",
      openBrowser: false,
      trussHomeDir: undefined,
      workspacePath: cwd,
      workspacePathSpecified: false,
    });
  });

  it("parses the bundled filesystem tools MCP server command with a scoped workspace", () => {
    expect(
      parseCli(
        [
          "mcp-server",
          "truss-filesystem-tools",
          "--workspace-path=.tmp/workspace",
        ],
        cwd,
      ),
    ).toEqual({
      command: "mcp-server",
      conversationWorkspacePath: ".tmp/workspace",
      mcpServer: "truss-filesystem-tools",
      openBrowser: false,
      trussHomeDir: undefined,
      workspacePath: cwd,
      workspacePathSpecified: false,
    });
  });

  it("parses granted directories for the bundled filesystem tools MCP server command", () => {
    expect(
      parseCli(
        [
          "mcp-server",
          "truss-filesystem-tools",
          "--allowed-directory",
          "C:\\extra",
          "--allowed-directory=/var/project",
        ],
        cwd,
      ),
    ).toMatchObject({
      allowedDirectories: ["C:\\extra", "/var/project"],
      command: "mcp-server",
      mcpServer: "truss-filesystem-tools",
      openBrowser: false,
      workspacePath: cwd,
      workspacePathSpecified: false,
    });
  });

  it("parses read-only directories for the bundled filesystem tools MCP server command", () => {
    expect(
      parseCli(
        [
          "mcp-server",
          "truss-filesystem-tools",
          "--read-only-directory",
          "C:\\Users\\ASUS\\.codex\\skills",
          "--read-only-directory=/opt/skills",
        ],
        cwd,
      ),
    ).toMatchObject({
      command: "mcp-server",
      mcpServer: "truss-filesystem-tools",
      openBrowser: false,
      readOnlyDirectories: ["C:\\Users\\ASUS\\.codex\\skills", "/opt/skills"],
      workspacePath: cwd,
      workspacePathSpecified: false,
    });
  });

  it("rejects invalid ports", () => {
    expect(() => parseCli(["spawn", "--port", "bogus"], cwd)).toThrow('Invalid port "bogus".');
  });
});
