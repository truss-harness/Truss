import type { McpToolReference, ToolApprovalRequest, ToolRequestEvent } from "../../shared/protocol.ts";
import { createId } from "../utils/id.ts";
import { now } from "../utils/time.ts";

export interface NativeToolEnvelopeOptions {
  args: Record<string, unknown>;
  title: string;
  toolId: string;
}

export interface McpToolEnvelopeOptions {
  args: Record<string, unknown>;
  approval?: ToolApprovalRequest;
  reference: McpToolReference;
  title?: string;
}

export function createNativeToolEnvelope(options: NativeToolEnvelopeOptions): ToolRequestEvent {
  return {
    id: createId("evt"),
    type: "tool.request",
    createdAt: now(),
    executionId: createId("exec"),
    toolId: options.toolId,
    title: options.title,
    origin: "native",
    args: options.args,
  };
}

export function createMcpToolEnvelope(options: McpToolEnvelopeOptions): ToolRequestEvent {
  return {
    id: createId("evt"),
    type: "tool.request",
    createdAt: now(),
    executionId: createId("exec"),
    toolId: `mcp:${options.reference.serverId}:${options.reference.toolName}`,
    title: options.title ?? `MCP tool: ${options.reference.toolName}`,
    origin: "mcp",
    args: options.args,
    mcp: options.reference,
    approval: options.approval ?? {
      policy: "on_demand",
      reason: "MCP tool execution requires explicit approval.",
    },
  };
}
