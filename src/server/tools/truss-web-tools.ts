import type {
  ChatToolSettings,
  LlmGenerationParameters,
  LlmModelProfileId,
  LlmProviderSummary,
} from "../../shared/protocol.ts";
import {
  generateChatCompletion,
  type LlmToolDefinition,
} from "../llm/chat-completions.ts";
import { getLlmProvider } from "../llm/registry.ts";
import { convertWithPandocWasm } from "../pandoc.ts";
import {
  type CamoufoxBrowser,
  type CamoufoxPageFetchResult,
} from "../utils/camoufox-browser.ts";
import { errorForLog, logToStdout, messageFromUnknown } from "../utils/logging.ts";

export type TrussWebToolName =
  | "convert_webpage_html_to_markdown"
  | "get_website_screenshot"
  | "load_webpage"
  | "sanitize_webpage_markdown"
  | "web_search";

export interface ToolExecutionModel {
  apiKey?: string;
  modelId: string;
  parameters: LlmGenerationParameters;
  provider: LlmProviderSummary;
}

export interface ToolExecutionModelReference {
  modelId: string;
  parameters: LlmGenerationParameters;
  providerId: string;
}

export interface TrussWebToolCall {
  arguments: Record<string, unknown>;
  id?: string;
  name: string;
}

export interface TrussWebToolRuntime {
  getBrowser(): CamoufoxBrowser | null;
  getLlmProviders(): LlmProviderSummary[];
  getModelProfile(profileId: LlmModelProfileId): TrussWebToolModelProfile | null;
  getSecretEnv(): NodeJS.ProcessEnv;
  getTrussHomeDir?(): string;
  log?(channel: string, message: string, metadata?: Record<string, unknown>): void;
}

export interface TrussToolProgress {
  message?: string;
  percent: number;
}

export interface TrussWebToolModelProfile {
  modelId: string;
  parameters: LlmGenerationParameters;
  providerId: string;
}

interface SearchResult {
  description: string;
  source: string;
  title: string;
  url: string;
}

interface LoadWebpageOptions {
  maxWords: number;
}

interface WebpageFetchResult {
  content: string;
  contentType: string;
  note?: string;
  status: number;
  statusText: string;
}

type WebpageContentFormat = "html" | "json" | "markdown" | "text" | "xml";

interface WebpageContentClip {
  clipped: boolean;
  content: string;
  fullCharacters: number;
  fullWords: number;
  maxWords: number;
  returnedCharacters: number;
  returnedWords: number;
}

interface WebpageProcessingStatus {
  error?: string | null;
  reason?: string | null;
  status: "completed" | "failed" | "fallback" | "skipped";
}

interface HtmlConversionInput {
  clipped: boolean;
  content: string;
  fullBytes: number;
  returnedBytes: number;
}

const searchResultLimit = 5;
const maxSearchQueryLength = 500;
const maxWebpageUrlLength = 2_000;
const maxWebpageBatchSize = 5;
const maxFetchBytes = 3 * 1024 * 1024;
const maxPandocHtmlBytes = 256 * 1024;
const maxRawMarkdownLength = 60_000;
const maxWebpageProcessingInputLength = 1_000_000;
const maxOptionalWebpageTitleLength = 500;
const defaultMaxWebpageWords = 10_000;
const maxWebpageWordsLimit = 100_000;
const maxScreenshotWidth = 1024;
const maxScreenshotHeight = 1920;
const minScreenshotDimension = 1;
const defaultScreenshotWidth = 1024;
const defaultScreenshotHeight = 1920;
const defaultScreenshotQuality = 80;
const duckDuckGoHtmlEndpoint = "https://html.duckduckgo.com/html/";

export const trussWebToolDefinitions: Record<TrussWebToolName, LlmToolDefinition> = {
  get_website_screenshot: {
    name: "get_website_screenshot",
    description:
      "Capture one HTTP or HTTPS webpage screenshot through the Truss Web Tools Camoufox browser. Use when visual rendering, layout, or image state matters more than page text. Returns TOON with image metadata and base64 image data. Viewport width caps at 1024 and height caps at 1920.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: {
          type: "string",
          description: "HTTP or HTTPS webpage URL to screenshot. Caps at 2000 characters.",
          maxLength: maxWebpageUrlLength,
        },
        width: {
          type: "integer",
          description: "Screenshot viewport width. Defaults to 1024 and cannot exceed 1024.",
          maximum: maxScreenshotWidth,
          minimum: minScreenshotDimension,
        },
        height: {
          type: "integer",
          description: "Screenshot viewport height. Defaults to 1920 and cannot exceed 1920.",
          maximum: maxScreenshotHeight,
          minimum: minScreenshotDimension,
        },
        format: {
          type: "string",
          description: "Image format. Defaults to jpeg.",
          enum: ["jpeg", "png"],
        },
        quality: {
          type: "integer",
          description: "JPEG quality from 1 to 100. Ignored for PNG. Defaults to 80.",
          maximum: 100,
          minimum: 1,
        },
      },
      required: ["url"],
    },
  },
  web_search: {
    name: "web_search",
    description:
      "Search the public web through the Truss Web Tools Camoufox browser. Use for current or external information when a URL is not already known. Returns up to five results with title, URL, source, and snippet.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description: "Non-empty search query. Caps at 500 characters.",
          maxLength: maxSearchQueryLength,
        },
      },
      required: ["query"],
    },
  },
  load_webpage: {
    name: "load_webpage",
    description:
      "Load one HTTP or HTTPS webpage, or a batch of up to five webpages, through the Truss Web Tools Camoufox browser. Use when the URL is known or after web_search returns a relevant URL. Returns fetched HTML, JSON, XML, or plain text without Markdown conversion or LLM sanitization; HTML output strips script, style, meta, and link tags before returning content. Use convert_webpage_html_to_markdown and sanitize_webpage_markdown as explicit follow-up steps. Page loading is capped by the browser fetch timeout, responses over 3 MiB are rejected, and returned content is clipped by max-words.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: {
          anyOf: [
            {
              type: "string",
              maxLength: maxWebpageUrlLength,
            },
            {
              type: "array",
              items: {
                type: "string",
                maxLength: maxWebpageUrlLength,
              },
              maxItems: maxWebpageBatchSize,
              minItems: 1,
            },
          ],
          description:
            "Preferred URL input. Provide either url or urls, not both. Accepts one HTTP or HTTPS URL string, or an array of one to five HTTP or HTTPS URL strings. Each URL caps at 2000 characters.",
        },
        urls: {
          type: "array",
          items: {
            type: "string",
            maxLength: maxWebpageUrlLength,
          },
          description:
            "Alias for passing one to five HTTP or HTTPS webpage URLs to load. Use only when url is omitted. Each URL caps at 2000 characters.",
          maxItems: maxWebpageBatchSize,
          minItems: 1,
        },
        "max-words": {
          type: "integer",
          description:
            "Maximum number of words to return in the page content. Defaults to 10000 and caps at 100000.",
          maximum: maxWebpageWordsLimit,
          minimum: 1,
        },
      },
      required: [],
    },
  },
  convert_webpage_html_to_markdown: {
    name: "convert_webpage_html_to_markdown",
    description:
      "Convert fetched webpage HTML to Markdown with Pandoc. Use after load_webpage returns HTML and you need readable article or page text. This tool does not call an LLM and does not sanitize boilerplate beyond local HTML cleanup; call sanitize_webpage_markdown separately if cleaner main content is needed. HTML input caps at 1000000 characters, HTML sent to Pandoc is clipped at 256 KiB, and returned content is clipped by max-words.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        html: {
          type: "string",
          description:
            "Fetched HTML content to convert. Pass the content_html value from load_webpage. Caps at 1000000 characters.",
          maxLength: maxWebpageProcessingInputLength,
        },
        url: {
          type: "string",
          description:
            "Optional source webpage URL for result metadata and logging. Must be HTTP or HTTPS when provided. Caps at 2000 characters.",
          maxLength: maxWebpageUrlLength,
        },
        title: {
          type: "string",
          description:
            "Optional webpage title for result metadata. Caps at 500 characters.",
          maxLength: maxOptionalWebpageTitleLength,
        },
        "max-words": {
          type: "integer",
          description:
            "Maximum number of words to return in the converted content. Defaults to 10000 and caps at 100000.",
          maximum: maxWebpageWordsLimit,
          minimum: 1,
        },
      },
      required: ["html"],
    },
  },
  sanitize_webpage_markdown: {
    name: "sanitize_webpage_markdown",
    description:
      "Sanitize webpage Markdown or cleaned HTML with the configured helper model. Use after convert_webpage_html_to_markdown, or directly on cleaned HTML when conversion fell back. Removes ads, navigation, cookie notices, footers, related links, and other boilerplate while keeping main content. Content input caps at 1000000 characters, the sanitizer prompt clips input at 60000 characters, and returned Markdown is clipped by max-words.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        content: {
          type: "string",
          description:
            "Markdown or cleaned HTML to sanitize. Pass content_markdown from convert_webpage_html_to_markdown, or content_html when conversion returned fallback HTML. Caps at 1000000 characters.",
          maxLength: maxWebpageProcessingInputLength,
        },
        "content-format": {
          type: "string",
          description:
            "Format of content. Defaults to markdown. Use html only for cleaned HTML fallback input.",
          enum: ["markdown", "html"],
        },
        url: {
          type: "string",
          description:
            "Optional source webpage URL for sanitizer context and result metadata. Must be HTTP or HTTPS when provided. Caps at 2000 characters.",
          maxLength: maxWebpageUrlLength,
        },
        title: {
          type: "string",
          description:
            "Optional webpage title for sanitizer context and result metadata. Caps at 500 characters.",
          maxLength: maxOptionalWebpageTitleLength,
        },
        "max-words": {
          type: "integer",
          description:
            "Maximum number of words to return in the sanitized Markdown. Defaults to 10000 and caps at 100000.",
          maximum: maxWebpageWordsLimit,
          minimum: 1,
        },
      },
      required: ["content"],
    },
  },
};

