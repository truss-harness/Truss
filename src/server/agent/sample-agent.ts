import type { AgentMessageEvent, CommandAccepted } from "../../shared/protocol.ts";
import { EventHub } from "../event-hub.ts";
import { PendingToolStore } from "../tools/pending-tool-store.ts";
import { createId } from "../utils/id.ts";
import { now } from "../utils/time.ts";
import { streamAssistantReply } from "./stream-markdown.ts";

export interface SampleAgentOptions {
  hub: EventHub;
  tools: PendingToolStore;
  workspacePath: string;
}

export class SampleAgent {
  readonly #hub: EventHub;
  readonly #tools: PendingToolStore;
  readonly #workspacePath: string;

  constructor(options: SampleAgentOptions) {
    this.#hub = options.hub;
    this.#tools = options.tools;
    this.#workspacePath = options.workspacePath;
  }

  acceptCommand(content: string): CommandAccepted {
    const commandId = createId("cmd");

    this.#hub.publish({
      id: createId("evt"),
      type: "agent.message",
      createdAt: now(),
      messageId: commandId,
      role: "user",
      content,
    } satisfies AgentMessageEvent);

    const shouldRequestTool = /^\/tool\b/i.test(content) || /\bclarify\b/i.test(content);

    void streamAssistantReply(this.#hub, this.#createCommandAcceptedMarkdown(shouldRequestTool));

    if (shouldRequestTool) {
      setTimeout(() => this.#tools.publishClarificationRequest(), 450);
    }

    return { accepted: true, commandId };
  }

  resolveTool(executionId: string, payload: unknown): boolean {
    const resolved = this.#tools.resolve(executionId, payload);

    if (!resolved) {
      return false;
    }

    void streamAssistantReply(
      this.#hub,
      [
        "### Tool result received",
        "",
        `The backend resumed after \`${resolved.toolId}\` resolved.`,
        "",
        "```json",
        JSON.stringify(payload, null, 2),
        "```",
      ].join("\n"),
    );

    return true;
  }

  #createCommandAcceptedMarkdown(shouldRequestTool: boolean): string {
    return [
      "### Command accepted",
      "",
      `Truss received the command for \`${this.#workspacePath}\`.`,
      "",
      "This starter path is wired for **HTTP POST upstream commands** and **SSE downstream events**.",
      shouldRequestTool
        ? "A sample intercepted tool request will be sent next so the browser can resolve it."
        : "Send `/tool` to trigger the sample frontend resolution flow.",
    ].join("\n");
  }
}
