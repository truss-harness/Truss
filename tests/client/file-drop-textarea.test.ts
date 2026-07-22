import { describe, expect, it } from "bun:test";
import { imageFilesFromClipboard } from "../../src/client/components/FileDropTextarea.tsx";

describe("imageFilesFromClipboard", () => {
  it("returns image files from clipboard file data", () => {
    const png = new File([Uint8Array.from([137, 80, 78, 71])], "screenshot.png", {
      type: "image/png",
    });
    const text = new File(["hello"], "notes.txt", { type: "text/plain" });
    const files = imageFilesFromClipboard(clipboardData({ files: [png, text] }));

    expect(files).toHaveLength(1);
    expect(files[0]).toBe(png);
  });

  it("falls back to image clipboard items and names unnamed files", () => {
    const webp = new File([Uint8Array.from([1, 2, 3])], "", { type: "image/webp" });
    const files = imageFilesFromClipboard(
      clipboardData({
        items: [
          {
            getAsFile: () => webp,
            kind: "file",
            type: "image/webp",
          },
        ],
      }),
    );

    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("clipboard-image.webp");
    expect(files[0]?.type).toBe("image/webp");
  });

  it("ignores clipboard data without image files", () => {
    const files = imageFilesFromClipboard(
      clipboardData({
        files: [new File(["hello"], "notes.txt", { type: "text/plain" })],
      }),
    );

    expect(files).toHaveLength(0);
  });
});

function clipboardData({
  files = [],
  items = [],
}: {
  files?: File[];
  items?: Array<Pick<DataTransferItem, "getAsFile" | "kind" | "type">>;
}): DataTransfer {
  return {
    files,
    items,
  } as unknown as DataTransfer;
}
