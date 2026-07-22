import type { AgentMessageEvent } from "../shared/protocol.ts";

export interface Message {
  id: string;
  role: AgentMessageEvent["role"];
  content: string;
  streaming?: boolean;
}

export type ConnectionState = "connecting" | "open" | "closed";
