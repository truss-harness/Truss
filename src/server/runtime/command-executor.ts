export interface CommandExecutionRequest {
  args: string[];
  command: string;
  cwd: string;
  env?: Record<string, string>;
}

export interface CommandExecutionResult {
  exitCode: number | null;
  stderr: string;
  stdout: string;
}

export async function executeCommand(
  request: CommandExecutionRequest,
): Promise<CommandExecutionResult> {
  const subprocess = Bun.spawn([request.command, ...request.args], {
    cwd: request.cwd,
    env: request.env ? { ...process.env, ...request.env } : process.env,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);

  return {
    exitCode,
    stdout,
    stderr,
  };
}
