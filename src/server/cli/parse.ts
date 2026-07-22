import { resolve } from "node:path";
import { defaultServerPort } from "../ports.ts";

export type BuiltinMcpServerName =
  | "truss-command-runner"
  | "truss-chat-tools"
  | "truss-filesystem-tools"
  | "truss-orchestration-tools"
  | "truss-playwright-mcp"
  | "truss-web-tools";

export interface CliOptions {
  allowedDirectories?: string[];
  command: "mcp-server" | "spawn" | "help";
  conversationWorkspacePath?: string;
  mcpServer?: BuiltinMcpServerName;
  openBrowser: boolean;
  port?: number;
  readOnlyDirectories?: string[];
  trussHomeDir?: string;
  workspacePath: string;
  workspacePathSpecified: boolean;
}

const noOpenFlags = new Set(["--no-open", "--no-autolaunch"]);

export function parseCli(args: string[], cwd: string): CliOptions {
  const command = args[0] ?? "spawn";

  if (command === "--help" || command === "-h" || command === "help") {
    return {
      command: "help",
      openBrowser: false,
      workspacePath: cwd,
      workspacePathSpecified: false,
    };
  }

  if (command === "mcp-server") {
    const serverName = args[1];
    const allowedDirectories = readFlagValues(args, "--allowed-directory");
    const readOnlyDirectories = readFlagValues(args, "--read-only-directory");

    if (!isBuiltinMcpServerName(serverName)) {
      throw new Error(`Unknown MCP server "${serverName ?? ""}". Run "truss help" for usage.`);
    }

    return {
      ...(allowedDirectories.length > 0 ? { allowedDirectories } : {}),
      command: "mcp-server",
      conversationWorkspacePath: readFlagValue(args, "--workspace-path"),
      mcpServer: serverName,
      openBrowser: false,
      ...(readOnlyDirectories.length > 0 ? { readOnlyDirectories } : {}),
      trussHomeDir: readFlagValue(args, "--truss-home"),
      workspacePath: cwd,
      workspacePathSpecified: false,
    };
  }

  if (command !== "spawn") {
    throw new Error(`Unknown command "${command}". Run "truss help" for usage.`);
  }

  const openBrowser = !args.some(isNoOpenFlag);
  const port = readPort(args);
  const workspaceArg = readWorkspaceArg(args);

  return {
    command: "spawn",
    openBrowser,
    port,
    workspacePath: resolve(cwd, workspaceArg ?? "."),
    workspacePathSpecified: workspaceArg !== undefined,
  };
}

export function printHelp(): void {
  console.log(`Truss local agentic harness

Usage:
  truss spawn [workspace path] [--port <number>] [--no-open|--no-autolaunch]
  truss mcp-server truss-web-tools [--truss-home <path>]
  truss mcp-server truss-playwright-mcp [--truss-home <path>]
  truss mcp-server truss-chat-tools [--truss-home <path>] [--workspace-path <path>]
  truss mcp-server truss-filesystem-tools [--truss-home <path>] [--workspace-path <path>] [--allowed-directory <path>] [--read-only-directory <path>]
  truss mcp-server truss-command-runner
  truss mcp-server truss-orchestration-tools

Options:
  --port <number>   Bind a specific localhost port. Defaults to ${defaultServerPort}, with dynamic fallback.
  --no-autolaunch   Start the server without opening the default browser.
  --no-open         Alias for --no-autolaunch.
`);
}

function isNoOpenFlag(arg: string): boolean {
  return noOpenFlags.has(arg);
}

function isBuiltinMcpServerName(value: string | undefined): value is BuiltinMcpServerName {
  return (
    value === "truss-web-tools" ||
    value === "truss-playwright-mcp" ||
    value === "truss-chat-tools" ||
    value === "truss-command-runner" ||
    value === "truss-filesystem-tools" ||
    value === "truss-orchestration-tools"
  );
}

function readPort(args: string[]): number | undefined {
  const rawPort = readFlagValue(args, "--port");

  if (rawPort === undefined) {
    return undefined;
  }

  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid port "${rawPort}".`);
  }

  return port;
}

function readFlagValue(args: string[], flag: string): string | undefined {
  const flagIndex = args.findIndex((arg) => arg === flag);
  const inlineFlag = args.find((arg) => arg.startsWith(`${flag}=`));

  return inlineFlag?.slice(flag.length + 1) ?? (flagIndex >= 0 ? args[flagIndex + 1] : undefined);
}

function readFlagValues(args: string[], flag: string): string[] {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === undefined) {
      continue;
    }

    if (arg === flag) {
      const value = args[index + 1];

      if (value !== undefined) {
        values.push(value);
      }

      continue;
    }

    if (arg.startsWith(`${flag}=`)) {
      values.push(arg.slice(flag.length + 1));
    }
  }

  return values;
}

function readWorkspaceArg(args: string[]): string | undefined {
  const positional = args.slice(1).filter((arg, index, allArgs) => {
    if (
      isNoOpenFlag(arg) ||
      arg.startsWith("--allowed-directory=") ||
      arg.startsWith("--port=") ||
      arg.startsWith("--read-only-directory=") ||
      arg.startsWith("--truss-home=") ||
      arg.startsWith("--workspace-path=")
    ) {
      return false;
    }

    if (
      arg === "--allowed-directory" ||
      arg === "--port" ||
      arg === "--read-only-directory" ||
      arg === "--truss-home" ||
      arg === "--workspace-path"
    ) {
      return false;
    }

    return (
      allArgs[index - 1] !== "--allowed-directory" &&
      allArgs[index - 1] !== "--port" &&
      allArgs[index - 1] !== "--read-only-directory" &&
      allArgs[index - 1] !== "--truss-home" &&
      allArgs[index - 1] !== "--workspace-path"
    );
  });

  return positional[0];
}
