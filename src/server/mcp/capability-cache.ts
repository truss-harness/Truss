import type { McpServerCapabilities } from "../../shared/protocol.ts";

export class McpCapabilityCache {
  readonly #capabilities = new Map<string, McpServerCapabilities>();

  set(serverId: string, capabilities: McpServerCapabilities): void {
    this.#capabilities.set(serverId, capabilities);
  }

  get(serverId: string): McpServerCapabilities | undefined {
    return this.#capabilities.get(serverId);
  }

  list(): McpServerCapabilities[] {
    return [...this.#capabilities.values()];
  }

  clear(serverId?: string): void {
    if (serverId) {
      this.#capabilities.delete(serverId);
      return;
    }

    this.#capabilities.clear();
  }
}
