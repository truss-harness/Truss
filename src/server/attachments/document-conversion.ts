import { Buffer } from "node:buffer";
import * as XLSX from "xlsx";
import {
  fileExtension,
  markdownAttachmentNameFor,
  renderedPageImageAttachmentNameFor,
  unsupportedAttachmentMessage,
} from "../../shared/attachments.ts";
import { convertWithPandocWasm } from "../pandoc.ts";
import { ensurePdfjsRuntimePolyfills } from "./pdfjs-runtime-polyfills.ts";

interface DocumentConversionInput {
  data: Uint8Array;
  mimeType: string;
  name: string;
}

interface DocumentImageRenderInput extends DocumentConversionInput {
  confirmLargeBatch?: boolean;
  pageRange?: string;
}

export interface ConvertedMarkdownDocument {
  dataUrl: string;
  mimeType: "text/markdown";
  name: string;
  size: number;
  text: string;
}

export interface RenderedDocumentImage {
  dataUrl: string;
  mimeType: "image/png";
  name: string;
  pageCount: number;
  pageNumber: number;
  size: number;
}

export interface RenderedDocumentImages {
  images: RenderedDocumentImage[];
  pageCount: number;
}

export class DocumentImageRenderConfirmationRequiredError extends Error {
  readonly pageCount: number;

  constructor({
    name,
    pageCount,
  }: {
    name: string;
    pageCount: number;
  }) {
    super(
      `${name} will render ${pageCount} page images. Confirm before attaching them.`,
    );
    this.name = "DocumentImageRenderConfirmationRequiredError";
    this.pageCount = pageCount;
  }
}

type WordExtractorConstructor = new () => {
  extract(document: Buffer): Promise<{
    getAnnotations(): string;
    getBody(): string;
    getEndnotes(): string;
    getFooters(): string;
    getFootnotes(): string;
    getHeaders(options?: { includeFooters?: boolean }): string;
    getTextboxes(options?: {
      includeBody?: boolean;
      includeHeadersAndFooters?: boolean;
    }): string;
  }>;
};

type PdfParser = {
  destroy(): Promise<void>;
  getInfo(): Promise<{ total: number }>;
  getScreenshot(options: {
    desiredWidth: number;
    imageBuffer: boolean;
    imageDataUrl: boolean;
    partial?: number[];
  }): Promise<{
    pages: Array<{
      data: ArrayBuffer | Uint8Array | string;
      dataUrl?: string;
      pageNumber: number;
    }>;
    total: number;
  }>;
  getText(): Promise<{
    pages: Array<{
      num: number;
      text: string;
    }>;
  }>;
};

type PdfParseConstructor = new (options: { data: Uint8Array }) => PdfParser;

const maxConvertedMarkdownLength = 80_000;
const maxImageRenderPagesBeforeConfirmation = 5;
const pandocInputFormatByExtension: Record<string, string> = {
  ".docx": "docx",
  ".odt": "odt",
  ".pptx": "pptx",
  ".rtf": "rtf",
};
const spreadsheetExtensions = new Set([".ods", ".xls", ".xlsb", ".xlsm", ".xlsx"]);

export async function convertDocumentAttachmentToMarkdown({
  data,
  mimeType,
  name,
}: DocumentConversionInput): Promise<ConvertedMarkdownDocument> {
  const markdown = normalizeMarkdown(await convertDocumentDataToMarkdown({ data, mimeType, name }));

  if (!markdown.trim()) {
    throw new Error(`${name} did not contain extractable text.`);
  }

  const text = addSourceHeading(name, markdown);

  if (text.length > maxConvertedMarkdownLength) {
    throw new Error(
      `${name} converted to more text than Truss can attach. Try a smaller file or split the document.`,
    );
  }

  const encoded = Buffer.from(text, "utf8");

  return {
    dataUrl: `data:text/markdown;charset=utf-8;base64,${encoded.toString("base64")}`,
    mimeType: "text/markdown",
    name: markdownAttachmentNameFor(name),
    size: encoded.byteLength,
    text,
  };
}