export function trussWebToolList(): LlmToolDefinition[] {
  return [
    trussWebToolDefinitions.web_search,
    trussWebToolDefinitions.load_webpage,
    trussWebToolDefinitions.convert_webpage_html_to_markdown,
    trussWebToolDefinitions.sanitize_webpage_markdown,
    trussWebToolDefinitions.get_website_screenshot,
  ];
}

export function trussWebToolNameForName(name: string): TrussWebToolName | null {
  return name === "web_search" ||
    name === "load_webpage" ||
    name === "convert_webpage_html_to_markdown" ||
    name === "sanitize_webpage_markdown" ||
    name === "get_website_screenshot"
    ? name
    : null;
}

export function trussWebToolTitle(toolName: string, args: Record<string, unknown>): string {
  if (toolName === "web_search") {
    const query = typeof args.query === "string" ? args.query.trim() : "";

    return query ? `Web search: ${truncateOneLine(query, 80)}` : "Web search";
  }

  if (toolName === "load_webpage") {
    const url =
      typeof args.url === "string"
        ? args.url.trim()
        : Array.isArray(args.url) && typeof args.url[0] === "string"
          ? args.url[0].trim()
          : Array.isArray(args.urls) && typeof args.urls[0] === "string"
            ? args.urls[0].trim()
            : "";

    return url ? `Load webpage: ${truncateOneLine(url, 80)}` : "Load webpage";
  }

  if (toolName === "convert_webpage_html_to_markdown") {
    const url = typeof args.url === "string" ? args.url.trim() : "";

    return url
      ? `Convert webpage HTML: ${truncateOneLine(url, 80)}`
      : "Convert webpage HTML to Markdown";
  }

  if (toolName === "sanitize_webpage_markdown") {
    const url = typeof args.url === "string" ? args.url.trim() : "";

    return url
      ? `Sanitize webpage Markdown: ${truncateOneLine(url, 80)}`
      : "Sanitize webpage Markdown";
  }

  if (toolName === "get_website_screenshot") {
    const url = typeof args.url === "string" ? args.url.trim() : "";

    return url ? `Website screenshot: ${truncateOneLine(url, 80)}` : "Website screenshot";
  }

  return toolName;
}

export function resolveToolExecutionModel(
  runtime: TrussWebToolRuntime,
  reference: ToolExecutionModelReference | null | undefined,
): ToolExecutionModel | null {
  if (!reference) {
    return null;
  }

  return resolveModel({
    runtime,
    modelId: reference.modelId,
    parameters: reference.parameters,
    providerId: reference.providerId,
  });
}

export async function executeTrussWebTool({
  fallbackModel,
  onProgress,
  runtime,
  signal,
  settings,
  toolCall,
}: {
  fallbackModel?: ToolExecutionModel | null;
  onProgress?: (progress: TrussToolProgress) => void;
  runtime: TrussWebToolRuntime;
  signal?: AbortSignal;
  settings: Pick<ChatToolSettings, "sanitizerModelId" | "sanitizerProviderId">;
  toolCall: TrussWebToolCall;
}): Promise<string> {
  const toolName = trussWebToolNameForName(toolCall.name);

  if (!toolName) {
    throw new Error(`Unknown Truss web tool: ${toolCall.name}`);
  }

  if (toolName === "web_search") {
    return webSearch({
      args: toolCall.arguments,
      runtime,
      signal,
    });
  }

  if (toolName === "get_website_screenshot") {
    return getWebsiteScreenshot({
      args: toolCall.arguments,
      runtime,
      signal,
    });
  }

  if (toolName === "convert_webpage_html_to_markdown") {
    return convertWebpageHtmlToMarkdownTool({
      args: toolCall.arguments,
      onProgress,
      runtime,
    });
  }

  if (toolName === "sanitize_webpage_markdown") {
    return sanitizeWebpageMarkdownTool({
      args: toolCall.arguments,
      fallbackModel,
      onProgress,
      runtime,
      signal,
      settings,
    });
  }

  return loadWebpage({
    args: toolCall.arguments,
    onProgress,
    runtime,
    signal,
  });
}

