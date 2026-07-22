import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { openDefaultBrowser } from "./browser.ts";
import { parseCli, printHelp } from "./parse.ts";
import { ensureTrussHome } from "../setup/truss-home.ts";
import { runTrussChatToolsMcpServer } from "../mcp/servers/truss-chat-tools/server.ts";
import { runTrussCommandRunnerMcpServer } from "../mcp/servers/truss-command-runner/server.ts";
import { runTrussFilesystemToolsMcpServer } from "../mcp/servers/truss-filesystem-tools/server.ts";
import { runTrussOrchestrationToolsMcpServer } from "../mcp/servers/truss-orchestration-tools/server.ts";
import { runTrussPlaywrightMcpServer } from "../mcp/servers/truss-playwright-mcp/server.ts";
import { runTrussWebToolsMcpServer } from "../mcp/servers/truss-web-tools/server.ts";

export interface CliRuntime {
  args: string[];
  cwd: string;
  projectRoot: string;
}

export async function runCli(runtime: CliRuntime): Promise<void> {
  const cli = parseCli(runtime.args, runtime.cwd);

  if (cli.command === "help") {
    printHelp();
    return;
  }

  if (cli.command === "mcp-server") {
    if (cli.mcpServer === "truss-chat-tools") {
      await runTrussChatToolsMcpServer({
        workspacePath: cli.conversationWorkspacePath,
        trussHomeDir: cli.trussHomeDir,
      });
      return;
    }

    if (cli.mcpServer === "truss-web-tools") {
      await runTrussWebToolsMcpServer({
        trussHomeDir: cli.trussHomeDir,
      });
      return;
    }

    if (cli.mcpServer === "truss-playwright-mcp") {
      await runTrussPlaywrightMcpServer({
        trussHomeDir: cli.trussHomeDir,
      });
      return;
    }

    if (cli.mcpServer === "truss-orchestration-tools") {
      await runTrussOrchestrationToolsMcpServer();
      return;
    }

    if (cli.mcpServer === "truss-command-runner") {
      await runTrussCommandRunnerMcpServer();
      return;
    }

    if (cli.mcpServer === "truss-filesystem-tools") {
      await runTrussFilesystemToolsMcpServer({
        allowedDirectories: cli.allowedDirectories,
        readOnlyDirectories: cli.readOnlyDirectories,
        trussHomeDir: cli.trussHomeDir,
        workspacePath: cli.conversationWorkspacePath,
      });
      return;
    }

    return;
  }

  const trussHome = await ensureTrussHome();
  const workspacePath = await resolveWorkspaceDirectory(cli.workspacePath);
  const conversationWorkspacePath = cli.workspacePathSpecified ? workspacePath : null;
  const { startServer } = await import("../http/server.ts");

  if (cli.workspacePathSpecified) {
    process.chdir(workspacePath);
  }

  const server = await startServer({
    port: cli.port,
    conversationWorkspacePath,
    projectRoot: runtime.projectRoot,
    publicDir: resolve(runtime.projectRoot, "public"),
    trussHome,
    workspacePath,
  });

  const url = `http://${server.hostname}:${server.port}`;
  console.log(`Truss listening on ${url}`);
  console.log(`Workspace: ${workspacePath}`);
  console.log(
    conversationWorkspacePath
      ? `Conversation scope: ${conversationWorkspacePath}`
      : "Conversation scope: all workspaces",
  );

  if (cli.openBrowser) {
    openDefaultBrowser(url);
  }
}

async function resolveWorkspaceDirectory(workspacePath: string): Promise<string> {
  const resolvedPath = resolve(workspacePath);
  let workspaceStat;

  try {
    workspaceStat = await stat(resolvedPath);
  } catch {
    throw new Error(`Workspace directory does not exist: ${resolvedPath}`);
  }

  if (!workspaceStat.isDirectory()) {
    throw new Error(`Workspace path must be a directory: ${resolvedPath}`);
  }

  return realpath(resolvedPath);
}