export async function renderDocumentAttachmentToImage({
  confirmLargeBatch = false,
  data,
  mimeType,
  name,
  pageRange,
}: DocumentImageRenderInput): Promise<RenderedDocumentImages> {
  const extension = fileExtension(name);

  if (extension !== ".pdf" && mimeType !== "application/pdf") {
    throw new Error(
      `${name} cannot be rendered as an image yet. Attach it as text, or convert it to PDF first.`,
    );
  }

  return renderPdfPagesToImages({ confirmLargeBatch, data, name, pageRange });
}

async function convertDocumentDataToMarkdown({
  data,
  mimeType,
  name,
}: DocumentConversionInput): Promise<string> {
  const extension = fileExtension(name);

  if (extension === ".pdf" || mimeType === "application/pdf") {
    return convertPdfToMarkdown(data);
  }

  if (extension === ".doc") {
    return convertLegacyWordToMarkdown(data);
  }

  if (extension === ".ppt") {
    return convertLegacyPowerPointToMarkdown(data);
  }

  if (spreadsheetExtensions.has(extension)) {
    return convertSpreadsheetToMarkdown(data);
  }

  const pandocInputFormat = pandocInputFormatByExtension[extension];

  if (!pandocInputFormat) {
    throw new Error(unsupportedAttachmentMessage(name));
  }

  return convertWithPandoc({
    data,
    from: pandocInputFormat,
    mimeType,
    name,
  });
}

async function convertWithPandoc({
  data,
  from,
  mimeType,
  name,
}: {
  data: Uint8Array;
  from: string;
  mimeType: string;
  name: string;
}): Promise<string> {
  const inputName = virtualPandocFileName(name);
  const result = await convertWithPandocWasm(
    {
      from,
      "markdown-headings": "atx",
      to: "gfm",
      wrap: "none",
    },
    null,
    {
      [inputName]: new Blob([arrayBufferForBlob(data)], {
        type: mimeType || "application/octet-stream",
      }),
    },
  );

  if (result.stderr.trim()) {
    throw new Error(`Pandoc could not convert ${name}: ${result.stderr.trim()}`);
  }

  return result.stdout;
}

async function convertPdfToMarkdown(data: Uint8Array): Promise<string> {
  const parser = await createPdfParser(data);

  try {
    const result = await parser.getText();

    return result.pages
      .map((page) => ({ number: page.num, text: page.text.trim() }))
      .filter((page) => page.text.length > 0)
      .map((page) => `## Page ${page.number}\n\n${page.text}`)
      .join("\n\n");
  } finally {
    await parser.destroy();
  }
}

async function renderPdfPagesToImages({
  confirmLargeBatch,
  data,
  name,
  pageRange,
}: {
  confirmLargeBatch: boolean;
  data: Uint8Array;
  name: string;
  pageRange?: string;
}): Promise<RenderedDocumentImages> {
  const parser = await createPdfParser(data);

  try {
    const info = await parser.getInfo();
    const pageCount = info.total;
    const selectedPages = parsePdfPageRange(pageRange, pageCount, name);
    const renderedImageCount = selectedPages?.length ?? pageCount;

    if (renderedImageCount > maxImageRenderPagesBeforeConfirmation && !confirmLargeBatch) {
      throw new DocumentImageRenderConfirmationRequiredError({
        name,
        pageCount: renderedImageCount,
      });
    }

    const result = await parser.getScreenshot({
      desiredWidth: 1200,
      imageBuffer: true,
      imageDataUrl: true,
      ...(selectedPages ? { partial: selectedPages } : {}),
    });

    if (result.pages.length === 0) {
      throw new Error(`${name} did not contain a page Truss could render.`);
    }

    const renderedPageCount = result.total || pageCount;

    return {
      images: result.pages.map((page) => {
        const pageData = page.data instanceof ArrayBuffer ? new Uint8Array(page.data) : page.data;
        const bytes = Buffer.from(pageData);
        const dataUrl =
          page.dataUrl && page.dataUrl.startsWith("data:image/")
            ? page.dataUrl
            : `data:image/png;base64,${bytes.toString("base64")}`;

        return {
          dataUrl,
          mimeType: "image/png",
          name: renderedPageImageAttachmentNameFor(name, page.pageNumber),
          pageCount: renderedPageCount,
          pageNumber: page.pageNumber,
          size: bytes.byteLength,
        };
      }),
      pageCount: renderedPageCount,
    };
  } finally {
    await parser.destroy();
  }
}

