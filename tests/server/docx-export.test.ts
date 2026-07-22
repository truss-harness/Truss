import { describe, expect, it } from "bun:test";
import { convertMarkdownToDocx } from "../../src/server/pandoc.ts";
import referenceDocPath from "../../src/assets/reference.docx" with { type: "file" };

describe("docx export", () => {
  it("converts markdown to docx using pandoc and a reference doc", async () => {
    const markdown = "# Test Title\n\nThis is a test paragraph.\n\n- Bullet 1\n- Bullet 2\n";
    const referenceBlob = Bun.file(referenceDocPath);
    const docxBlob = await convertMarkdownToDocx(markdown, referenceBlob);

    expect(docxBlob).toBeDefined();
    expect(docxBlob.size).toBeGreaterThan(0);

    const arrayBuffer = await docxBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // ZIP files start with PK magic bytes (0x50, 0x4B)
    expect(uint8Array[0]).toBe(0x50);
    expect(uint8Array[1]).toBe(0x4B);
  }, 15000);
});