async function webSearch({
  args,
  runtime,
  signal,
}: {
  args: Record<string, unknown>;
  runtime: TrussWebToolRuntime;
  signal?: AbortSignal;
}): Promise<string> {
  const query = requiredStringArg(args, "query", maxSearchQueryLength, "web_search");

  try {
    return searchResultsToToon(await searchDuckDuckGo(query, runtime, signal));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    throw new Error(`DuckDuckGo search failed: ${message}`);
  }
}

async function searchDuckDuckGo(
  query: string,
  runtime: TrussWebToolRuntime,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const url = new URL(duckDuckGoHtmlEndpoint);
  url.searchParams.set("q", query);

  return parseDuckDuckGoResults((await fetchWebpageContent(url, runtime, signal)).content);
}

async function getWebsiteScreenshot({
  args,
  runtime,
  signal,
}: {
  args: Record<string, unknown>;
  runtime: TrussWebToolRuntime;
  signal?: AbortSignal;
}): Promise<string> {
  const rawUrl = requiredStringArg(
    args,
    "url",
    maxWebpageUrlLength,
    "get_website_screenshot",
  );
  const url = normalizeWebpageUrl(rawUrl, "get_website_screenshot");
  const width = optionalIntegerArgInRange({
    args,
    defaultValue: defaultScreenshotWidth,
    displayName: "width",
    keys: ["width"],
    max: maxScreenshotWidth,
    min: minScreenshotDimension,
    toolName: "get_website_screenshot",
  });
  const height = optionalIntegerArgInRange({
    args,
    defaultValue: defaultScreenshotHeight,
    displayName: "height",
    keys: ["height"],
    max: maxScreenshotHeight,
    min: minScreenshotDimension,
    toolName: "get_website_screenshot",
  });
  const quality = optionalIntegerArgInRange({
    args,
    defaultValue: defaultScreenshotQuality,
    displayName: "quality",
    keys: ["quality"],
    max: 100,
    min: 1,
    toolName: "get_website_screenshot",
  });
  const format = optionalStringEnumArg({
    args,
    defaultValue: "jpeg",
    displayName: "format",
    keys: ["format"],
    toolName: "get_website_screenshot",
    values: ["jpeg", "png"] as const,
  });
  const screenshot = await requireBrowser(runtime).screenshotPage(url, {
    format,
    height,
    quality,
    signal,
    width,
  });

  assertSuccessfulBrowserResponse("screenshot website", url, screenshot);

  return websiteScreenshotToToon({
    base64: Buffer.from(screenshot.data).toString("base64"),
    contentType: screenshot.contentType,
    height: screenshot.height,
    note: screenshot.note,
    status: screenshot.status,
    title: screenshot.title,
    url,
    width: screenshot.width,
  });
}

async function loadWebpage({
  args,
  onProgress,
  runtime,
  signal,
}: {
  args: Record<string, unknown>;
  onProgress?: (progress: TrussToolProgress) => void;
  runtime: TrussWebToolRuntime;
  signal?: AbortSignal;
}): Promise<string> {
  const urls = loadWebpageUrls(args);
  const options = loadWebpageOptions(args);

  if (urls.length > 1) {
    const batchProgress = batchLoadWebpageProgressReporter(urls.length, onProgress);
    const pages = await Promise.all(
      urls.map((url, index) =>
        loadSingleWebpage({
          onProgress: batchProgress
            ? (progress) => batchProgress(index, progress)
            : undefined,
          options,
          runtime,
          signal,
          url,
        }).catch((caught) => {
          batchProgress?.(index, {
            message: "Page failed.",
            percent: 100,
          });
          return webpageErrorToToon(url, caught);
        }),
      ),
    );

    return [`webpages[${pages.length}]:`, ...pages.map((page) => indentBlock(page, 2))].join("\n");
  }

  return loadSingleWebpage({
    onProgress,
    options,
    runtime,
    signal,
    url: urls[0]!,
  });
}

async function convertWebpageHtmlToMarkdownTool({
  args,
  onProgress,
  runtime,
}: {
  args: Record<string, unknown>;
  onProgress?: (progress: TrussToolProgress) => void;
  runtime: TrussWebToolRuntime;
}): Promise<string> {
  onProgress?.({
    message: "Converting page to text...",
    percent: 0,
  });

  const html = requiredStringArg(
    args,
    "html",
    maxWebpageProcessingInputLength,
    "convert_webpage_html_to_markdown",
  );
  const url = optionalWebpageUrlArg(args, "convert_webpage_html_to_markdown");
  const title = optionalStringArg(
    args,
    ["title"],
    maxOptionalWebpageTitleLength,
    "convert_webpage_html_to_markdown",
    "title",
  );
  const maxWords = optionalIntegerArg(
    args,
    ["max-words", "max_words", "maxWords", "max words"],
    defaultMaxWebpageWords,
    "convert_webpage_html_to_markdown",
    "max-words",
  );
  const conversion = await convertHtmlToMarkdownWithFallback({
    html,
    runtime,
    title,
    url,
  });
  const contentFormat: Extract<WebpageContentFormat, "html" | "markdown"> = conversion.error
    ? "html"
    : "markdown";
  const content = normalizeMarkdown(conversion.markdown);
  const clipped = clipContentToMaxWords(content, maxWords);

  log(runtime, "tools", "Markdown conversion completed", {
    status: conversion.error ? "fallback" : "completed",
    length: content.length,
    error: conversion.error,
    ...(url ? { url: url.href } : {}),
  });

  onProgress?.({
    message: conversion.error ? "Page conversion fell back to cleaned HTML." : "Page converted to text.",
    percent: 100,
  });

  return webpageConversionToToon({
    content: clipped.content,
    contentField: contentFieldForFormat(contentFormat),
    contentFormat,
    contentSize: clipped,
    conversion: conversion.error
      ? {
          error: conversion.error,
          ...(conversion.inputClipped ? { reason: "html_input_clipped_to_256_kib" } : {}),
          status: "fallback",
        }
      : {
          ...(conversion.inputClipped ? { reason: "html_input_clipped_to_256_kib" } : {}),
          status: "completed",
        },
    title,
    url,
  });
}

