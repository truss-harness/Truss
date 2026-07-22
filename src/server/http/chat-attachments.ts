import type { ChatAttachment } from "../../shared/protocol.ts";

const maxAttachmentsPerMessage = 8;
const maxAttachmentSize = 8 * 1024 * 1024;
const maxAttachmentDataUrlLength = 12 * 1024 * 1024;
const maxAttachmentTextLength = 80_000;

export function validateChatAttachments(
  attachments: ChatAttachment[] | undefined,
): { ok: true; attachments: ChatAttachment[] } | { ok: false; error: string } {
  if (attachments === undefined) {
    return { ok: true, attachments: [] };
  }

  if (!Array.isArray(attachments)) {
    return { ok: false, error: "attachments must be an array." };
  }

  if (attachments.length > maxAttachmentsPerMessage) {
    return {
      ok: false,
      error: `Each message may include at most ${maxAttachmentsPerMessage} attachments.`,
    };
  }

  const normalized: ChatAttachment[] = [];

  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) {
      return { ok: false, error: "Each attachment must be an object." };
    }

    const id = normalizeOptionalText(attachment.id);
    const name = normalizeOptionalText(attachment.name);
    const mimeType = typeof attachment.mimeType === "string" ? attachment.mimeType.trim() : "";
    const dataUrl = normalizeOptionalText(attachment.dataUrl);
    const conversionKind = normalizeAttachmentConversionKind(attachment.conversionKind);
    const sourceFormat = normalizeOptionalText(attachment.sourceFormat);
    const sourceMimeType = normalizeOptionalText(attachment.sourceMimeType);
    const sourceName = normalizeOptionalText(attachment.sourceName);
    const sourcePage = normalizeOptionalPositiveInteger(attachment.sourcePage);
    const sourcePageCount = normalizeOptionalPositiveInteger(attachment.sourcePageCount);

    if (!id || !name || !dataUrl) {
      return { ok: false, error: "Attachment id, name, and dataUrl are required." };
    }

    if (attachment.conversionKind !== undefined && !conversionKind) {
      return { ok: false, error: "Attachment conversion kind must be image or text." };
    }

    if (attachment.sourcePage !== undefined && sourcePage === null) {
      return { ok: false, error: "Attachment source page must be a positive whole number." };
    }

    if (attachment.sourcePageCount !== undefined && sourcePageCount === null) {
      return { ok: false, error: "Attachment source page count must be a positive whole number." };
    }

    if (sourcePage !== null && sourcePageCount !== null && sourcePage > sourcePageCount) {
      return { ok: false, error: "Attachment source page cannot exceed source page count." };
    }

    if (!["image", "text", "document"].includes(attachment.kind)) {
      return { ok: false, error: "Attachment kind must be image, text, or document." };
    }

    if (typeof attachment.size !== "number" || !Number.isFinite(attachment.size)) {
      return { ok: false, error: "Attachment size is required." };
    }

    if (attachment.size > maxAttachmentSize) {
      return { ok: false, error: `${name} is too large.` };
    }

    if (dataUrl.length > maxAttachmentDataUrlLength) {
      return { ok: false, error: `${name} is too large to send.` };
    }

    const text = typeof attachment.text === "string" ? attachment.text : undefined;

    if (text && text.length > maxAttachmentTextLength) {
      return { ok: false, error: `${name} text is too long.` };
    }

    normalized.push({
      conversionKind: conversionKind ?? undefined,
      dataUrl,
      id,
      kind: attachment.kind,
      mimeType,
      name,
      size: attachment.size,
      sourceFormat: sourceFormat ?? undefined,
      sourceMimeType: sourceMimeType ?? undefined,
      sourceName: sourceName ?? undefined,
      sourcePage: sourcePage ?? undefined,
      sourcePageCount: sourcePageCount ?? undefined,
      text,
    });
  }

  return { ok: true, attachments: normalized };
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalPositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function normalizeAttachmentConversionKind(
  value: ChatAttachment["conversionKind"] | null | undefined,
): ChatAttachment["conversionKind"] | null {
  return value === "image" || value === "text" ? value : null;
}
