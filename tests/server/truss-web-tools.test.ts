import { afterEach, describe, expect, it, mock } from "bun:test";
import type {
  ToolExecutionModel,
  TrussWebToolRuntime,
} from "../../src/server/tools/truss-web-tools.ts";
import type {
  CamoufoxBrowser,
  CamoufoxPageFetchResult,
} from "../../src/server/utils/camoufox-browser.ts";

const originalFetch = globalThis.fetch;
const pandocCalls: Array<{ options: Record<string, unknown>; stdin: string | null }> = [];
let pandocDelay: ((stdin: string | null) => Promise<void>) | null = null;

mock.module("../../src/server/pandoc.ts", () => ({
  convertWithPandocWasm: async (
    options: Record<string, unknown>,
    stdin: string | null,
    _files: Record<string, Blob | string>,
  ) => {
    pandocCalls.push({ options, stdin });
    await pandocDelay?.(stdin ?? null);

    return {
      stderr: "",
      stdout: stdin?.includes("data-pandoc-empty") ? "\n" : htmlToMockMarkdown(stdin ?? ""),
    };
  },
}));

const { executeTrussWebTool, trussWebToolDefinitions } = await import(
  "../../src/server/tools/truss-web-tools.ts"
);

const settings = {
  sanitizerModelId: null,
  sanitizerProviderId: null,
};

