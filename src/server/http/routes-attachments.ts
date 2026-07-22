import type { ApiError, AttachmentConversionResponse } from "../../shared/protocol.ts";
import {
  attachmentFormatLabelForName,
  isConvertibleDocumentFile,
} from "../../shared/attachments.ts";
import {
  convertDocumentAttachmentToMarkdown,
  DocumentImageRenderConfirmationRequiredError,
  renderDocumentAttachmentToImage,
} from "../attachments/document-conversion.ts";
import { json } from "./responses.ts";

const maxAttachmentConversionSize = 8 * 1024 * 1024;

export async function handleAttachmentConversionRoute(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return json<ApiError>({ error: "Attachment upload must be multipart form data." }, { status: 400 });
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    return json<ApiError>({ error: "Attachment file is required." }, { status: 400 });
  }

  if (file.size > maxAttachmentConversionSize) {
    return json<ApiError>({ error: `${file.name} is too large.` }, { status: 400 });
  }

  if (!isConvertibleDocumentFile(file.name, file.type)) {
    return json<ApiError>(
      { error: `${file.name} cannot be converted to Markdown.` },
      { status: 400 },
    );
  }

  try {
    const converted = await convertDocumentAttachmentToMarkdown({
      data: new Uint8Array(await file.arrayBuffer()),
      mimeType: file.type,
      name: file.name,
    });

    return json<AttachmentConversionResponse>({
      attachment: {
        ...converted,
        conversionKind: "text",
        kind: "text",
        sourceFormat: attachmentFormatLabelForName(file.name, file.type),
        sourceMimeType: file.type,
        sourceName: file.name,
      },
    });
  } catch (caught) {
    return json<ApiError>(
      {
        error: caught instanceof Error ? caught.message : String(caught),
      },
      { status: 400 },
    );
  }
}

export async function handleAttachmentImageRenderRoute(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json<ApiError>({ error: "Method not allowed" }, { status: 405 });
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return json<ApiError>({ error: "Attachment upload must be multipart form data." }, { status: 400 });
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    return json<ApiError>({ error: "Attachment file is required." }, { status: 400 });
  }

  if (file.size > maxAttachmentConversionSize) {
    return json<ApiError>({ error: `${file.name} is too large.` }, { status: 400 });
  }

  if (!isConvertibleDocumentFile(file.name, file.type)) {
    return json<ApiError>(
      { error: `${file.name} cannot be rendered as an image attachment.` },
      { status: 400 },
    );
  }

  const confirmLargeBatch = formData.get("confirmLargeBatch") === "true";
  const rawPageRange = formData.get("pageRange");
  const pageRange = typeof rawPageRange === "string" ? rawPageRange : undefined;

  try {
    const rendered = await renderDocumentAttachmentToImage({
      confirmLargeBatch,
      data: new Uint8Array(await file.arrayBuffer()),
      mimeType: file.type,
      name: file.name,
      pageRange,
    });
    const sourceFormat = attachmentFormatLabelForName(file.name, file.type);

    return json<AttachmentConversionResponse>({
      attachments: rendered.images.map(({ pageCount, pageNumber, ...image }) => ({
        ...image,
        conversionKind: "image",
        kind: "image",
        sourceFormat,
        sourceMimeType: file.type,
        sourceName: file.name,
        sourcePage: pageNumber,
        sourcePageCount: pageCount,
      })),
      pageCount: rendered.pageCount,
    });
  } catch (caught) {
    if (caught instanceof DocumentImageRenderConfirmationRequiredError) {
      return json(
        {
          confirmationRequired: true,
          error:
            `${file.name} will render ${caught.pageCount} page images. ` +
            "Confirm before attaching them.",
          fileName: file.name,
          pageCount: caught.pageCount,
        },
        { status: 409 },
      );
    }

    return json<ApiError>(
      {
        error: caught instanceof Error ? caught.message : String(caught),
      },
      { status: 400 },
    );
  }
}