async function sanitizeWebpageMarkdownTool({
  args,
  fallbackModel,
  onProgress,
  runtime,
  signal,
  settings,
}: {
  args: Record<string, unknown>;
  fallbackModel?: ToolExecutionModel | null;
  onProgress?: (progress: TrussToolProgress) => void;
  runtime: TrussWebToolRuntime;
  signal?: AbortSignal;
  settings: Pick<ChatToolSettings, "sanitizerModelId" | "sanitizerProviderId">;
}): Promise<string> {
  onProgress?.({
    message: "Sanitizing page...",
    percent: 0,
  });

  const content = requiredStringArg(
    args,
    "content",
    maxWebpageProcessingInputLength,
    "sanitize_webpage_markdown",
  );
  const contentFormat = optionalStringEnumArg({
    args,
    defaultValue: "markdown",
    displayName: "content-format",
    keys: ["content-format", "content_format", "contentFormat"],
    toolName: "sanitize_webpage_markdown",
    values: ["markdown", "html"] as const,
  });
  const url = optionalWebpageUrlArg(args, "sanitize_webpage_markdown");
  const title = optionalStringArg(
    args,
    ["title"],
    maxOptionalWebpageTitleLength,
    "sanitize_webpage_markdown",
    "title",
  );
  const maxWords = optionalIntegerArg(
    args,
    ["max-words", "max_words", "maxWords", "max words"],
    defaultMaxWebpageWords,
    "sanitize_webpage_markdown",
    "max-words",
  );

  log(runtime, "tools", `Sanitizing webpage ${contentFormat} (${formatBytes(content.length)})`, {
    ...(url ? { url: url.href } : {}),
    title,
  });

  const result = await sanitizeWebpageMarkdownWithFallback({
    fallbackModel,
    markdown: content,
    runtime,
    signal,
    settings,
    title,
    url,
  });
  const normalized = normalizeMarkdown(result.content);
  const clipped = clipContentToMaxWords(normalized, maxWords);

  log(runtime, "tools", "Sanitization completed", {
    status: result.sanitizerError ? "failed" : "completed",
    length: normalized.length,
    error: result.sanitizerError,
    ...(url ? { url: url.href } : {}),
  });

  onProgress?.({
    message: result.sanitizerError ? "Page ready without sanitizing." : "Page sanitized.",
    percent: 100,
  });

  return sanitizedWebpageToToon({
    content: clipped.content,
    contentFormat,
    contentSize: clipped,
    sanitizer: result.sanitizerError
      ? {
          error: result.sanitizerError,
          status: "failed",
        }
      : {
          status: "completed",
        },
    title,
    url,
  });
}

async function loadSingleWebpage({
  onProgress,
  options,
  runtime,
  signal,
  url,
}: {
  onProgress?: (progress: TrussToolProgress) => void;
  options: LoadWebpageOptions;
  runtime: TrussWebToolRuntime;
  signal?: AbortSignal;
  url: URL;
}): Promise<string> {
  onProgress?.({
    message: "Fetching page...",
    percent: 0,
  });

  const response = await fetchWebpageContent(url, runtime, signal);
  log(runtime, "tools", `Fetched webpage response for ${url.href} (${formatBytes(response.content.length)})`, {
    contentType: response.contentType || "unknown",
    status: response.status,
  });

  const isJson = isJsonResponse(response.content, response.contentType);
  const title = isJson ? null : extractHtmlTitle(response.content);

  onProgress?.({
    message: "Page fetched.",
    percent: 80,
  });

  if (isJson) {
    const clipped = clipContentToMaxWords(normalizeJsonContent(response.content), options.maxWords);

    onProgress?.({
      message: "Page ready.",
      percent: 100,
    });

    return webpageToToon({
      content: clipped.content,
      contentField: "content_json",
      contentFormat: "json",
      contentSize: clipped,
      contentType: response.contentType,
      conversion: {
        reason: "json_response",
        status: "skipped",
      },
      note: response.note,
      sanitizer: {
        reason: "separate_tool",
        status: "skipped",
      },
      title,
      url,
    });
  }

  const contentFormat = rawContentFormatForContentType(response.contentType);
  const rawContent =
    contentFormat === "html" ? stripHtmlForWebpageResult(response.content) : response.content;
  const clipped = clipContentToMaxWords(normalizePlainText(rawContent), options.maxWords);

  onProgress?.({
    message: "Page ready.",
    percent: 100,
  });

  return webpageToToon({
    content: clipped.content,
    contentField: contentFieldForFormat(contentFormat),
    contentFormat,
    contentSize: clipped,
    contentType: response.contentType,
    conversion: {
      reason: "separate_tool",
      status: "skipped",
    },
    note: response.note,
    sanitizer: {
      reason: "separate_tool",
      status: "skipped",
    },
    title,
    url,
  });
}

function batchLoadWebpageProgressReporter(
  pageCount: number,
  onProgress: ((progress: TrussToolProgress) => void) | undefined,
): ((pageIndex: number, progress: TrussToolProgress) => void) | undefined {
  if (!onProgress) {
    return undefined;
  }

  const pageProgress = Array.from({ length: pageCount }, () => 0);
  let lastPercent = 0;

  return (pageIndex, progress) => {
    pageProgress[pageIndex] = Math.max(pageProgress[pageIndex] ?? 0, progress.percent);

    const averagePercent = Math.round(
      pageProgress.reduce((total, percent) => total + percent, 0) / pageProgress.length,
    );
    const percent = Math.max(lastPercent, averagePercent);
    lastPercent = percent;

    onProgress({
      ...(progress.message
        ? { message: `${progress.message} (${pageIndex + 1}/${pageCount})` }
        : {}),
      percent,
    });
  };
}

async function fetchWebpageContent(
  url: URL,
  runtime: TrussWebToolRuntime,
  signal?: AbortSignal,
): Promise<WebpageFetchResult> {
  throwIfAborted(signal);

  const response = await requireBrowser(runtime).fetchPage(url, { signal });

  assertSuccessfulBrowserResponse("load webpage", url, response);
  assertSupportedWebpageContentType(url, response.contentType);
  assertWebpageSizeWithinLimit(url, response);

  return {
    content: response.content,
    contentType: response.contentType,
    note: response.note,
    status: response.status,
    statusText: response.statusText,
  };
}

function requireBrowser(runtime: TrussWebToolRuntime): CamoufoxBrowser {
  const browser = runtime.getBrowser();

  if (!browser) {
    throw new Error("Truss Web Tools browser is not connected.");
  }

  return browser;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Truss Web Tools request was stopped.");
  }
}

