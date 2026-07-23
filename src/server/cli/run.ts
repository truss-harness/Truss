import { realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { userInfo } from "node:os";
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
import {
  browserBrokerCredentialsFromEnv,
  clearBrowserBrokerCredentialsFromEnv,
} from "../browser/broker-protocol.ts";

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

  if (cli.command === "service" && process.platform !== "win32") {
    throw new Error("The global Truss browser service is supported only on Windows.");
  }

  if (cli.command === "service" && !isLocalSystemAccount()) {
    throw new Error(
      'The "truss service" runtime must be started by the installed LocalSystem Windows service.',
    );
  }

  const inheritedBrowserBroker =
    cli.command === "spawn" ? takeInheritedBrowserBrokerCredentials() : null;
  const trussHome = await ensureTrussHome(
    cli.command === "service" ? resolveWindowsServiceTrussHome() : cli.trussHomeDir,
  );
  const workspacePath = await resolveWorkspaceDirectory(cli.workspacePath);
  const conversationWorkspacePath = cli.workspacePathSpecified ? workspacePath : null;
  const { startServer } = await import("../http/server.ts");

  if (cli.workspacePathSpecified) {
    process.chdir(workspacePath);
  }

  const server = await startServer({
    browserBroker: inheritedBrowserBroker ?? undefined,
    port: cli.port,
    conversationWorkspacePath,
    projectRoot: runtime.projectRoot,
    publicDir: resolve(runtime.projectRoot, "public"),
    trussHome,
    workspacePath,
    serviceMode: cli.command === "service",
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

function takeInheritedBrowserBrokerCredentials() {
  const credentials = browserBrokerCredentialsFromEnv(process.env);

  clearBrowserBrokerCredentialsFromEnv(process.env);
  return credentials;
}

function resolveWindowsServiceTrussHome(): string {
  const configured = process.env.TRUSS_SERVICE_HOME?.trim();

  if (configured) {
    return resolve(configured);
  }

  const programData = process.env.ProgramData?.trim() || "C:\\ProgramData";
  return join(programData, "Truss");
}

function isLocalSystemAccount(): boolean {
  try {
    return userInfo().username.toUpperCase() === "SYSTEM";
  } catch {
    return process.env.USERNAME?.toUpperCase() === "SYSTEM";
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
