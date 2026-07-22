import type { ChatAttachment, ChatAttachmentKind } from "../../../shared/protocol.ts";
import type { ChatUiMessage } from "./types.ts";

export interface ActivitySharedFile {
  dataUrl: string;
  downloadName: string;
  id: string;
  kind: ChatAttachmentKind;
  mimeType: string;
  name: string;
  size: number;
  sourceFormat?: string;
  sourcePageCount?: number;
}

export function sharedFilesForActivity(messages: ChatUiMessage[]): ActivitySharedFile[] {
  const byKey = new Map<string, ActivitySharedFile>();

  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      const key = activitySharedFileKey(attachment);

      if (byKey.has(key)) {
        continue;
      }

      byKey.set(key, activitySharedFileFromAttachment(attachment));
    }
  }

  return [...byKey.values()];
}

function activitySharedFileFromAttachment(attachment: ChatAttachment): ActivitySharedFile {
  const sourceMimeType = attachment.sourceMimeType?.trim();
  const sourceName = attachment.sourceName?.trim();
  const sourceFormat = attachment.sourceFormat?.trim();
  const sourcePageCount = positiveInteger(attachment.sourcePageCount);

  return {
    dataUrl: attachment.dataUrl,
    downloadName: attachment.name || sourceName || "shared-file",
    id: attachment.id,
    kind: activitySharedFileKind(attachment),
    mimeType: sourceMimeType || attachment.mimeType || "File",
    name: sourceName || attachment.name || "Shared file",
    size: normalizedFileSize(attachment.size),
    ...(sourceFormat ? { sourceFormat } : {}),
    ...(sourcePageCount ? { sourcePageCount } : {}),
  };
}

function activitySharedFileKind(attachment: ChatAttachment): ChatAttachmentKind {
  const sourceMimeType = attachment.sourceMimeType?.trim();

  if (!attachment.sourceName || !sourceMimeType) {
    return attachment.kind;
  }

  if (sourceMimeType.startsWith("image/")) {
    return "image";
  }

  if (sourceMimeType.startsWith("text/")) {
    return "text";
  }

  return "document";
}

function activitySharedFileKey(attachment: ChatAttachment): string {
  const sourceName = attachment.sourceName?.trim();

  if (!sourceName) {
    return `attachment:${attachment.id}`;
  }

  return `source:${sourceName}:${attachment.sourceMimeType?.trim() ?? ""}`;
}

function normalizedFileSize(size: number): number {
  return Number.isFinite(size) ? Math.max(0, Math.round(size)) : 0;
}

function positiveInteger(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}