function assertSuccessfulBrowserResponse(
  action: string,
  url: URL,
  response: Pick<CamoufoxPageFetchResult, "contentType" | "status" | "statusText">,
): void {
  if (response.status >= 200 && response.status < 300) {
    return;
  }

  throw new Error(
    [
      `Could not ${action} ${url.href}: HTTP ${response.status} ${response.statusText || "Unknown status"}.`,
      response.contentType ? `Content-Type: ${response.contentType}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function assertSupportedWebpageContentType(url: URL, contentType: string): void {
  if (!contentType || isSupportedWebpageContentType(contentType)) {
    return;
  }

  throw new Error(
    `Could not load webpage ${url.href}: response content type ${contentType} is not supported. load_webpage can only read HTML, XHTML, XML, JSON, or plain-text pages.`,
  );
}

function assertWebpageSizeWithinLimit(url: URL, response: CamoufoxPageFetchResult): void {
  const contentLength = Number.parseInt(response.headers["content-length"] ?? "", 10);

  if (Number.isFinite(contentLength) && contentLength > maxFetchBytes) {
    throw new Error(
      `Webpage ${url.href} is too large to load: content-length ${formatBytes(contentLength)} exceeds the ${formatBytes(maxFetchBytes)} limit.`,
    );
  }

  const byteLength = new TextEncoder().encode(response.content).byteLength;

  if (byteLength > maxFetchBytes) {
    throw new Error(
      `Webpage ${url.href} is too large to load: downloaded ${formatBytes(byteLength)} exceeds the ${formatBytes(maxFetchBytes)} limit.`,
    );
  }
}

function webpageErrorToToon(url: URL, caught: unknown): string {
  return [
    "webpage:",
    `  url: ${toonScalar(url.href)}`,
    "  status: failed",
    `  error: ${toonScalar(truncateOneLine(messageFromUnknown(caught), 280))}`,
  ].join("\n");
}

async function convertHtmlToMarkdown(input: HtmlConversionInput): Promise<string> {
  const sizeSummary = input.clipped
    ? `${formatBytes(input.returnedBytes)} of ${formatBytes(input.fullBytes)}; clipped at ${formatBytes(maxPandocHtmlBytes)}`
    : formatBytes(input.fullBytes);
  logToStdout("pandoc", `Converting HTML to commonmark (${sizeSummary})`);
  const result = await convertWithPandocWasm(
    {
      from: "html",
      "markdown-headings": "atx",
      to: "commonmark",
      wrap: "none",
    },
    input.content,
    {},
  );

  if (result.stderr.trim()) {
    logToStdout("pandoc", `Pandoc stderr: ${result.stderr.trim()}`);
    throw new Error(`Pandoc could not convert webpage HTML: ${result.stderr.trim()}`);
  }

  logToStdout("pandoc", `Pandoc conversion successful (${formatBytes(result.stdout.length)})`);
  return result.stdout;
}

async function convertHtmlToMarkdownWithFallback({
  html,
  runtime,
  title,
  url,
}: {
  html: string;
  runtime: TrussWebToolRuntime;
  title: string | null;
  url: URL | null;
}): Promise<{ markdown: string; error: string | null; inputClipped: boolean }> {
  const input = clipHtmlForMarkdownConversion(html);

  try {
    const markdown = await convertHtmlToMarkdown(input);

    if (!normalizeMarkdown(markdown)) {
      throw new Error("Pandoc produced empty Markdown.");
    }

    return {
      inputClipped: input.clipped,
      markdown,
      error: null,
    };
  } catch (caught) {
    log(runtime, "tools", "Pandoc webpage conversion failed; using cleaned HTML for sanitization.", {
      error: errorForLog(caught),
      title,
      ...(url ? { url: url.href } : {}),
    });

    return {
      inputClipped: input.clipped,
      markdown: input.content,
      error: messageFromUnknown(caught),
    };
  }
}

function clipHtmlForMarkdownConversion(html: string): HtmlConversionInput {
  const htmlForConversion = prepareHtmlForMarkdownConversion(html);
  const encoder = new TextEncoder();
  const fullBytes = encoder.encode(htmlForConversion).byteLength;

  if (fullBytes <= maxPandocHtmlBytes) {
    return {
      clipped: false,
      content: htmlForConversion,
      fullBytes,
      returnedBytes: fullBytes,
    };
  }

  let low = 0;
  let high = htmlForConversion.length;

  while (low < high) {
    const midpoint = Math.floor((low + high + 1) / 2);
    const byteLength = encoder.encode(htmlForConversion.slice(0, midpoint)).byteLength;

    if (byteLength <= maxPandocHtmlBytes) {
      low = midpoint;
    } else {
      high = midpoint - 1;
    }
  }

  let content = htmlForConversion.slice(0, low);
  if (/[\uD800-\uDBFF]$/.test(content)) {
    content = content.slice(0, -1);
  }

  return {
    clipped: true,
    content,
    fullBytes,
    returnedBytes: encoder.encode(content).byteLength,
  };
}

function prepareHtmlForMarkdownConversion(html: string): string {
  const body = extractHtmlBody(html);
  const content = stripHtmlConversionBoilerplate(body ?? html);

  return body === null ? content : `<!doctype html><html><body>${content}</body></html>`;
}

function extractHtmlBody(html: string): string | null {
  const bodyOpenMatch = /<body\b[^>]*>/i.exec(html);

  if (!bodyOpenMatch) {
    return null;
  }

  const bodyStart = bodyOpenMatch.index + bodyOpenMatch[0].length;
  const bodyEndMatch = /<\/body>/i.exec(html.slice(bodyStart));
  const bodyEnd = bodyEndMatch ? bodyStart + bodyEndMatch.index : html.length;

  return html.slice(bodyStart, bodyEnd);
}

function stripHtmlConversionBoilerplate(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "\n")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "\n")
    .replace(/<template\b[\s\S]*?<\/template>/gi, "\n");
}

function stripHtmlForWebpageResult(html: string): string {
  return stripHtmlConversionBoilerplate(html)
    .replace(/<meta\b[^>]*>/gi, "\n")
    .replace(/<link\b[^>]*>/gi, "\n");
}

async function sanitizeWebpageMarkdown({
  fallbackModel,
  markdown,
  runtime,
  signal,
  settings,
  title,
  url,
}: {
  fallbackModel?: ToolExecutionModel | null;
  markdown: string;
  runtime: TrussWebToolRuntime;
  signal?: AbortSignal;
  settings: Pick<ChatToolSettings, "sanitizerModelId" | "sanitizerProviderId">;
  title: string | null;
  url: URL | null;
}): Promise<string> {
  throwIfAborted(signal);

  const sanitizer = resolveSanitizerModel({
    fallbackModel,
    runtime,
    settings,
  });

  const output = await generateChatCompletion({
    apiKey: sanitizer.apiKey,
    messages: [
      {
        role: "system",
        content:
          "You sanitize webpage Markdown or cleaned HTML. Remove ads, cookie notices, navigation, footers, newsletter prompts, related-link blocks, and other boilerplate. Keep the main article or page content, useful headings, links, tables, lists, and code blocks. When the input is HTML, extract the useful content and convert it to Markdown. Return only sanitized Markdown.",
      },
      {
        role: "user",
        content: [
          url ? `URL: ${url.href}` : "",
          title ? `Title: ${title}` : "",
          "",
          truncateMultiline(markdown, maxRawMarkdownLength),
        ].join("\n"),
      },
    ],
    modelId: sanitizer.modelId,
    parameters: sanitizer.parameters,
    provider: sanitizer.provider,
    signal,
  });

  log(runtime, "tools", `Sanitizer LLM returned ${formatBytes(output.length)} of content`);

  return normalizeMarkdown(output);
}

async function sanitizeWebpageMarkdownWithFallback({
  fallbackModel,
  markdown,
  runtime,
  signal,
  settings,
  title,
  url,
}: {
  fallbackModel?: ToolExecutionModel | null;
  markdown: string;
  runtime: TrussWebToolRuntime;
  signal?: AbortSignal;
  settings: Pick<ChatToolSettings, "sanitizerModelId" | "sanitizerProviderId">;
  title: string | null;
  url: URL | null;
}): Promise<{ content: string; sanitizerError: string | null }> {
  try {
    const sanitized = await sanitizeWebpageMarkdown({
      fallbackModel,
      markdown,
      runtime,
      signal,
      settings,
      title,
      url,
    });

    return {
      content: sanitized || markdown,
      sanitizerError: null,
    };
  } catch (caught) {
    if (signal?.aborted) {
      throw caught;
    }

    log(runtime, "tools", "Webpage sanitizer failed; returning converted Markdown.", {
      error: errorForLog(caught),
      title,
      ...(url ? { url: url.href } : {}),
    });

    return {
      content: markdown,
      sanitizerError: messageFromUnknown(caught),
    };
  }
}

function resolveSanitizerModel({
  fallbackModel,
  runtime,
  settings,
}: {
  fallbackModel?: ToolExecutionModel | null;
  runtime: TrussWebToolRuntime;
  settings: Pick<ChatToolSettings, "sanitizerModelId" | "sanitizerProviderId">;
}): ToolExecutionModel {
  const helperProfile = runtime.getModelProfile("fast-helper");
  const parameters = helperProfile?.parameters ?? fallbackModel?.parameters;

  if (settings.sanitizerProviderId && settings.sanitizerModelId && parameters) {
    return resolveModel({
      runtime,
      modelId: settings.sanitizerModelId,
      parameters,
      providerId: settings.sanitizerProviderId,
    });
  }

  if (helperProfile) {
    try {
      return resolveModel({
        runtime,
        modelId: helperProfile.modelId,
        parameters: helperProfile.parameters,
        providerId: helperProfile.providerId,
      });
    } catch {
      if (fallbackModel) {
        return fallbackModel;
      }

      throw new Error("The Fast helper model profile is not available for webpage sanitizing.");
    }
  }

  if (fallbackModel) {
    return fallbackModel;
  }

  throw new Error("No webpage sanitizer model is configured.");
}

function resolveModel({
  runtime,
  modelId,
  parameters,
  providerId,
}: {
  runtime: TrussWebToolRuntime;
  modelId: string;
  parameters: LlmGenerationParameters;
  providerId: string;
}): ToolExecutionModel {
  const provider = runtime.getLlmProviders().find((item) => item.id === providerId);

  if (!provider) {
    throw new Error("Selected webpage sanitizer provider is not available.");
  }

  if (!provider.enabled || !provider.configured) {
    throw new Error(`${provider.label} is not enabled or configured for webpage sanitizing.`);
  }

  const providerDefinition = getLlmProvider(provider.id);

  if (!providerDefinition) {
    throw new Error("Selected webpage sanitizer provider is unknown.");
  }

  const env = runtime.getSecretEnv();
  const apiKey = providerDefinition.credentialEnvVars
    .map((envVar) => env[envVar])
    .find((value): value is string => Boolean(value));

  return {
    apiKey,
    modelId,
    parameters,
    provider,
  };
}

function parseDuckDuckGoResults(html: string): SearchResult[] {
  const seen = new Set<string>();
  const results: SearchResult[] = [];

  for (const block of duckDuckGoResultBlocks(html)) {
    const resultLink = /<a\b(?=[^>]*\bclass=(["'])[^"']*\bresult__a\b[^"']*\1)([^>]*)>([\s\S]*?)<\/a>/i.exec(block);
    const href = resultLink ? htmlAttributeValue(resultLink[2] ?? "", "href") : null;
    const url = normalizeDuckDuckGoResultUrl(href);
    const title = cleanHtmlText(resultLink?.[3] ?? "");

    if (!title || !url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    results.push({
      description: extractDuckDuckGoSnippet(block) ?? "No description available",
      source: sourceFromResultUrl(url),
      title,
      url,
    });

    if (results.length >= searchResultLimit) {
      return results;
    }
  }

  return results;
}

function duckDuckGoResultBlocks(html: string): string[] {
  const starts: number[] = [];
  const resultPattern = /<div\b(?=[^>]*\bclass=(["'])[^"']*\bresult\b[^"']*\1)[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = resultPattern.exec(html))) {
    starts.push(match.index);
  }

  return starts.map((start, index) => html.slice(start, starts[index + 1] ?? html.length));
}

function extractDuckDuckGoSnippet(block: string): string | null {
  const snippet = /<(a|div|span)\b(?=[^>]*\bclass=(["'])[^"']*\bresult__snippet\b[^"']*\2)[^>]*>([\s\S]*?)<\/\1>/i.exec(block);
  const text = cleanHtmlText(snippet?.[3] ?? "");

  return text || null;
}

function normalizeDuckDuckGoResultUrl(value: string | null): string | null {
  const rawUrl = value?.trim();

  if (!rawUrl) {
    return null;
  }

  const expandedUrl = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
  let url: URL;

  try {
    url = new URL(expandedUrl, duckDuckGoHtmlEndpoint);
  } catch {
    return null;
  }

  const redirectedUrl = url.searchParams.get("uddg");

  if (redirectedUrl) {
    return normalizeHttpUrl(redirectedUrl);
  }

  return normalizeHttpUrl(url.href);
}

function normalizeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function isSupportedWebpageContentType(value: string): boolean {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";

  return (
    mediaType === "text/html" ||
    mediaType === "application/xhtml+xml" ||
    isJsonMediaType(mediaType) ||
    mediaType === "text/plain" ||
    mediaType === "text/xml" ||
    mediaType === "application/xml" ||
    mediaType.endsWith("+xml")
  );
}

function isJsonResponse(content: string, contentType: string): boolean {
  if (isJsonContentType(contentType)) {
    return true;
  }

  const trimmed = content.trim();

  if (!trimmed || !/^[\[{"]|^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$|^(?:true|false|null)$/u.test(trimmed)) {
    return false;
  }

  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function isJsonContentType(contentType: string): boolean {
  return isJsonMediaType(contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "");
}

function isJsonMediaType(mediaType: string): boolean {
  return mediaType === "application/json" || mediaType === "text/json" || mediaType.endsWith("+json");
}

function sourceFromResultUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function htmlAttributeValue(attrs: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = pattern.exec(attrs);
  const value = match?.[2] ?? match?.[3] ?? match?.[4] ?? "";

  return decodeHtmlEntities(value).trim() || null;
}

function cleanHtmlText(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, entity: string) => {
    const lowerEntity = entity.toLowerCase();

    if (lowerEntity.startsWith("#x")) {
      const codePoint = Number.parseInt(lowerEntity.slice(2), 16);
      return htmlEntityCodePoint(codePoint) ?? match;
    }

    if (lowerEntity.startsWith("#")) {
      const codePoint = Number.parseInt(lowerEntity.slice(1), 10);
      return htmlEntityCodePoint(codePoint) ?? match;
    }

    return namedEntities[lowerEntity] ?? match;
  });
}

function htmlEntityCodePoint(codePoint: number): string | null {
  if (!Number.isFinite(codePoint)) {
    return null;
  }

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return null;
  }
}

function searchResultsToToon(results: SearchResult[]): string {
  if (results.length === 0) {
    return "search_results[0]: []";
  }

  return [
    `search_results[${results.length}]:`,
    ...results.flatMap((result) => [
      `  - title: ${toonScalar(result.title)}`,
      `    url: ${toonScalar(result.url)}`,
      `    source: ${toonScalar(result.source || result.url)}`,
      `    snippet: ${toonScalar(result.description || "No snippet returned.")}`,
    ]),
  ].join("\n");
}

function webpageToToon({
  content,
  contentField,
  contentFormat,
  contentSize,
  contentType,
  conversion,
  note,
  sanitizer,
  title,
  url,
}: {
  content: string;
  contentField: string;
  contentFormat: WebpageContentFormat;
  contentSize: WebpageContentClip;
  contentType: string;
  conversion: WebpageProcessingStatus;
  note?: string;
  sanitizer: WebpageProcessingStatus;
  title: string | null;
  url: URL;
}): string {
  return [
    "webpage:",
    `  url: ${toonScalar(url.href)}`,
    `  title: ${toonScalar(title ?? "Untitled webpage")}`,
    ...(contentType ? [`  content_type: ${toonScalar(contentType)}`] : []),
    `  content_format: ${contentFormat}`,
    ...(note ? [`  note: ${toonScalar(note)}`] : []),
    "  content_size:",
    `    clipped: ${contentSize.clipped ? "true" : "false"}`,
    `    max_words: ${contentSize.maxWords}`,
    `    returned_words: ${contentSize.returnedWords}`,
    `    full_words: ${contentSize.fullWords}`,
    `    returned_characters: ${contentSize.returnedCharacters}`,
    `    full_characters: ${contentSize.fullCharacters}`,
    ...processingStatusToToon("conversion", conversion),
    ...processingStatusToToon("sanitizer", sanitizer),
    `  ${contentField}: |-`,
    indentBlock(content || "No extractable main content was returned.", 4),
  ].join("\n");
}

function websiteScreenshotToToon({
  base64,
  contentType,
  height,
  note,
  status,
  title,
  url,
  width,
}: {
  base64: string;
  contentType: "image/jpeg" | "image/png";
  height: number;
  note?: string;
  status: number;
  title: string | null;
  url: URL;
  width: number;
}): string {
  return [
    "website_screenshot:",
    `  url: ${toonScalar(url.href)}`,
    `  title: ${toonScalar(title ?? "Untitled webpage")}`,
    `  status: ${status}`,
    `  content_type: ${contentType}`,
    ...(note ? [`  note: ${toonScalar(note)}`] : []),
    `  width: ${width}`,
    `  height: ${height}`,
    `  encoding: base64`,
    `  data_url_prefix: data:${contentType};base64,`,
    "  image_base64: |-",
    indentBlock(wrapBase64(base64), 4),
  ].join("\n");
}

function webpageConversionToToon({
  content,
  contentField,
  contentFormat,
  contentSize,
  conversion,
  title,
  url,
}: {
  content: string;
  contentField: string;
  contentFormat: Extract<WebpageContentFormat, "html" | "markdown">;
  contentSize: WebpageContentClip;
  conversion: WebpageProcessingStatus;
  title: string | null;
  url: URL | null;
}): string {
  return [
    "webpage_markdown_conversion:",
    ...(url ? [`  url: ${toonScalar(url.href)}`] : []),
    ...(title ? [`  title: ${toonScalar(title)}`] : []),
    `  content_format: ${contentFormat}`,
    "  content_size:",
    `    clipped: ${contentSize.clipped ? "true" : "false"}`,
    `    max_words: ${contentSize.maxWords}`,
    `    returned_words: ${contentSize.returnedWords}`,
    `    full_words: ${contentSize.fullWords}`,
    `    returned_characters: ${contentSize.returnedCharacters}`,
    `    full_characters: ${contentSize.fullCharacters}`,
    ...processingStatusToToon("conversion", conversion),
    `  ${contentField}: |-`,
    indentBlock(content || "No extractable content was returned.", 4),
  ].join("\n");
}

function sanitizedWebpageToToon({
  content,
  contentFormat,
  contentSize,
  sanitizer,
  title,
  url,
}: {
  content: string;
  contentFormat: "html" | "markdown";
  contentSize: WebpageContentClip;
  sanitizer: WebpageProcessingStatus;
  title: string | null;
  url: URL | null;
}): string {
  return [
    "webpage_markdown_sanitization:",
    ...(url ? [`  url: ${toonScalar(url.href)}`] : []),
    ...(title ? [`  title: ${toonScalar(title)}`] : []),
    `  input_format: ${contentFormat}`,
    "  content_size:",
    `    clipped: ${contentSize.clipped ? "true" : "false"}`,
    `    max_words: ${contentSize.maxWords}`,
    `    returned_words: ${contentSize.returnedWords}`,
    `    full_words: ${contentSize.fullWords}`,
    `    returned_characters: ${contentSize.returnedCharacters}`,
    `    full_characters: ${contentSize.fullCharacters}`,
    ...processingStatusToToon("sanitizer", sanitizer),
    "  content_markdown: |-",
    indentBlock(content || "No extractable main content was returned.", 4),
  ].join("\n");
}

function processingStatusToToon(
  key: "conversion" | "sanitizer",
  value: WebpageProcessingStatus,
): string[] {
  return [
    `  ${key}:`,
    `    status: ${value.status}`,
    ...(value.reason ? [`    reason: ${toonScalar(value.reason)}`] : []),
    ...(value.error ? [`    error: ${toonScalar(truncateOneLine(value.error, 280))}`] : []),
  ];
}

function normalizeWebpageUrl(value: string, toolName: TrussWebToolName = "load_webpage"): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${toolName} URL must be a valid HTTP or HTTPS URL.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${toolName} URL must use HTTP or HTTPS.`);
  }

  return url;
}

