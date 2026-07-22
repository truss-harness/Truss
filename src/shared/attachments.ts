export type AttachmentFileCategory = "convertible-document" | "image" | "text" | "unsupported";

const convertibleDocumentExtensions = new Set([
  ".doc",
  ".docx",
  ".odt",
  ".ods",
  ".pdf",
  ".ppt",
  ".pptx",
  ".rtf",
  ".xls",
  ".xlsb",
  ".xlsm",
  ".xlsx",
]);

const textFileExtensions = new Set([
  ".astro",
  ".bash",
  ".bat",
  ".c",
  ".cmd",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".dockerignore",
  ".env",
  ".fish",
  ".go",
  ".h",
  ".hpp",
  ".htm",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsonl",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".log",
  ".lua",
  ".m",
  ".md",
  ".mdx",
  ".php",
  ".pl",
  ".ps1",
  ".py",
  ".r",
  ".rb",
  ".rs",
  ".sass",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);

const textFileNames = new Set([
  ".editorconfig",
  ".env",
  ".gitattributes",
  ".gitignore",
  "dockerfile",
  "makefile",
]);

const convertibleDocumentMimeTypes = new Set([
  "application/msword",
  "application/pdf",
  "application/rtf",
  "application/vnd.ms-excel",
  "application/vnd.ms-excel.sheet.binary.macroenabled.12",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const textMimeTypes = new Set([
  "application/javascript",
  "application/json",
  "application/sql",
  "application/toml",
  "application/typescript",
  "application/x-httpd-php",
  "application/x-javascript",
  "application/x-sh",
  "application/x-yaml",
  "application/xml",
]);

export function classifyAttachmentFile(input: {
  name: string;
  type?: string;
}): AttachmentFileCategory {
  const mimeType = normalizeMimeType(input.type);

  if (mimeType.startsWith("image/")) {
    return "image";
  }

  if (isTextAttachmentFile(input.name, mimeType)) {
    return "text";
  }

  if (isConvertibleDocumentFile(input.name, mimeType)) {
    return "convertible-document";
  }

  return "unsupported";
}

export function isConvertibleDocumentFile(name: string, mimeType = ""): boolean {
  return (
    convertibleDocumentExtensions.has(fileExtension(name)) ||
    convertibleDocumentMimeTypes.has(normalizeMimeType(mimeType))
  );
}

export function isTextAttachmentFile(name: string, mimeType = ""): boolean {
  const normalizedMimeType = normalizeMimeType(mimeType);

  return (
    normalizedMimeType.startsWith("text/") ||
    textMimeTypes.has(normalizedMimeType) ||
    textFileExtensions.has(fileExtension(name)) ||
    textFileNames.has(fileBaseName(name).toLowerCase())
  );
}

export function markdownAttachmentNameFor(name: string): string {
  const baseName = fileBaseName(name).replace(/\.[^.]+$/, "").trim();
  const safeBaseName = baseName.length > 0 ? baseName : "attachment";

  return `${safeBaseName}.md`;
}

export function renderedImageAttachmentNameFor(name: string): string {
  const baseName = fileBaseName(name).replace(/\.[^.]+$/, "").trim();
  const safeBaseName = baseName.length > 0 ? baseName : "attachment";

  return `${safeBaseName}.png`;
}

export function renderedPageImageAttachmentNameFor(name: string, pageNumber: number): string {
  const baseName = fileBaseName(name).replace(/\.[^.]+$/, "").trim();
  const safeBaseName = baseName.length > 0 ? baseName : "attachment";

  return `${safeBaseName}-page-${pageNumber}.png`;
}

export function attachmentFormatLabelForName(name: string, mimeType = ""): string {
  const extension = fileExtension(name);
  const normalizedMimeType = normalizeMimeType(mimeType);

  if (extension === ".pdf" || normalizedMimeType === "application/pdf") {
    return "PDF";
  }

  if (
    [".doc", ".docx", ".odt", ".rtf"].includes(extension) ||
    [
      "application/msword",
      "application/rtf",
      "application/vnd.oasis.opendocument.text",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ].includes(normalizedMimeType)
  ) {
    return "Word";
  }

  if (
    [".ppt", ".pptx"].includes(extension) ||
    [
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ].includes(normalizedMimeType)
  ) {
    return "PowerPoint";
  }

  if (
    [".ods", ".xls", ".xlsb", ".xlsm", ".xlsx"].includes(extension) ||
    [
      "application/vnd.ms-excel",
      "application/vnd.ms-excel.sheet.binary.macroenabled.12",
      "application/vnd.ms-excel.sheet.macroenabled.12",
      "application/vnd.oasis.opendocument.spreadsheet",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ].includes(normalizedMimeType)
  ) {
    return "Excel";
  }

  return "Document";
}

export function fileExtension(name: string): string {
  const normalized = fileBaseName(name).toLowerCase();
  const dotIndex = normalized.lastIndexOf(".");

  if (dotIndex <= 0 || dotIndex === normalized.length - 1) {
    return "";
  }

  return normalized.slice(dotIndex);
}

export function unsupportedAttachmentMessage(name: string): string {
  const extension = fileExtension(name);

  if (extension === ".ppt") {
    return `${fileBaseName(name)} is a legacy PowerPoint file. Save it as .pptx or PDF, then attach it again.`;
  }

  return `${fileBaseName(name)} is not a text, code, image, or Markdown-convertible document file.`;
}

function normalizeMimeType(value: string | undefined): string {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function fileBaseName(name: string): string {
  const trimmed = name.trim();
  const parts = trimmed.split(/[\\/]/);

  return parts[parts.length - 1] || "attachment";
}
