import { describe, expect, it } from "bun:test";
import { setAllMcpServersDisabled } from "../../src/client/components/settings/McpConfigUtils.ts";

describe("setAllMcpServersDisabled", () => {
  it("disables all servers in mcpServers", () => {
    const input = JSON.stringify({
      mcpServers: {
        "local-files": { type: "stdio", command: "npx" },
        "remote-search": { type: "streamable-http", url: "https://example.com" },
      },
    });

    const result = JSON.parse(setAllMcpServersDisabled(input, true));

    expect(result.mcpServers["local-files"].disabled).toBe(true);
    expect(result.mcpServers["remote-search"].disabled).toBe(true);
  });

  it("enables all servers in mcpServers by removing disabled flag", () => {
    const input = JSON.stringify({
      mcpServers: {
        "local-files": { type: "stdio", command: "npx", disabled: true },
        "remote-search": { type: "streamable-http", url: "https://example.com", disabled: true },
      },
    });

    const result = JSON.parse(setAllMcpServersDisabled(input, false));

    expect(result.mcpServers["local-files"].disabled).toBe(false);
    expect(result.mcpServers["remote-search"].disabled).toBe(false);
  });

  it("handles the legacy servers key", () => {
    const input = JSON.stringify({
      servers: {
        legacy: { type: "stdio", command: "node" },
      },
    });

    const result = JSON.parse(setAllMcpServersDisabled(input, true));

    expect(result.servers.legacy.disabled).toBe(true);
  });

  it("skips Truss-managed servers", () => {
    const input = JSON.stringify({
      mcpServers: {
        "truss-chat-tools": { _trussManaged: true, type: "stdio", command: "bun" },
        "local-files": { type: "stdio", command: "npx" },
      },
    });

    const result = JSON.parse(setAllMcpServersDisabled(input, true));

    expect(result.mcpServers["truss-chat-tools"].disabled).toBeUndefined();
    expect(result.mcpServers["local-files"].disabled).toBe(true);
  });

  it("preserves other server properties", () => {
    const input = JSON.stringify({
      mcpServers: {
        "local-files": {
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem"],
          env: { LOG_LEVEL: "info" },
        },
      },
    });

    const result = JSON.parse(setAllMcpServersDisabled(input, true));

    expect(result.mcpServers["local-files"]).toMatchObject({
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
      env: { LOG_LEVEL: "info" },
      disabled: true,
    });
  });

  it("returns the original text for invalid JSON", () => {
    const input = "not json";

    expect(() => setAllMcpServersDisabled(input, true)).toThrow();
  });

  it("returns the original text for non-object JSON", () => {
    const input = JSON.stringify(["server"]);

    expect(setAllMcpServersDisabled(input, true)).toBe(input);
  });
});
