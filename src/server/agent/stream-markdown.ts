import type { AgentDeltaEvent, AgentDoneEvent } from "../../shared/protocol.ts";
import { EventHub } from "../event-hub.ts";
import { createId } from "../utils/id.ts";
import { now, sleep } from "../utils/time.ts";

export async function streamAssistantReply(hub: EventHub, markdown: string): Promise<void> {
  const messageId = createId("msg");

  for (const delta of chunkMarkdown(markdown)) {
    const event: AgentDeltaEvent = {
      id: createId("evt"),
      type: "agent.delta",
      createdAt: now(),
      messageId,
      role: "assistant",
      delta,
    };

    hub.publish(event);
    await sleep(18);
  }

  const doneEvent: AgentDoneEvent = {
    id: createId("evt"),
    type: "agent.done",
    createdAt: now(),
    messageId,
  };

  hub.publish(doneEvent);
}

function chunkMarkdown(markdown: string): string[] {
  const chunks = markdown.match(/(\S+\s*|\n+)/g);
  return chunks ?? [markdown];
}