function loadWebpageUrls(args: Record<string, unknown>): URL[] {
  const urlValue = firstKnownArg(args, ["url", "urls"]);

  if (urlValue === undefined) {
    throw new Error("load_webpage url must be a string URL or an array of up to five URL strings.");
  }

  const rawUrls = Array.isArray(urlValue) ? urlValue : [urlValue];

  if (rawUrls.length === 0) {
    throw new Error("load_webpage url must include at least one URL.");
  }

  if (rawUrls.length > maxWebpageBatchSize) {
    throw new Error(`load_webpage can load at most ${maxWebpageBatchSize} URLs at a time.`);
  }

  return rawUrls.map((value, index) => {
    if (typeof value !== "string") {
      throw new Error(`load_webpage url[${index}] must be a string.`);
    }

    const trimmed = value.trim();

    if (!trimmed) {
      throw new Error(`load_webpage url[${index}] must be a non-empty string.`);
    }

    if (trimmed.length > maxWebpageUrlLength) {
      throw new Error(
        `load_webpage url[${index}] is too long: ${trimmed.length} characters exceeds the ${maxWebpageUrlLength} character limit.`,
      );
    }

    return normalizeWebpageUrl(trimmed);
  });
}

function loadWebpageOptions(args: Record<string, unknown>): LoadWebpageOptions {
  return {
    maxWords: optionalIntegerArg(
      args,
      ["max-words", "max_words", "maxWords", "max words"],
      defaultMaxWebpageWords,
      "load_webpage",
      "max-words",
    ),
  };
}

