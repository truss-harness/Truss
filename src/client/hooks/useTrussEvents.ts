import { useCallback, useEffect, useMemo, useState } from "react";
import { EVENT_NAMES } from "../../shared/protocol.ts";
import type { SessionInfo, ToolRequestEvent, TrussEvent } from "../../shared/protocol.ts";
import { fetchSession } from "../api.ts";
import type { ConnectionState, Message } from "../types.ts";

const initialMessages: Message[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "### Truss harness initialized\n\nSend a command to test HTTP POST upstream handling. Send `/tool` to trigger the sample tool interception and frontend resolution flow.",
  },
];

export interface TrussEventState {
  connection: ConnectionState;
  messages: Message[];
  session: SessionInfo | null;
  statusLabel: string;
  toolRequests: ToolRequestEvent[];
  refreshSession(): Promise<void>;
}

export function useTrussEvents(): TrussEventState {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [toolRequests, setToolRequests] = useState<ToolRequestEvent[]>([]);
  const refreshSession = useCallback(async () => {
    setSession(await fetchSession());
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/events");

    source.onopen = () => setConnection("open");
    source.onerror = () => setConnection("closed");

    const handleEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as TrussEvent;

      if (event.type === "system.ready") {
        setSession(event.session);
        return;
      }

      if (event.type === "mcp.capabilities") {
        setSession((current) => (current ? { ...current, mcp: event.mcp } : current));
        return;
      }

      if (event.type === "agent.message") {
        setMessages((current) => [
          ...current,
          {
            id: event.messageId,
            role: event.role,
            content: event.content,
          },
        ]);
        return;
      }

      if (event.type === "agent.delta") {
        setMessages((current) => upsertDelta(current, event.messageId, event.delta));
        return;
      }

      if (event.type === "agent.done") {
        setMessages((current) =>
          current.map((item) =>
            item.id === event.messageId ? { ...item, streaming: false } : item,
          ),
        );
        return;
      }

      if (event.type === "tool.request") {
        setToolRequests((current) => [...current, event]);
        return;
      }

      if (event.type === "tool.resolved") {
        setToolRequests((current) =>
          current.filter((item) => item.executionId !== event.executionId),
        );
      }
    };

    for (const eventName of EVENT_NAMES) {
      source.addEventListener(eventName, handleEvent);
    }

    return () => {
      for (const eventName of EVENT_NAMES) {
        source.removeEventListener(eventName, handleEvent);
      }

      source.close();
    };
  }, []);

  const statusLabel = useMemo(() => {
    if (connection === "open") {
      return "SSE connected";
    }

    if (connection === "closed") {
      return "SSE reconnecting";
    }

    return "Connecting";
  }, [connection]);

  return {
    connection,
    messages,
    session,
    statusLabel,
    toolRequests,
    refreshSession,
  };
}

function upsertDelta(messages: Message[], messageId: string, delta: string): Message[] {
  const existing = messages.find((message) => message.id === messageId);

  if (!existing) {
    return [
      ...messages,
      {
        id: messageId,
        role: "assistant",
        content: delta,
        streaming: true,
      },
    ];
  }

  return messages.map((message) =>
    message.id === messageId
      ? {
          ...message,
          content: `${message.content}${delta}`,
          streaming: true,
        }
      : message,
  );
}
