import type {
  McpPromptCapability,
  McpResourceCapability,
  McpServerCapabilities,
  McpToolCapability,
} from "../../shared/protocol.ts";
import type { McpConnection } from "./client.ts";

export interface McpCapabilityNegotiationResult {
  capabilities: McpServerCapabilities;
  initialized: boolean;
}

export async function negotiateMcpCapabilities(
  serverId: string,
  connection: McpConnection,
): Promise<McpCapabilityNegotiationResult> {
  await connection.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "truss",
        version: "0.1.0",
      },
    });
  await connection.notify("notifications/initialized");

  const [tools, resources, prompts] = await Promise.all([
    listTools(connection),
    listResources(connection),
    listPrompts(connection),
  ]);

  return {
    initialized: true,
    capabilities: {
      serverId,
      name: connection.definition.name,
      tools,
      resources,
      prompts,
    },
  };
}

async function listTools(connection: McpConnection): Promise<McpToolCapability[]> {
  try {
    const result = await connection.request("tools/list");
    const tools = objectArrayField(result, "tools");

    return tools.flatMap((tool) => {
      const name = stringField(tool, "name");

      if (!name) {
        return [];
      }

      return [
        {
          name,
          description: stringField(tool, "description") ?? undefined,
          inputSchema: recordField(tool, "inputSchema") ?? undefined,
        },
      ];
    });
  } catch {
    return [];
  }
}

async function listResources(connection: McpConnection): Promise<McpResourceCapability[]> {
  try {
    const result = await connection.request("resources/list");
    const resources = objectArrayField(result, "resources");

    return resources.flatMap((resource) => {
      const uri = stringField(resource, "uri");

      if (!uri) {
        return [];
      }

      return [
        {
          uri,
          name: stringField(resource, "name") ?? undefined,
          mimeType: stringField(resource, "mimeType") ?? undefined,
        },
      ];
    });
  } catch {
    return [];
  }
}

async function listPrompts(connection: McpConnection): Promise<McpPromptCapability[]> {
  try {
    const result = await connection.request("prompts/list");
    const prompts = objectArrayField(result, "prompts");

    return prompts.flatMap((prompt) => {
      const name = stringField(prompt, "name");

      if (!name) {
        return [];
      }

      return [
        {
          name,
          description: stringField(prompt, "description") ?? undefined,
          arguments: objectArrayField(prompt, "arguments"),
        },
      ];
    });
  } catch {
    return [];
  }
}

function objectArrayField(value: unknown, key: string): Record<string, unknown>[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const field = (value as Record<string, unknown>)[key];

  return Array.isArray(field)
    ? field.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function recordField(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const field = value[key];

  return field && typeof field === "object" && !Array.isArray(field)
    ? (field as Record<string, unknown>)
    : null;
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];

  return typeof field === "string" && field.trim() ? field.trim() : null;
}
