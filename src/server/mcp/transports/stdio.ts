import type { JsonRpcMessage } from "../json-rpc.ts";
import { parseJsonRpcLine, serializeJsonRpcMessage } from "../json-rpc.ts";
import type { McpServerDefinition } from "../types.ts";
import type { McpTransport, McpTransportFactory, McpTransportOptions } from "./types.ts";
import { errorForLog, logToStdout, truncateForLog } from "../../utils/logging.ts";
import { mcpStdioApprovalKey, mcpStdioApprovalRequired } from "../stdio-approval.ts";

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

    const process = Bun.spawn([definition.command, ...(definition.args ?? [])], {
      cwd: definition.cwd,
      env: definition.env ? { ...options.env, ...definition.env } : options.env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    return new StdioMcpTransport(definition, process);
  },
};

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
    const decoder = new TextDecoderStream();
    const lineStream = this.process.stdout.pipeThrough(decoder);
    let buffered = "";

    for await (const chunk of lineStream) {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";

      for (const line of lines) {
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
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim()) {
          logToStdout("mcp", `MCP server ${streamName}.`, {
            line: truncateForLog(line),
            server,
          });
        }
      }
    }

    buffered += decoder.decode();

    if (buffered.trim()) {
      logToStdout("mcp", `MCP server ${streamName}.`, {
        line: truncateForLog(buffered),
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
