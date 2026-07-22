import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoryManagementScreen } from "../../src/client/components/HistoryManagementScreen.tsx";

describe("HistoryManagementScreen", () => {
  it("renders history management screen header and layout correctly", () => {
    const markup = renderToStaticMarkup(
      createElement(HistoryManagementScreen)
    );

    // Verify header elements are rendered
    expect(markup).toContain("History Management");
    expect(markup).toContain("Search conversations...");
    expect(markup).toContain("Filter by time");
    expect(markup).toContain("All Time");
    expect(markup).toContain("Today");
    expect(markup).toContain("Last 7 Days");
    expect(markup).toContain("Last 30 Days");

    // Verify loading state is shown initially
    expect(markup).toContain("Loading conversations...");
  });
});
