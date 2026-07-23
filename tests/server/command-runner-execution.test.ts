import { describe, expect, it } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type {
  AgentSessionSummary,
  ChatCommandExecutionReference,
  LlmGenerationParameters,
} from "../../src/shared/protocol.ts";
import type { ServerContext } from "../../src/server/http/context.ts";
import {
  CommandExecutionRegistry,
  executeCommandRunnerTool,
} from "../../src/server/tools/command-runner.ts";

describe("command runner execution lifecycle", () => {
  it("enforces timeoutSeconds by killing run_command", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-command-timeout-"));

    try {
      const workingDirectory = await realpath(root);
      const markerPath = join(workingDirectory, "late-timeout.txt");
      const context = testContext(workingDirectory);
      let startedExecution: ChatCommandExecutionReference | null = null;
      const startedAt = Date.now();
      const result = await executeCommandRunnerTool({
        args: {
          command: delayedMarkerCommand(markerPath),
          timeoutSeconds: 1,
          workingDirectory,
        },
        commandExecutionId: "tool_timeout",
        context,
        fallbackModel: fallbackModel(),
        intent: emptyIntent(),
        onCommandExecutionStarted: (execution) => {
          startedExecution = execution;
        },
        onUserChoiceRequest: () => undefined,
        session: testSession,
        toolName: "run_command",
      });
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeLessThan(5_000);
      expect(startedExecution).toMatchObject({
        executionId: "tool_timeout",
        status: "running",
      });
      expect(result.commandExecution).toMatchObject({
        executionId: "tool_timeout",
        status: "timed_out",
      });
      expect(result.result).toContain("timedOut: true");
      expect(result.result).toContain("killed: false");
      await sleep(3_000);
      expect(await Bun.file(markerPath).exists()).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("allows a running run_command execution to be killed", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-command-kill-"));

    try {
      const workingDirectory = await realpath(root);
      const markerPath = join(workingDirectory, "late-kill.txt");
      const context = testContext(workingDirectory);
      const startedAt = Date.now();
      const result = await executeCommandRunnerTool({
        args: {
          command: delayedMarkerCommand(markerPath),
          timeoutSeconds: 30,
          workingDirectory,
        },
        commandExecutionId: "tool_kill",
        context,
        fallbackModel: fallbackModel(),
        intent: emptyIntent(),
        onCommandExecutionStarted: (execution) => {
          setTimeout(() => {
            context.commandExecutions.kill(testSession.id, execution.executionId);
          }, 100);
        },
        onUserChoiceRequest: () => undefined,
        session: testSession,
        toolName: "run_command",
      });
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeLessThan(5_000);
      expect(result.commandExecution).toMatchObject({
        executionId: "tool_kill",
        status: "killed",
      });
      expect(result.result).toContain("killed: true");
      expect(result.result).toContain("timedOut: false");
      await sleep(3_000);
      expect(await Bun.file(markerPath).exists()).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not treat the PowerShell pipeline automatic variable $_ as a path escape", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-command-ps-autovar-"));

    try {
      const workingDirectory = await realpath(root);
      const context = testContext(workingDirectory);
      const command =
        process.platform === "win32"
          ? `@(1,2,3) | ForEach-Object { Write-Output $_ }`
          : `echo previous-arg; echo $_`;
      const result = await executeCommandRunnerTool({
        args: {
          command,
          timeoutSeconds: 10,
          workingDirectory,
        },
        commandExecutionId: "tool_ps_autovar",
        context,
        fallbackModel: fallbackModel(),
        intent: emptyIntent(),
        onCommandExecutionStarted: () => undefined,
        onUserChoiceRequest: () => undefined,
        session: testSession,
        toolName: "run_command",
      });

      expect(result.commandExecution).toMatchObject({
        executionId: "tool_ps_autovar",
        status: "completed",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function testContext(workingDirectory: string): ServerContext {
  return {
    chatUserChoices: {
      waitForChoice: async () => {
        throw new Error("Command approval should not be requested.");
      },
    },
    commandExecutions: new CommandExecutionRegistry(),
    commandTerminals: {
      addGuardVerdict: () => undefined,
      kill: () => {
        throw new Error("No test terminal exists.");
      },
      list: () => [],
      spawn: async () => {
        throw new Error("Terminal spawning is not available in this test context.");
      },
      write: async () => {
        throw new Error("Terminal writing is not available in this test context.");
      },
    },
    commandWhitelist: {
      matchingEntry: () => ({
        addedBy: "user",
        createdAt: "2026-06-30T00:00:00.000Z",
        expiresAt: null,
        id: 1,
        pattern: "test",
        reason: "test",
        type: "prefix",
      }),
    },
    filesystemGrants: {
      listGrantsForContext: () => [],
    },
    getLlmProviders: () => [],
    getModelProfiles: () => [],
    mcpSettings: {
      getMcpSettings: () => ({
        commandRunner: {
          dangerousAction: "ask",
          guardModelId: null,
          guardProviderId: null,
          postExecutionGuardEnabled: false,
          preExecutionGuardEnabled: false,
          riskyAction: "ask",
          safeAction: "auto-allow",
        },
        playwrightMcp: {
          enabled: true,
          tools: "all",
        },
        sanitizerModelId: null,
        sanitizerProviderId: null,
      }),
    },
    options: {
      conversationWorkspacePath: workingDirectory,
      trussHome: null,
      workspacePath: workingDirectory,
    },
    secretEnv: {
      mergedWithProcessEnv: () => ({}),
    },
  } as unknown as ServerContext;
}

function delayedMarkerCommand(markerPath: string): string {
  return process.platform === "win32"
    ? `Start-Sleep -Seconds 2; Set-Content -LiteralPath ${powerShellString(markerPath)} -Value late`
    : `sleep 2; printf late > ${shString(markerPath)}`;
}

function powerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function shString(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fallbackModel() {
  return {
    modelId: "demo-model",
    parameters: emptyParameters(),
    providerId: "demo-provider",
  };
}

function emptyIntent() {
  return {
    conversationTitle: null,
    firstMessage: null,
    lastUserMessage: null,
  };
}

const testSession: AgentSessionSummary = {
  createdAt: "2026-06-30T00:00:00.000Z",
  id: "session_test",
  messageCount: 0,
  modelId: "demo-model",
  parameters: emptyParameters(),
  parentSessionId: null,
  providerId: "demo-provider",
  title: "Test",
  type: "agentic",
  updatedAt: "2026-06-30T00:00:00.000Z",
  wordCount: 0,
  workspacePath: null,
};

function emptyParameters(): LlmGenerationParameters {
  return {
    contextSize: null,
    temperature: null,
    topK: null,
    topP: null,
  };
}
