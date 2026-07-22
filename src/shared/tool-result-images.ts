export interface ToolResultImageData {
  contentType: string;
  data: string;
}

export interface ToolResultImagePreview {
  contentType: string;
  src: string;
}

export function toolResultImageData(value: string): ToolResultImageData | null {
  const dataUrl = imageDataFromText(value);

  if (dataUrl) {
    return dataUrl;
  }

  const parsed = parseJsonToolResult(value);
  const parsedImage = toolResultImageDataFromUnknown(parsed);

  if (parsedImage) {
    return parsedImage;
  }

  return toonImageData(value);
}

export function toolResultImagePreview(value: string): ToolResultImagePreview | null {
  return toolResultImagePreviewFromData(toolResultImageData(value));
}

export function toolResultImagePreviewFromData(
  image: ToolResultImageData | null | undefined,
): ToolResultImagePreview | null {
  if (!image) {
    return null;
  }

  const normalized = normalizeImageData(image.contentType, image.data);

  if (!normalized) {
    return null;
  }

  return {
    contentType: normalized.contentType,
    src: `data:${normalized.contentType};base64,${normalized.data}`,
  };
}

function imageDataFromText(value: string): ToolResultImageData | null {
  const match = value.match(/data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)/i);

  if (!match?.[1] || !match[2]) {
    return null;
  }

  return dataUrlImageData(match[1], match[2]);
}

function parseJsonToolResult(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toolResultImageDataFromUnknown(
  value: unknown,
  depth = 0,
): ToolResultImageData | null {
  if (depth > 4 || value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return imageDataFromText(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const image = toolResultImageDataFromUnknown(item, depth + 1);

      if (image) {
        return image;
      }
    }

    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const dataUrl = firstString(
    record.dataUrl,
    record.data_url,
    record.imageDataUrl,
    record.image_data_url,
    record.url,
  );
  const imageDataUrl = dataUrl ? imageDataFromText(dataUrl) : null;

  if (imageDataUrl) {
    return imageDataUrl;
  }

  const declaredType = firstString(record.type, record.kind);
  const contentType = normalizeImageContentType(
    firstString(
      record.contentType,
      record.content_type,
      record.mimeType,
      record.mime_type,
      record.mediaType,
      record.media_type,
      declaredType?.startsWith("image/") ? declaredType : null,
    ),
  );
  const base64 = firstString(
    record.imageBase64,
    record.image_base64,
    record.base64,
    record.b64_json,
    declaredType === "image" || contentType ? record.data : null,
  );

  if (base64) {
    return dataUrlImageData(contentType ?? inferImageContentType(base64), base64);
  }

  for (const nestedKey of ["content", "contents", "result", "results", "image", "images"]) {
    const image = toolResultImageDataFromUnknown(record[nestedKey], depth + 1);

    if (image) {
      return image;
    }
  }

  return null;
}

function toonImageData(value: string): ToolResultImageData | null {
  const contentType = normalizeImageContentType(
    value.match(/^\s*content_type:\s*(image\/[a-z0-9.+-]+)/im)?.[1],
  );
  const prefixMatch = value.match(
    /^\s*data_url_prefix:\s*(data:(image\/[a-z0-9.+-]+);base64,)/im,
  );
  const prefixContentType = normalizeImageContentType(prefixMatch?.[2]);
  const inlineBase64 = value.match(/^\s*image_base64:\s*([a-z0-9+/=]+)\s*$/im)?.[1];
  const blockBase64 = value.match(
    /^\s*image_base64:\s*\|-\s*\r?\n((?:[ \t]+[a-z0-9+/=]+\s*(?:\r?\n|$))+)/im,
  )?.[1];
  const base64 = inlineBase64 ?? blockBase64;

  if (!base64) {
    return null;
  }

  return dataUrlImageData(
    prefixContentType ?? contentType ?? inferImageContentType(base64),
    base64,
  );
}

function dataUrlImageData(
  contentType: string | null | undefined,
  base64: string,
): ToolResultImageData | null {
  const normalized = normalizeImageData(contentType, base64);

  if (!normalized) {
    return null;
  }

  return normalized;
}

function normalizeImageData(
  contentType: string | null | undefined,
  base64: string,
): ToolResultImageData | null {
  const normalizedBase64 = base64.replace(/\s+/g, "");

  if (!normalizedBase64 || !/^[a-z0-9+/=]+$/i.test(normalizedBase64)) {
    return null;
  }

  const normalizedContentType =
    normalizeImageContentType(contentType) ?? inferImageContentType(normalizedBase64);

  return {
    contentType: normalizedContentType,
    data: normalizedBase64,
  };
}

function normalizeImageContentType(value: unknown): string | null {
  return typeof value === "string" && /^image\/[a-z0-9.+-]+$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : null;
}

function inferImageContentType(base64: string): string {
  const normalized = base64.replace(/\s+/g, "");

  if (normalized.startsWith("/9j/")) {
    return "image/jpeg";
  }

  if (normalized.startsWith("iVBOR")) {
    return "image/png";
  }

  if (normalized.startsWith("R0lG")) {
    return "image/gif";
  }

  if (normalized.startsWith("UklGR")) {
    return "image/webp";
  }

  return "image/png";
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}
