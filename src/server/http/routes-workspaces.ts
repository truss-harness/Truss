import { existsSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import type {
  ApiError,
  WorkspaceDeleteRequest,
  WorkspaceDeleteResponse,
  WorkspaceDirectoryPickResponse,
  WorkspacesResponse,
} from "../../shared/protocol.ts";
import { json, readJson } from "./responses.ts";
import type { ServerContext } from "./context.ts";

const maxWorkspacePathLength = 4_096;
const windowsPickerCancelCode = 2;

export async function handleWorkspacesRoute(
  request: Request,
  context: ServerContext,
): Promise<Response> {
  if (request.method !== "GET") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  if (context.options.conversationWorkspacePath) {
    return json<ApiError>(
      { error: "Workspace management is only available from Global View." },
      { status: 403 },
    );
  }

  return json<WorkspacesResponse>({
    workspaces: context.agentSessions.listWorkspaces(),
  });
}

export async function handleWorkspaceDeleteRoute(
  request: Request,
  context: ServerContext,
): Promise<Response> {
  if (request.method !== "POST") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  if (context.options.conversationWorkspacePath) {
    return json<ApiError>(
      { error: "Workspace deletion is only available from Global View." },
      { status: 403 },
    );
  }

  const body = await readJson<WorkspaceDeleteRequest>(request);
  const workspacePath = normalizeWorkspacePath(body?.workspacePath);

  if (!workspacePath) {
    return json<ApiError>({ error: "workspacePath is required." }, { status: 400 });
  }

  const existing = context.agentSessions
    .listWorkspaces()
    .find((workspace) => samePath(workspace.workspacePath, workspacePath));

  if (!existing) {
    return json<ApiError>({ error: "Workspace does not exist." }, { status: 404 });
  }

  const deletedCount = context.agentSessions.deleteWorkspaceSessions(existing.workspacePath);

  return json<WorkspaceDeleteResponse>({
    deleted: true,
    sessionCount: deletedCount,
    workspacePath: existing.workspacePath,
  });
}

export async function handleWorkspaceDirectoryPickRoute(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const pickedPath = await pickWorkspaceDirectory();

    if (!pickedPath) {
      return json<WorkspaceDirectoryPickResponse>({
        cancelled: true,
        workspacePath: null,
      });
    }

    return json<WorkspaceDirectoryPickResponse>({
      cancelled: false,
      workspacePath: await resolveWorkspaceDirectory(pickedPath),
    });
  } catch (caught) {
    return json<ApiError>({ error: errorMessage(caught) }, { status: 500 });
  }
}

async function pickWorkspaceDirectory(): Promise<string | null> {
  if (process.platform === "win32") {
    return pickWindowsDirectory();
  }

  if (process.platform === "darwin") {
    return pickMacDirectory();
  }

  return pickLinuxDirectory();
}

async function pickWindowsDirectory(): Promise<string | null> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$dialog = [System.Windows.Forms.FolderBrowserDialog]::new()
$dialog.Description = "Choose a folder to open with Truss."
$dialog.ShowNewFolderButton = $true
try {
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Out.WriteLine($dialog.SelectedPath)
    exit 0
  }
  exit ${windowsPickerCancelCode}
} finally {
  $dialog.Dispose()
}
`;
  const result = await runPickerCommand([
    windowsPowerShellExecutable(),
    "-NoProfile",
    "-STA",
    "-WindowStyle",
    "Hidden",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ]);

  if (result.exitCode === windowsPickerCancelCode) {
    return null;
  }

  return selectedPathFromCommand(result);
}

async function pickMacDirectory(): Promise<string | null> {
  const result = await runPickerCommand([
    "osascript",
    "-e",
    'POSIX path of (choose folder with prompt "Choose a folder to open with Truss.")',
  ]);

  if (result.exitCode !== 0 && /cancel/i.test(result.stderr)) {
    return null;
  }

  return selectedPathFromCommand(result);
}

async function pickLinuxDirectory(): Promise<string | null> {
  const result = await runPickerCommand([
    "zenity",
    "--file-selection",
    "--directory",
    "--title=Choose a folder to open with Truss",
  ]);

  if (result.exitCode !== 0 && !result.stdout.trim()) {
    return null;
  }

  return selectedPathFromCommand(result);
}

async function runPickerCommand(command: string[]): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  let child: ReturnType<typeof Bun.spawn>;

  try {
    child = Bun.spawn(command, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (caught) {
    throw new Error(`Could not open folder chooser: ${errorMessage(caught)}`);
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(child.stdout as ReadableStream<Uint8Array> | null),
    readStream(child.stderr as ReadableStream<Uint8Array> | null),
    child.exited,
  ]);

  return { exitCode, stderr, stdout };
}

function selectedPathFromCommand(result: {
  exitCode: number;
  stderr: string;
  stdout: string;
}): string | null {
  const selectedPath = result.stdout.trim();

  if (result.exitCode === 0 && selectedPath) {
    return selectedPath;
  }

  if (result.exitCode === 0) {
    return null;
  }

  throw new Error(result.stderr.trim() || "Folder chooser failed.");
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream || typeof stream.getReader !== "function") {
    return "";
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      output += decoder.decode();
      return output;
    }

    output += decoder.decode(value, { stream: true });
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

function normalizeWorkspacePath(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed && trimmed.length <= maxWorkspacePathLength ? trimmed : null;
}

function windowsPowerShellExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const candidate = join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );

  return existsSync(candidate) ? candidate : "powershell.exe";
}

function samePath(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  const normalizedLeft = left.replace(/\\/g, "/");
  const normalizedRight = right.replace(/\\/g, "/");

  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}