function optionalWebpageUrlArg(args: Record<string, unknown>, toolName: TrussWebToolName): URL | null {
  const rawUrl = optionalStringArg(args, ["url"], maxWebpageUrlLength, toolName, "url");

  return rawUrl ? normalizeWebpageUrl(rawUrl, toolName) : null;
}

function requiredStringArg(
  args: Record<string, unknown>,
  key: string,
  maxLength: number,
  toolName: TrussWebToolName,
): string {
  const value = args[key];

  if (typeof value !== "string") {
    throw new Error(`${toolName} ${key} must be a string.`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`${toolName} ${key} must be a non-empty string.`);
  }

  if (trimmed.length > maxLength) {
    throw new Error(
      `${toolName} ${key} is too long: ${trimmed.length} characters exceeds the ${maxLength} character limit.`,
    );
  }

  return trimmed;
}

function optionalStringArg(
  args: Record<string, unknown>,
  keys: string[],
  maxLength: number,
  toolName: TrussWebToolName,
  displayName: string,
): string | null {
  const value = firstKnownArg(args, keys);

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${toolName} ${displayName} must be a string.`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.length > maxLength) {
    throw new Error(
      `${toolName} ${displayName} is too long: ${trimmed.length} characters exceeds the ${maxLength} character limit.`,
    );
  }

  return trimmed;
}

function optionalIntegerArgInRange({
  args,
  defaultValue,
  displayName,
  keys,
  max,
  min,
  toolName,
}: {
  args: Record<string, unknown>;
  defaultValue: number;
  displayName: string;
  keys: string[];
  max: number;
  min: number;
  toolName: TrussWebToolName;
}): number {
  const value = firstKnownArg(args, keys);

  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${toolName} ${displayName} must be an integer.`);
  }

  if (value < min || value > max) {
    throw new Error(`${toolName} ${displayName} must be between ${min} and ${max}.`);
  }

  return value;
}

