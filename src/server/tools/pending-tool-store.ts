import type { ToolRequestEvent, ToolResolvedEvent } from "../../shared/protocol.ts";
import { EventHub } from "../event-hub.ts";
import { createId } from "../utils/id.ts";
import { now } from "../utils/time.ts";
import { createClarificationToolRequest } from "./sample-tools.ts";

export class PendingToolStore {
  readonly #hub: EventHub;
  readonly #pending = new Map<string, ToolRequestEvent>();

  constructor(hub: EventHub) {
    this.#hub = hub;
  }

  publishClarificationRequest(): ToolRequestEvent {
    const event = createClarificationToolRequest();
    this.publish(event);
    return event;
  }

  publish(event: ToolRequestEvent): void {
    this.#pending.set(event.executionId, event);
    this.#hub.publish(event);
  }

  resolve(executionId: string, result: unknown): ToolResolvedEvent | null {
    const pendingTool = this.#pending.get(executionId);

    if (!pendingTool) {
      return null;
    }

    this.#pending.delete(executionId);

    const event: ToolResolvedEvent = {
      id: createId("evt"),
      type: "tool.resolved",
      createdAt: now(),
      executionId,
      toolId: pendingTool.toolId,
      result,
    };

    this.#hub.publish(event);
    return event;
  }
}
