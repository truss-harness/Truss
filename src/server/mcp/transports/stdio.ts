import type { JsonRpcMessage } from "../json-rpc.ts";
import { parseJsonRpcLine, serializeJsonRpcMessage } from "../json-rpc.ts";
import type { McpServerDefinition } from "../types.ts";
import type { McpTransport, McpTransportFactory, McpTransportOptions } from "./types.ts";
import { errorForLog, logToStdout, truncateForLog } from "../../utils/logging.ts";
import { mcpStdioApprovalKey, mcpStdioApprovalRequired } from "../stdio-approval.ts";

export const maxMcpStdioDiagnosticLineLength = 64 * 1024;
export const maxMcpStdioProtocolLineLength = 8 * 1024 * 1024;

export const stdioTransportFactory: McpTransportFactory = {
  supports: (definition) => definition.transport === "stdio",
  async create(definition, options: McpTransportOptions) {
    if (!definition.command) {
      throw new Error(`MCP stdio server "${definition.name}" is missing a command.`);
    }

    if (mcpStdioApprovalRequired(definition) && !definition.stdioCommandApproved) {
      const approvalKey = definition.stdioCommandApprovalKey ?? mcpStdioApprovalKey(definition);

      throw new Error(
        [
          `MCP stdio server "${definition.name}" is not approved for local process execution.`,
          `Approve this command from the browser before Truss spawns it.`,
          `Approval key: ${approvalKey}`,
        ].join(" "),
      );
    }

    const env = mcpStdioEnvironment(definition, options);
    const process = Bun.spawn([definition.command, ...(definition.args ?? [])], {
      cwd: definition.cwd,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    return new StdioMcpTransport(definition, process);
  },
};

export function mcpStdioEnvironment(
  definition: McpServerDefinition,
  options: McpTransportOptions,
): NodeJS.ProcessEnv {
  const browserManaged =
    definition.trussManaged &&
    (definition.id === "truss-global:truss-web-tools" ||
      definition.id === "truss-global:truss-playwright-mcp");

  return {
    ...options.env,
    ...(browserManaged ? options.managedBrowserEnv : undefined),
    ...definition.env,
  };
}

class StdioMcpTransport implements McpTransport {
  constructor(
    readonly definition: McpServerDefinition,
    readonly process: Bun.Subprocess<"pipe", "pipe", "pipe">,
  ) {
    void logStdioDiagnosticLines(definition.name, "stderr", process.stderr);
  }

  async send(message: JsonRpcMessage): Promise<void> {
    await this.process.stdin.write(serializeJsonRpcMessage(message));
    await this.process.stdin.flush();
  }

  async *messages(): AsyncIterable<JsonRpcMessage> {
    for await (const line of readBoundedStdioLines(
      this.process.stdout,
      maxMcpStdioProtocolLineLength,
      () =>
        logToStdout("mcp", "Discarded oversized unterminated stdout line from MCP server.", {
          server: this.definition.name,
        }),
    )) {
      const message = parseJsonRpcLine(line);

      if (message) {
        yield message;
      } else if (line.trim()) {
        logToStdout("mcp", "Ignored non-JSON-RPC stdout line from MCP server.", {
          line: truncateForLog(line),
          server: this.definition.name,
        });
      }
    }
  }

  async close(): Promise<void> {
    this.process.kill();
  }
}

async function logStdioDiagnosticLines(
  server: string,
  streamName: "stderr" | "stdout",
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  try {
    for await (const line of readBoundedStdioLines(
      stream,
      maxMcpStdioDiagnosticLineLength,
      () =>
        logToStdout("mcp", `Discarded oversized unterminated ${streamName} line from MCP server.`, {
          server,
        }),
    )) {
      if (!line.trim()) {
        continue;
      }

      logToStdout("mcp", `MCP server ${streamName}.`, {
        line: truncateForLog(line),
        server,
      });
    }
  } catch (caught) {
    logToStdout("mcp", `Failed to read MCP server ${streamName}.`, {
      error: errorForLog(caught),
      server,
    });
  }
}

export async function* readBoundedStdioLines(
  stream: ReadableStream<Uint8Array>,
  maxLineLength: number,
  onOversizedLine: () => void,
): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let discardingLine = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      let chunk = value ? decoder.decode(value, { stream: !done }) : decoder.decode();

      while (chunk) {
        const newlineIndex = chunk.search(/\r?\n/u);

        if (discardingLine) {
          if (newlineIndex < 0) {
            break;
          }

          discardingLine = false;
          chunk = chunk.slice(newlineIndex + (chunk[newlineIndex] === "\r" ? 2 : 1));
          continue;
        }

        if (newlineIndex < 0) {
          if (buffered.length + chunk.length > maxLineLength) {
            buffered = "";
            discardingLine = true;
            onOversizedLine();
          } else {
            buffered += chunk;
          }
          break;
        }

        const lineLength = buffered.length + newlineIndex;
        const nextChunkIndex = newlineIndex + (chunk[newlineIndex] === "\r" ? 2 : 1);

        if (lineLength > maxLineLength) {
          buffered = "";
          onOversizedLine();
        } else {
          yield `${buffered}${chunk.slice(0, newlineIndex)}`;
          buffered = "";
        }

        chunk = chunk.slice(nextChunkIndex);
      }

      if (done) {
        break;
      }
    }

    if (!discardingLine && buffered) {
      yield buffered;
    }
  } finally {
    reader.releaseLock();
  }
}
