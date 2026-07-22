import type { RefObject } from "react";
import type { ToolRequestEvent } from "../../shared/protocol.ts";
import { ToolCard } from "../tool-registry.tsx";
import type { Message } from "../types.ts";
import { MessageBubble } from "./MessageBubble.tsx";

export function Transcript({
  messages,
  onResolveTool,
  toolRequests,
  transcriptRef,
}: {
  messages: Message[];
  onResolveTool: (executionId: string, payload: unknown) => Promise<void>;
  toolRequests: ToolRequestEvent[];
  transcriptRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={transcriptRef}
      className="max-h-[calc(100vh-24rem)] min-h-[24rem] space-y-4 overflow-y-auto px-4 py-5 md:px-6"
    >
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}

      {toolRequests.map((toolRequest) => (
        <ToolCard key={toolRequest.executionId} event={toolRequest} onResolve={onResolveTool} />
      ))}
    </div>
  );
}
