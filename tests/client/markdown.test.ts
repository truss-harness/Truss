import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownView } from "../../src/client/markdown.tsx";

describe("MarkdownView", () => {
  it("renders markdown thematic break markers as thin dividers", () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownView, {
        source: ["Before", "", "---", "", "Middle", "", "***", "", "After"].join("\n"),
      }),
    );

    expect(markup.match(/<hr class="truss-markdown-divider"\/>/g) ?? []).toHaveLength(2);
    expect(markup).not.toContain(">---<");
    expect(markup).not.toContain(">***<");
  });

  it("renders URL links inside smart tables", () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownView, {
        source: [
          "| Site | Raw |",
          "| --- | --- |",
          "| [Docs](https://example.com/docs) | https://example.com/raw |",
        ].join("\n"),
      }),
    );

    expect(markup).toContain('href="https://example.com/docs"');
    expect(markup).toContain(">Docs</a>");
    expect(markup).toContain('href="https://example.com/raw"');
  });
});