describe("Truss Web Tools", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    pandocDelay = null;
    pandocCalls.length = 0;
  });

  it("advertises browser-backed web tools in the schemas", () => {
    const loadProperties = trussWebToolDefinitions.load_webpage.parameters.properties as
      | Record<string, unknown>
      | undefined;
    const conversionProperties = trussWebToolDefinitions.convert_webpage_html_to_markdown.parameters
      .properties as Record<string, unknown> | undefined;
    const sanitizerProperties = trussWebToolDefinitions.sanitize_webpage_markdown.parameters
      .properties as Record<string, unknown> | undefined;
    const screenshotProperties = trussWebToolDefinitions.get_website_screenshot.parameters
      .properties as Record<string, unknown> | undefined;

    expect(loadProperties).toContainKey("url");
    expect(loadProperties).toContainKey("urls");
    expect(loadProperties).toContainKey("max-words");
    expect(loadProperties).not.toContainKey("skip-sanitize");
    expect(loadProperties).not.toContainKey("skip-markdown-conversion");
    expect(conversionProperties).toContainKey("html");
    expect(conversionProperties).toContainKey("max-words");
    expect(sanitizerProperties).toContainKey("content");
    expect(sanitizerProperties).toContainKey("content-format");
    expect(screenshotProperties).toContainKey("url");
    expect(screenshotProperties).toContainKey("width");
    expect(screenshotProperties).toContainKey("height");
  });

  it("rejects missing or invalid search queries before fetching", async () => {
    const runtime = createRuntime();

    await expect(
      executeTrussWebTool({
        runtime,
        settings,
        toolCall: {
          arguments: {},
          name: "web_search",
        },
      }),
    ).rejects.toThrow("web_search query must be a string.");

    await expect(
      executeTrussWebTool({
        runtime,
        settings,
        toolCall: {
          arguments: { query: "   " },
          name: "web_search",
        },
      }),
    ).rejects.toThrow("web_search query must be a non-empty string.");
  });

  it("routes web search through the browser", async () => {
    const visitedUrls: string[] = [];
    const runtime = createRuntime({
      fetchPage: async (url) => {
        visitedUrls.push(url.href);
        return pageResponse(
          [
            '<div class="result">',
            '<a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example Docs</a>',
            '<a class="result__snippet">Useful docs snippet.</a>',
            "</div>",
          ].join(""),
          "text/html; charset=utf-8",
        );
      },
    });

    const result = await executeTrussWebTool({
      runtime,
      settings,
      toolCall: {
        arguments: { query: "current docs" },
        name: "web_search",
      },
    });

    expect(visitedUrls).toEqual(["https://html.duckduckgo.com/html/?q=current+docs"]);
    expect(result).toContain("search_results[1]:");
    expect(result).toContain("title: Example Docs");
    expect(result).toContain("url: https://example.com/docs");
  });

  it("sanitizes Markdown with the explicit sanitizer tool without an extra classifier call", async () => {
    const calledUrls: string[] = [];
    const runtime = createRuntime();

    mockFetch(async (input, init) => {
      const url = requestUrl(input);
      calledUrls.push(url);

      if (url === "https://llm.test/v1/chat/completions") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          messages?: Array<{ content?: unknown; role?: string }>;
        };
        const systemMessage = body.messages?.find((message) => message.role === "system")?.content;

        expect(String(systemMessage)).toContain("You sanitize webpage Markdown");
        expect(String(systemMessage)).not.toContain("Classify whether");

        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "# Sanitized page\n\nPage body.",
                },
              },
            ],
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        );
      }

      throw new Error(`Unexpected fetch URL ${url}`);
    });

    const progressUpdates: Array<{ message?: string; percent: number }> = [];
    const result = await executeTrussWebTool({
      fallbackModel: sanitizerModel,
      onProgress: (progress) => progressUpdates.push(progress),
      runtime,
      settings,
      toolCall: {
        arguments: {
          content: "# Hello\n\nPage body.",
          "content-format": "markdown",
          title: "Example",
          url: "https://example.com/page",
        },
        name: "sanitize_webpage_markdown",
      },
    });

    expect(calledUrls).toEqual(["https://llm.test/v1/chat/completions"]);
    expect(progressUpdates).toEqual([
      { message: "Sanitizing page...", percent: 0 },
      { message: "Page sanitized.", percent: 100 },
    ]);
    expect(result).toContain("webpage_markdown_sanitization:");
    expect(result).toContain("input_format: markdown");
    expect(result).toContain("sanitizer:\n    status: completed");
    expect(result).toContain("# Sanitized page");
  });

  it("clips HTML before Markdown conversion", async () => {
    const runtime = createRuntime();

    const result = await executeTrussWebTool({
      runtime,
      settings,
      toolCall: {
        arguments: {
          html: `<html><head><title>Large</title></head><body><h1>Start</h1><p>${"a".repeat(270_000)}</p><p>Tail marker past limit</p></body></html>`,
          title: "Large",
          url: "https://example.com/large",
        },
        name: "convert_webpage_html_to_markdown",
      },
    });

    expect(result).toContain("webpage_markdown_conversion:");
    expect(result).toContain("content_format: markdown");
    expect(result).toContain("conversion:\n    status: completed\n    reason: html_input_clipped_to_256_kib");
    expect(result).toContain("# Start");
    expect(result).not.toContain("Tail marker past limit");
    expect(pandocCalls).toHaveLength(1);
    expect(pandocCalls[0]?.options).toMatchObject({ to: "commonmark" });
    expect(pandocCalls[0]?.stdin).not.toContain("Tail marker past limit");
    expect(new TextEncoder().encode(pandocCalls[0]?.stdin ?? "").byteLength).toBeLessThanOrEqual(
      256 * 1024,
    );
  });

  it("extracts rendered body content before clipping HTML for Markdown conversion", async () => {
    const runtime = createRuntime();

    const result = await executeTrussWebTool({
      runtime,
      settings,
      toolCall: {
        arguments: {
          html: `<html><head><title>Late body</title><style>${".banner{display:none;}".repeat(18_000)}</style></head><body><main><h1>Real body content</h1><p>This text starts after the old clipping boundary.</p></main></body></html>`,
          title: "Late body",
          url: "https://example.com/late-body",
        },
        name: "convert_webpage_html_to_markdown",
      },
    });

    expect(result).toContain("content_format: markdown");
    expect(result).toContain("# Real body content");
    expect(result).toContain("This text starts after the old clipping boundary.");
    expect(pandocCalls).toHaveLength(1);
    expect(pandocCalls[0]?.stdin).toContain("Real body content");
    expect(pandocCalls[0]?.stdin).not.toContain(".banner");
  });

  it("returns cleaned HTML fallback when Pandoc returns empty Markdown", async () => {
    const runtime = createRuntime();

    const result = await executeTrussWebTool({
      runtime,
      settings,
      toolCall: {
        arguments: {
          html: [
            "<html><head><title>Styled shell</title></head><body>",
            '<main data-pandoc-empty="true">',
            "<h1>Fallback source</h1>",
            "<p>Use this cleaned HTML.</p>",
            "<script>removeMe()</script>",
            "<style>.remove-me{display:none;}</style>",
            "<template>Remove this template.</template>",
            "</main>",
            "</body></html>",
          ].join(""),
          title: "Styled shell",
          url: "https://example.com/styled-shell",
        },
        name: "convert_webpage_html_to_markdown",
      },
    });

    expect(result).toContain("webpage_markdown_conversion:");
    expect(result).toContain("content_format: html");
    expect(result).toContain("conversion:\n    status: fallback");
    expect(result).toContain("error: Pandoc produced empty Markdown.");
    expect(result).toContain('<main data-pandoc-empty="true">');
    expect(result).toContain("<h1>Fallback source</h1>");
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("<style>");
    expect(result).not.toContain("<template>");
  });

  it("sanitizes cleaned HTML with the explicit sanitizer tool", async () => {
    const calledUrls: string[] = [];
    const runtime = createRuntime();

    mockFetch(async (input, init) => {
      const url = requestUrl(input);
      calledUrls.push(url);

      if (url === "https://llm.test/v1/chat/completions") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          messages?: Array<{ content?: unknown; role?: string }>;
        };
        const systemMessage = body.messages?.find((message) => message.role === "system")?.content;
        const userMessage = body.messages?.find((message) => message.role === "user")?.content;

        expect(String(systemMessage)).toContain("cleaned HTML");
        expect(String(userMessage)).toContain('<main data-pandoc-empty="true">');
        expect(String(userMessage)).toContain("<h1>Fallback source</h1>");
        expect(String(userMessage)).not.toContain("<script>");
        expect(String(userMessage)).not.toContain("<style>");
        expect(String(userMessage)).not.toContain("<template>");

        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "# Sanitized fallback\n\nUse this cleaned HTML.",
                },
              },
            ],
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        );
      }

      throw new Error(`Unexpected fetch URL ${url}`);
    });

    const result = await executeTrussWebTool({
      fallbackModel: sanitizerModel,
      runtime,
      settings,
      toolCall: {
        arguments: {
          content: [
            '<main data-pandoc-empty="true">',
            "<h1>Fallback source</h1>",
            "<p>Use this cleaned HTML.</p>",
            "</main>",
          ].join(""),
          "content-format": "html",
          title: "Styled shell",
          url: "https://example.com/styled-shell",
        },
        name: "sanitize_webpage_markdown",
      },
    });

    expect(calledUrls).toEqual(["https://llm.test/v1/chat/completions"]);
    expect(result).toContain("input_format: html");
    expect(result).toContain("sanitizer:\n    status: completed");
    expect(result).toContain("# Sanitized fallback");
  });

  it("returns JSON responses without markdown conversion or sanitization", async () => {
    const runtime = createRuntime({
      fetchPage: async () =>
        pageResponse(
          JSON.stringify({ ok: true, items: ["alpha", "beta", "gamma", "delta"] }),
          "application/json",
        ),
    });

    const progressUpdates: Array<{ message?: string; percent: number }> = [];
    const result = await executeTrussWebTool({
      onProgress: (progress) => progressUpdates.push(progress),
      runtime,
      settings,
      toolCall: {
        arguments: { "max-words": 6, url: "https://example.com/data.json" },
        name: "load_webpage",
      },
    });

    expect(result).toContain("content_format: json");
    expect(progressUpdates).toEqual([
      { message: "Fetching page...", percent: 0 },
      { message: "Page fetched.", percent: 80 },
      { message: "Page ready.", percent: 100 },
    ]);
    expect(result).toContain("content_type: application/json");
    expect(result).toContain("content_size:");
    expect(result).toContain("clipped: true");
    expect(result).toContain("max_words: 6");
    expect(result).toContain("conversion:\n    status: skipped\n    reason: json_response");
    expect(result).toContain("sanitizer:\n    status: skipped\n    reason: separate_tool");
    expect(result).toContain("content_json: |-");
    expect(result).toContain("[truncated]");
  });

  it("detects JSON responses served as plain text", async () => {
    const runtime = createRuntime({
      fetchPage: async () => pageResponse('{"message":"hello","count":2}', "text/plain"),
    });

    const result = await executeTrussWebTool({
      runtime,
      settings,
      toolCall: {
        arguments: { url: "https://example.com/data.txt" },
        name: "load_webpage",
      },
    });

    expect(result).toContain("content_format: json");
    expect(result).toContain("conversion:\n    status: skipped\n    reason: json_response");
    expect(result).toContain("sanitizer:\n    status: skipped\n    reason: separate_tool");
  });

  it("returns raw HTML without Markdown conversion or sanitization", async () => {
    const runtime = createRuntime({
      fetchPage: async () =>
        pageResponse(
          [
            "<html><head><title>Example</title>",
            '<meta name="description" content="Noisy description">',
            '<link rel="stylesheet" href="/style.css">',
            "<style>.hidden{display:none}</style>",
            "<script>headScript()</script>",
            "</head><body><main>Hello page ",
            '<a href="/docs">docs</a>',
            "<script>bodyScript()</script>",
            "<style>.body-hidden{display:none}</style>",
            '<meta name="body-meta" content="remove">',
            '<link rel="preload" href="/late.css">',
            "</main></body></html>",
          ].join(""),
          "text/html; charset=utf-8",
        ),
    });

    const result = await executeTrussWebTool({
      runtime,
      settings,
      toolCall: {
        arguments: {
          url: "https://example.com/page",
        },
        name: "load_webpage",
      },
    });

    expect(result).toContain("title: Example");
    expect(result).toContain("content_format: html");
    expect(result).toContain("conversion:\n    status: skipped\n    reason: separate_tool");
    expect(result).toContain("sanitizer:\n    status: skipped\n    reason: separate_tool");
    expect(result).toContain("content_html: |-");
    expect(result).toContain("<main>Hello page");
    expect(result).toContain('<a href="/docs">docs</a>');
    expect(result).not.toContain("<script");
    expect(result).not.toContain("<style");
    expect(result).not.toContain("<meta");
    expect(result).not.toContain("<link");
  });

  it("loads up to five websites in one call", async () => {
    const visitedUrls: string[] = [];
    const runtime = createRuntime({
      fetchPage: async (url) => {
        visitedUrls.push(url.href);
        return pageResponse(
          `<html><head><title>${url.hostname}</title></head><body>${url.href}</body></html>`,
          "text/html; charset=utf-8",
        );
      },
    });

    const result = await executeTrussWebTool({
      runtime,
      settings,
      toolCall: {
        arguments: {
          url: ["https://example.com/one", "https://example.org/two"],
        },
        name: "load_webpage",
      },
    });

    expect(visitedUrls).toEqual(["https://example.com/one", "https://example.org/two"]);
    expect(result).toContain("webpages[2]:");
    expect(result).toContain("url: https://example.com/one");
    expect(result).toContain("url: https://example.org/two");
  });

  it("converts independent webpage HTML tool calls in parallel", async () => {
    let activePandocCalls = 0;
    let maxActivePandocCalls = 0;
    let releasePandocCalls: (() => void) | null = null;
    const releasePromise = new Promise<void>((resolve) => {
      releasePandocCalls = resolve;
    });
    pandocDelay = async () => {
      activePandocCalls += 1;
      maxActivePandocCalls = Math.max(maxActivePandocCalls, activePandocCalls);

      if (activePandocCalls === 2) {
        releasePandocCalls?.();
      }

      await Promise.race([releasePromise, sleep(50)]);
      activePandocCalls -= 1;
    };
    const runtime = createRuntime();

    const results = await Promise.all([
      executeTrussWebTool({
        runtime,
        settings,
        toolCall: {
          arguments: {
            html: "<html><body><h1>First page</h1></body></html>",
            url: "https://example.com/one",
          },
          name: "convert_webpage_html_to_markdown",
        },
      }),
      executeTrussWebTool({
        runtime,
        settings,
        toolCall: {
          arguments: {
            html: "<html><body><h1>Second page</h1></body></html>",
            url: "https://example.org/two",
          },
          name: "convert_webpage_html_to_markdown",
        },
      }),
    ]);

    expect(maxActivePandocCalls).toBe(2);
    expect(results.join("\n")).toContain("webpage_markdown_conversion:");
    expect(pandocCalls).toHaveLength(2);
  });

  it("sanitizes independent webpage Markdown tool calls in parallel", async () => {
    let activeSanitizers = 0;
    let maxActiveSanitizers = 0;
    let releaseSanitizers: (() => void) | null = null;
    const releasePromise = new Promise<void>((resolve) => {
      releaseSanitizers = resolve;
    });
    const runtime = createRuntime();

    mockFetch(async (input) => {
      const url = requestUrl(input);

      if (url === "https://llm.test/v1/chat/completions") {
        activeSanitizers += 1;
        maxActiveSanitizers = Math.max(maxActiveSanitizers, activeSanitizers);

        if (activeSanitizers === 2) {
          releaseSanitizers?.();
        }

        await Promise.race([releasePromise, sleep(50)]);
        activeSanitizers -= 1;

        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "# Sanitized parallel page",
                },
              },
            ],
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        );
      }

      throw new Error(`Unexpected fetch URL ${url}`);
    });

    const results = await Promise.all([
      executeTrussWebTool({
        fallbackModel: sanitizerModel,
        runtime,
        settings,
        toolCall: {
          arguments: {
            content: "# First page",
            url: "https://example.com/one",
          },
          name: "sanitize_webpage_markdown",
        },
      }),
      executeTrussWebTool({
        fallbackModel: sanitizerModel,
        runtime,
        settings,
        toolCall: {
          arguments: {
            content: "# Second page",
            url: "https://example.org/two",
          },
          name: "sanitize_webpage_markdown",
        },
      }),
    ]);

    expect(maxActiveSanitizers).toBe(2);
    expect(results.join("\n")).toContain("# Sanitized parallel page");
  });

  it("rejects more than five websites in one call", async () => {
    await expect(
      executeTrussWebTool({
        runtime: createRuntime(),
        settings,
        toolCall: {
          arguments: {
            url: [
              "https://example.com/1",
              "https://example.com/2",
              "https://example.com/3",
              "https://example.com/4",
              "https://example.com/5",
              "https://example.com/6",
            ],
          },
          name: "load_webpage",
        },
      }),
    ).rejects.toThrow("load_webpage can load at most 5 URLs at a time.");
  });

  it("returns website screenshots as base64 image data", async () => {
    const runtime = createRuntime({
      screenshotPage: async (url, options) => ({
        contentType: options.format === "jpeg" ? "image/jpeg" : "image/png",
        data: Uint8Array.from([1, 2, 3]),
        height: options.height,
        status: 200,
        statusText: "OK",
        title: `Screenshot ${url.hostname}`,
        width: options.width,
      }),
    });

    const result = await executeTrussWebTool({
      runtime,
      settings,
      toolCall: {
        arguments: {
          height: 900,
          url: "https://example.com/page",
          width: 600,
        },
        name: "get_website_screenshot",
      },
    });

    expect(result).toContain("website_screenshot:");
    expect(result).toContain("content_type: image/jpeg");
    expect(result).toContain("width: 600");
    expect(result).toContain("height: 900");
    expect(result).toContain("image_base64: |-");
    expect(result).toContain("AQID");
  });

  it("rejects unsupported webpage content types before conversion", async () => {
    const runtime = createRuntime({
      fetchPage: async () => pageResponse("binary", "application/octet-stream"),
    });

    await expect(
      executeTrussWebTool({
        runtime,
        settings,
        toolCall: {
          arguments: { url: "https://example.com/file.bin" },
          name: "load_webpage",
        },
      }),
    ).rejects.toThrow("response content type application/octet-stream is not supported");
  });

  it("rejects non-HTTP webpage URLs before fetching", async () => {
    await expect(
      executeTrussWebTool({
        runtime: createRuntime(),
        settings,
        toolCall: {
          arguments: { url: "file:///tmp/page.html" },
          name: "load_webpage",
        },
      }),
    ).rejects.toThrow("load_webpage URL must use HTTP or HTTPS.");
  });
});