function optionalStringEnumArg<const T extends readonly string[]>({
  args,
  defaultValue,
  displayName,
  keys,
  toolName,
  values,
}: {
  args: Record<string, unknown>;
  defaultValue: T[number];
  displayName: string;
  keys: string[];
  toolName: TrussWebToolName;
  values: T;
}): T[number] {
  const value = firstKnownArg(args, keys);

  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "string" || !values.includes(value as T[number])) {
    throw new Error(`${toolName} ${displayName} must be one of: ${values.join(", ")}.`);
  }

  return value;
}

function optionalIntegerArg(
  args: Record<string, unknown>,
  keys: string[],
  fallback: number,
  toolName: TrussWebToolName,
  displayName: string,
): number {
  const value = firstKnownArg(args, keys);

  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${toolName} ${displayName} must be an integer.`);
  }

  if (value < 1 || value > maxWebpageWordsLimit) {
    throw new Error(
      `${toolName} ${displayName} must be between 1 and ${maxWebpageWordsLimit}.`,
    );
  }

  return value;
}

function firstKnownArg(args: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.hasOwn(args, key)) {
      return args[key];
    }
  }

  return undefined;
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KiB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizePlainText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function normalizeJsonContent(value: string): string {
  const trimmed = value.trim();

  try {
    return `${JSON.stringify(JSON.parse(trimmed), null, 2)}\n`;
  } catch {
    return normalizePlainText(value);
  }
}

function rawContentFormatForContentType(contentType: string): WebpageContentFormat {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";

  if (mediaType === "text/html" || mediaType === "application/xhtml+xml") {
    return "html";
  }

  if (
    mediaType === "text/xml" ||
    mediaType === "application/xml" ||
    mediaType.endsWith("+xml")
  ) {
    return "xml";
  }

  return "text";
}

function contentFieldForFormat(format: WebpageContentFormat): string {
  switch (format) {
    case "html":
      return "content_html";
    case "json":
      return "content_json";
    case "markdown":
      return "content_markdown";
    case "xml":
      return "content_xml";
    case "text":
      return "content_text";
  }
}

function clipContentToMaxWords(value: string, maxWords: number): WebpageContentClip {
  const normalized = normalizePlainText(value);
  const wordPattern = /\S+/g;
  let fullWords = 0;
  let endIndex = normalized.length;
  let match: RegExpExecArray | null;

  while ((match = wordPattern.exec(normalized))) {
    fullWords += 1;

    if (fullWords === maxWords) {
      endIndex = match.index + match[0].length;
    }
  }

  const clipped = fullWords > maxWords;
  const content = clipped
    ? `${normalized.slice(0, endIndex).trimEnd()}\n\n[truncated]`
    : normalized;

  return {
    clipped,
    content,
    fullCharacters: normalized.length,
    fullWords,
    maxWords,
    returnedCharacters: content.length,
    returnedWords: Math.min(fullWords, maxWords),
  };
}

function extractHtmlTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = match?.[1]
    ?.replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return title || null;
}

function truncateMultiline(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}\n\n[truncated]`;
}

function truncateOneLine(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim();

  return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 3)}...`;
}

function toonScalar(value: string): string {
  return value.replace(/\s+/g, " ").trim() || "null";
}

function indentBlock(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function wrapBase64(value: string): string {
  return value.match(/.{1,120}/g)?.join("\n") ?? value;
}

function log(
  runtime: TrussWebToolRuntime,
  channel: string,
  message: string,
  metadata?: Record<string, unknown>,
): void {
  if (runtime.log) {
    runtime.log(channel, message, metadata);
    return;
  }

  logToStdout(channel, message, metadata);
}
