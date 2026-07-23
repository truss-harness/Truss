import { existsSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import process from "node:process";
import type {
  ApiError,
  WorkspaceConversationLaunchRequest,
  WorkspaceConversationLaunchResponse,
} from "../../shared/protocol.ts";
import { isStandaloneRuntime } from "../runtime/project-root.ts";
import { json, readJson } from "./responses.ts";
import type { ServerContext } from "./context.ts";
import { browserBrokerCredentialEnv } from "../browser/broker-protocol.ts";
import type { BrowserBrokerCredentials } from "../browser/broker-protocol.ts";

const workspaceLaunchTimeoutMs = 15_000;
const maxLaunchWorkspacePathLength = 4_096;
const maxLaunchIdentifierLength = 240;
const listeningUrlPattern = /Truss listening on (http:\/\/[^\s]+)/;

interface WorkspaceLaunchEntry {
  child: ReturnType<typeof Bun.spawn>;
  exited: boolean;
  ready: Promise<string>;
}

const workspaceLaunches = new Map<string, WorkspaceLaunchEntry>();

type WorkspaceLaunchValidation =
  | {
      messageId: string | null;
      mode: "global";
      ok: true;
      sessionId: string | null;
    }
  | {
      messageId: string | null;
      mode: "workspace";
      ok: true;
      sessionId: string | null;
      workspacePath: string;
    };

type WorkspaceLaunchTarget =
  | {
      cwd: string;
      mode: "global";
    }
  | {
      cwd: string;
      mode: "workspace";
      workspacePath: string;
    };

export async function handleWorkspaceLaunchRoute(
  request: Request,
  context: ServerContext,
  currentPort: number,
): Promise<Response> {
  if (request.method !== "POST") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJson<WorkspaceConversationLaunchRequest>(request);
  const validation = await validateWorkspaceLaunchRequest(body, context);

  if (!validation.ok) {
    return json<ApiError>({ error: validation.error }, { status: validation.status });
  }

  try {
    const baseLaunch = currentLaunchMatches(context, validation)
      ? {
          baseUrl: `http://127.0.0.1:${currentPort}`,
          reused: true,
        }
      : await launchTrussServer(context, launchTargetForValidation(context, validation));

    return json<WorkspaceConversationLaunchResponse>({
      reused: baseLaunch.reused,
      url: workspaceLaunchUrl({
        baseUrl: baseLaunch.baseUrl,
        messageId: validation.messageId,
        mode: validation.mode,
        sessionId: validation.sessionId,
        workspacePath: validation.mode === "workspace" ? validation.workspacePath : null,
      }),
      workspacePath: validation.mode === "workspace" ? validation.workspacePath : null,
    });
  } catch (caught) {
    return json<ApiError>({ error: errorMessage(caught) }, { status: 500 });
  }
}

async function validateWorkspaceLaunchRequest(
  body: WorkspaceConversationLaunchRequest | null,
  context: ServerContext,
): Promise<
  | WorkspaceLaunchValidation
  | { ok: false; error: string; status: number }
> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Workspace launch payload must be an object.", status: 400 };
  }

  const sessionId = normalizeLaunchIdentifier(body.sessionId);

  if (body.workspacePath === null) {
    return {
      ok: true,
      messageId: normalizeLaunchIdentifier(body.messageId),
      mode: "global",
      sessionId,
    };
  }

  let requestedWorkspacePath = normalizeWorkspacePath(body.workspacePath);
  const session = sessionId ? context.agentSessions.getAgentSession(sessionId) : null;

  if (sessionId && !session) {
    return { ok: false, error: "Agent session does not exist.", status: 404 };
  }

  if (sessionId && !session?.workspacePath) {
    return {
      ok: false,
      error: "This conversation was not created in a workspace.",
      status: 400,
    };
  }

  requestedWorkspacePath = requestedWorkspacePath ?? session?.workspacePath ?? null;

  if (!requestedWorkspacePath) {
    return { ok: false, error: "workspacePath is required.", status: 400 };
  }

  let workspacePath: string;

  try {
    workspacePath = await resolveWorkspaceDirectory(requestedWorkspacePath);
  } catch (caught) {
    return { ok: false, error: errorMessage(caught), status: 400 };
  }

  if (session?.workspacePath) {
    let sessionWorkspacePath: string;

    try {
      sessionWorkspacePath = await resolveWorkspaceDirectory(session.workspacePath);
    } catch (caught) {
      return { ok: false, error: errorMessage(caught), status: 400 };
    }

    if (!samePath(workspacePath, sessionWorkspacePath)) {
      return {
        ok: false,
        error: "Workspace path does not match this conversation.",
        status: 400,
      };
    }
  }

  return {
    ok: true,
    messageId: normalizeLaunchIdentifier(body.messageId),
    mode: "workspace",
    sessionId,
    workspacePath,
  };
}

function currentLaunchMatches(
  context: ServerContext,
  validation: WorkspaceLaunchValidation,
): boolean {
  if (validation.mode === "global") {
    return !context.options.conversationWorkspacePath;
  }

  return samePath(validation.workspacePath, context.options.conversationWorkspacePath);
}

function launchTargetForValidation(
  context: ServerContext,
  validation: WorkspaceLaunchValidation,
): WorkspaceLaunchTarget {
  if (validation.mode === "global") {
    return {
      cwd: context.options.workspacePath,
      mode: "global",
    };
  }

  return {
    cwd: validation.workspacePath,
    mode: "workspace",
    workspacePath: validation.workspacePath,
  };
}