async function createPdfParser(data: Uint8Array): Promise<PdfParser> {
  await ensurePdfjsRuntimePolyfills();

  const { PDFParse } = (await import("pdf-parse")) as { PDFParse: PdfParseConstructor };

  return new PDFParse({ data });
}

function parsePdfPageRange(
  value: string | undefined,
  totalPages: number,
  name: string,
): number[] | undefined {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  const pages = new Set<number>();
  const parts = trimmed.split(",").map((part) => part.trim());

  for (const part of parts) {
    if (!part) {
      throw new Error(`Page range for ${name} contains an empty segment.`);
    }

    const singlePage = /^(\d+)$/.exec(part);

    if (singlePage) {
      const pageValue = singlePage[1];

      if (!pageValue) {
        throw new Error(`Page range for ${name} must look like 1-3 or 1,3,5.`);
      }

      addPageToRange(Number.parseInt(pageValue, 10), pages, totalPages, name);
      continue;
    }

    const pageRange = /^(\d+)\s*-\s*(\d+)$/.exec(part);

    if (!pageRange) {
      throw new Error(`Page range for ${name} must look like 1-3 or 1,3,5.`);
    }

    const startValue = pageRange[1];
    const endValue = pageRange[2];

    if (!startValue || !endValue) {
      throw new Error(`Page range for ${name} must look like 1-3 or 1,3,5.`);
    }

    const start = Number.parseInt(startValue, 10);
    const end = Number.parseInt(endValue, 10);

    if (start > end) {
      throw new Error(`Page range for ${name} must start before it ends.`);
    }

    for (let page = start; page <= end; page += 1) {
      addPageToRange(page, pages, totalPages, name);
    }
  }

  if (pages.size === 0) {
    throw new Error(`Page range for ${name} did not include any pages.`);
  }

  return Array.from(pages).sort((left, right) => left - right);
}

function addPageToRange(
  page: number,
  pages: Set<number>,
  totalPages: number,
  name: string,
): void {
  if (!Number.isInteger(page) || page < 1 || page > totalPages) {
    throw new Error(`${name} only has ${totalPages} pages. Choose a page from 1 to ${totalPages}.`);
  }

  pages.add(page);
}

async function convertLegacyWordToMarkdown(data: Uint8Array): Promise<string> {
  const extractor = await createWordExtractor();
  const document = await extractor.extract(Buffer.from(data));
  const sections = [
    document.getHeaders({ includeFooters: false }),
    document.getBody(),
    document.getTextboxes(),
    document.getFootnotes(),
    document.getEndnotes(),
    document.getAnnotations(),
    document.getFooters(),
  ];

  return sections.map((section) => section.trim()).filter(Boolean).join("\n\n");
}

async function createWordExtractor(): Promise<InstanceType<WordExtractorConstructor>> {
  const imported = await import("word-extractor");
  const WordExtractor = wordExtractorConstructorFromModule(imported);

  return new WordExtractor();
}

function wordExtractorConstructorFromModule(value: unknown): WordExtractorConstructor {
  if (typeof value === "function") {
    return value as WordExtractorConstructor;
  }

  if (value && typeof value === "object" && "default" in value) {
    const defaultExport = (value as { default?: unknown }).default;

    if (typeof defaultExport === "function") {
      return defaultExport as WordExtractorConstructor;
    }
  }

  throw new Error("word-extractor did not expose a usable constructor.");
}

function convertLegacyPowerPointToMarkdown(data: Uint8Array): string {
  const textRuns = dedupeTextRuns([
    ...extractUtf16TextRuns(data),
    ...extractAsciiTextRuns(data),
  ]).slice(0, 400);

  return textRuns.map(escapeMarkdownText).join("\n\n");
}