function createRuntime(overrides: Partial<CamoufoxBrowser> = {}): TrussWebToolRuntime {
  const browser = createBrowser(overrides);

  return {
    getBrowser: () => browser,
    getLlmProviders: () => [],
    getModelProfile: () => null,
    getSecretEnv: () => process.env,
    log: () => undefined,
  };
}

function createBrowser(overrides: Partial<CamoufoxBrowser>): CamoufoxBrowser {
  return {
    close: async () => undefined,
    fetchPage: async () => {
      throw new Error("Unexpected browser page fetch.");
    },
    screenshotPage: async () => {
      throw new Error("Unexpected browser screenshot.");
    },
    ...overrides,
  };
}

function pageResponse(
  content: string,
  contentType: string,
  status = 200,
  statusText = "OK",
): CamoufoxPageFetchResult {
  return {
    content,
    contentType,
    headers: {
      "content-length": String(new TextEncoder().encode(content).byteLength),
      "content-type": contentType,
    },
    status,
    statusText,
  };
}

function mockFetch(handler: (...args: Parameters<typeof fetch>) => Response | Promise<Response>) {
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => handler(...args)) as typeof fetch;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (input instanceof Request) {
    return input.url;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return String(input);
}

function htmlToMockMarkdown(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*)/i.exec(html)?.[1] ?? html;

  return body
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, content: string) => {
      const depth = Math.max(1, Math.min(Number.parseInt(level, 10), 6));
      return `${"#".repeat(depth)} ${stripMockHtml(content)}\n\n`;
    })
    .replace(/<\/(p|div|section|article|main)>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripMockHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/[ \t]{2,}/g, " ").trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const sanitizerModel: ToolExecutionModel = {
  modelId: "local-test",
  parameters: {
    contextSize: null,
    temperature: null,
    topK: null,
    topP: null,
  },
  provider: {
    baseUrl: "https://llm.test/v1",
    baseUrlSource: "settings",
    configured: true,
    credentialEnvVars: [],
    credentialRequired: false,
    enabled: true,
    id: "openai-compatible",
    kind: "custom",
    label: "OpenAI compatible test endpoint",
    models: ["local-test"],
    secrets: [],
  },
};