async function launchTrussServer(
  context: ServerContext,
  target: WorkspaceLaunchTarget,
): Promise<{ baseUrl: string; reused: boolean }> {
  const key = launchKey(target);
  const existing = workspaceLaunches.get(key);

  if (existing && !existing.exited) {
    return { baseUrl: await existing.ready, reused: true };
  }

  const entry = startTrussLaunch(context, target);

  workspaceLaunches.set(key, entry);

  try {
    return { baseUrl: await entry.ready, reused: false };
  } catch (caught) {
    workspaceLaunches.delete(key);
    entry.exited = true;
    entry.child.kill();
    throw caught;
  }
}

function startTrussLaunch(
  context: ServerContext,
  target: WorkspaceLaunchTarget,
): WorkspaceLaunchEntry {
  const child = Bun.spawn(workspaceLaunchCommand(context, target), {
    cwd: target.cwd,
    env: workspaceLaunchEnvironment(context.options.browserBroker),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const entry: WorkspaceLaunchEntry = {
    child,
    exited: false,
    ready: waitForWorkspaceLaunchUrl(child),
  };
  const key = launchKey(target);

  void drainStream(child.stderr);
  void child.exited.finally(() => {
    entry.exited = true;

    if (workspaceLaunches.get(key) === entry) {
      workspaceLaunches.delete(key);
    }
  });

  return entry;
}

export function workspaceLaunchEnvironment(
  browserBroker?: BrowserBrokerCredentials,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...env,
    ...(browserBroker ? browserBrokerCredentialEnv(browserBroker) : undefined),
  };
}

function workspaceLaunchCommand(context: ServerContext, target: WorkspaceLaunchTarget): string[] {
  const scopeArgs = target.mode === "workspace" ? [target.workspacePath] : [];
  const homeArgs = ["--truss-home", context.options.trussHome.dir];

  if (isStandaloneRuntime()) {
    return [process.execPath, "spawn", ...scopeArgs, ...homeArgs, "--no-autolaunch"];
  }

  return [
    resolveBunCommand(),
    resolve(context.options.projectRoot, "src", "server", "index.ts"),
    "spawn",
    ...scopeArgs,
    ...homeArgs,
    "--no-autolaunch",
  ];
}

async function waitForWorkspaceLaunchUrl(child: ReturnType<typeof Bun.spawn>): Promise<string> {
  const stdout = child.stdout as ReadableStream<Uint8Array> | null;

  if (!stdout || typeof stdout.getReader !== "function") {
    throw new Error("Workspace launch did not expose stdout.");
  }

  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("Workspace launch did not report a URL in time."));
    }, workspaceLaunchTimeoutMs);
  });
  const readOutput = (async () => {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        const exitCode = await child.exited.catch(() => null);
        throw new Error(
          exitCode === null
            ? "Workspace launch ended before reporting a URL."
            : `Workspace launch exited before reporting a URL (exit code ${exitCode}).`,
        );
      }

      output += decoder.decode(value, { stream: true });

      const match = output.match(listeningUrlPattern);

      if (match?.[1]) {
        return match[1];
      }
    }
  })();

  try {
    return await Promise.race([readOutput, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function drainStream(stream: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!stream || typeof stream.getReader !== "function") {
    return;
  }

  try {
    const reader = stream.getReader();

    while (!(await reader.read()).done) {
      // Drain stderr so the child process cannot block on a full pipe.
    }
  } catch {
    // Launch stderr is best-effort diagnostics; the ready promise reports failures.
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

function workspaceLaunchUrl({
  baseUrl,
  messageId,
  mode,
  sessionId,
  workspacePath,
}: {
  baseUrl: string;
  messageId: string | null;
  mode: "global" | "workspace";
  sessionId: string | null;
  workspacePath: string | null;
}): string {
  const url = new URL(sessionId ? `/chat/${encodeURIComponent(sessionId)}` : "/", baseUrl);

  if (sessionId || mode === "workspace") {
    url.searchParams.set("context", mode);
  }

  if (mode === "workspace" && workspacePath) {
    url.searchParams.set("workspace", workspacePath);
  }

  if (messageId) {
    url.hash = `message=${encodeURIComponent(messageId)}`;
  }

  return url.href;
}

function launchKey(target: WorkspaceLaunchTarget): string {
  return target.mode === "workspace"
    ? `workspace:${pathKey(target.workspacePath)}`
    : `global:${pathKey(target.cwd)}`;
}

function normalizeLaunchIdentifier(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed && trimmed.length <= maxLaunchIdentifierLength ? trimmed : null;
}

function normalizeWorkspacePath(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed && trimmed.length <= maxLaunchWorkspacePathLength ? trimmed : null;
}

function resolveBunCommand(): string {
  const executableName = process.platform === "win32" ? "bun.exe" : "bun";
  const installDir = process.env.BUN_INSTALL;
  const candidates = [
    installDir ? join(installDir, "bin", executableName) : null,
    join(homedir(), ".bun", "bin", executableName),
    ...bunPathCandidates(),
    process.execPath,
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return "bun";
}

function bunPathCandidates(): string[] {
  const path = process.env.PATH ?? "";

  return path
    .split(delimiter)
    .filter(Boolean)
    .flatMap((entry) => bunNamesForPlatform().map((name) => join(entry, name)));
}

function bunNamesForPlatform(): string[] {
  return process.platform === "win32" ? ["bun.exe", "bun.cmd", "bun"] : ["bun"];
}

function samePath(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  return pathKey(left) === pathKey(right);
}

function pathKey(value: string): string {
  const normalized = value.replace(/\\/g, "/");

  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}