function convertSpreadsheetToMarkdown(data: Uint8Array): string {
  const workbook = XLSX.read(data, {
    cellDates: true,
    raw: false,
    type: "array",
  });

  return workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];

    if (!worksheet) {
      return "";
    }

    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      blankrows: false,
      defval: "",
      header: 1,
      raw: false,
    });
    const table = rowsToMarkdownTable(rows);

    return table ? `## ${escapeMarkdownText(sheetName)}\n\n${table}` : "";
  })
    .filter(Boolean)
    .join("\n\n");
}

function rowsToMarkdownTable(rows: unknown[][]): string {
  const normalizedRows = rows
    .map((row) => row.map((cell) => String(cell ?? "").trim()))
    .filter((row) => row.some((cell) => cell.length > 0));

  if (normalizedRows.length === 0) {
    return "";
  }

  const columnCount = Math.max(...normalizedRows.map((row) => row.length), 1);
  const [firstRow, ...bodyRows] = normalizedRows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => escapeTableCell(row[index] ?? "")),
  );
  const header = firstRow ?? Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`);
  const separator = Array.from({ length: columnCount }, () => "---");
  const rowsToRender = bodyRows.length > 0 ? bodyRows : [Array.from({ length: columnCount }, () => "")];

  return [header, separator, ...rowsToRender]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function addSourceHeading(name: string, markdown: string): string {
  const sourceHeading = `# ${escapeMarkdownText(name)}`;

  return markdown ? `${sourceHeading}\n\n${markdown}` : sourceHeading;
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_{}[\]<>()#+\-.!|])/g, "\\$1");
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function extractUtf16TextRuns(data: Uint8Array): string[] {
  const runs: string[] = [];
  let current = "";

  for (let index = 0; index + 1 < data.length; index += 2) {
    const codePoint = (data[index] ?? 0) | ((data[index + 1] ?? 0) << 8);

    if (isReadableCodePoint(codePoint)) {
      current += String.fromCharCode(codePoint);
      continue;
    }

    pushUtf16TextRun(runs, current);
    current = "";
  }

  pushUtf16TextRun(runs, current);

  return runs;
}

function extractAsciiTextRuns(data: Uint8Array): string[] {
  const runs: string[] = [];
  let current = "";

  for (const byte of data) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) {
      current += String.fromCharCode(byte);
      continue;
    }

    pushTextRun(runs, current);
    current = "";
  }

  pushTextRun(runs, current);

  return runs;
}

function pushTextRun(runs: string[], value: string): void {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (isUsefulTextRun(normalized)) {
    runs.push(normalized);
  }
}

function pushUtf16TextRun(runs: string[], value: string): void {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (isUsefulTextRun(normalized) && isLikelyReadableUtf16Run(normalized)) {
    runs.push(normalized);
  }
}

function isReadableCodePoint(codePoint: number): boolean {
  return (
    codePoint === 9 ||
    codePoint === 10 ||
    codePoint === 13 ||
    (codePoint >= 32 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd)
  );
}

function isUsefulTextRun(value: string): boolean {
  if (value.length < 3 || value.length > 1_000) {
    return false;
  }

  if (!/[\p{L}\p{N}]/u.test(value)) {
    return false;
  }

  if (/^(?:Microsoft PowerPoint|PowerPoint Document|Current User)$/i.test(value)) {
    return false;
  }

  return true;
}

function isLikelyReadableUtf16Run(value: string): boolean {
  const characters = Array.from(value);

  if (characters.length === 0) {
    return false;
  }

  const asciiLikeCount = characters.filter((character) => {
    const codePoint = character.codePointAt(0) ?? 0;

    return codePoint >= 9 && codePoint <= 126;
  }).length;

  return asciiLikeCount / characters.length >= 0.25;
}

function dedupeTextRuns(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(value);
  }

  return deduped;
}

function virtualPandocFileName(name: string): string {
  const safeName = name.replace(/[\\/:\0]/g, "-").trim();

  return safeName || "attachment";
}

function arrayBufferForBlob(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);

  new Uint8Array(buffer).set(data);

  return buffer;
}
