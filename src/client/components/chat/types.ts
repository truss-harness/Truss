import type {
  ChatAttachment,
  ChatCompletionMetrics,
  ChatGeneratedMessageMetadata,
  ChatThinking,
} from "../../../shared/protocol.ts";

export type ComposerMode = "conversation" | "agent";
export type ChatUiStatus = "idle" | "thinking" | "error";
export type ConversationExportFormat = "html" | "markdown" | "json" | "atif" | "docx";

export interface ChatUiMessage {
  attachments?: ChatAttachment[];
  completedAt?: string;
  content: string;
  createdAt: string;
  id: string;
  generated?: ChatGeneratedMessageMetadata;
  modelId?: string;
  persisted?: boolean;
  role: "user" | "assistant";
  status?: ChatUiStatus;
  thinking?: ChatThinking | null;
  metrics?: ChatCompletionMetrics | null;
}
