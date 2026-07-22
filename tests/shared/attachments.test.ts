import { describe, expect, it } from "bun:test";
import {
  attachmentFormatLabelForName,
  classifyAttachmentFile,
  fileExtension,
  markdownAttachmentNameFor,
  renderedImageAttachmentNameFor,
  renderedPageImageAttachmentNameFor,
  unsupportedAttachmentMessage,
} from "../../src/shared/attachments.ts";

describe("classifyAttachmentFile", () => {
  it("classifies image files by MIME type", () => {
    expect(classifyAttachmentFile({ name: "photo.bin", type: "image/png; charset=binary" })).toBe(
      "image",
    );
  });

  it("classifies extensionless known text filenames", () => {
    expect(classifyAttachmentFile({ name: "Dockerfile" })).toBe("text");
    expect(classifyAttachmentFile({ name: ".gitignore" })).toBe("text");
  });

  it("classifies convertible documents by extension or MIME type", () => {
    expect(classifyAttachmentFile({ name: "budget.xlsx" })).toBe("convertible-document");
    expect(
      classifyAttachmentFile({
        name: "download",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBe("convertible-document");
  });

  it("returns unsupported for unknown binary attachments", () => {
    expect(classifyAttachmentFile({ name: "archive.bin", type: "application/octet-stream" })).toBe(
      "unsupported",
    );
  });
});

describe("attachment naming helpers", () => {
  it("normalizes source document names to generated Markdown and image names", () => {
    expect(markdownAttachmentNameFor("C:\\tmp\\Project Brief.docx")).toBe("Project Brief.md");
    expect(renderedImageAttachmentNameFor("/tmp/deck.pdf")).toBe("deck.png");
    expect(renderedPageImageAttachmentNameFor("/tmp/deck.pdf", 3)).toBe("deck-page-3.png");
  });

  it("falls back to attachment names when the source is empty or extensionless", () => {
    expect(markdownAttachmentNameFor("   ")).toBe("attachment.md");
    expect(fileExtension("README")).toBe("");
  });
});

describe("attachment labels and errors", () => {
  it("returns user-facing format labels", () => {
    expect(attachmentFormatLabelForName("notes.pdf")).toBe("PDF");
    expect(attachmentFormatLabelForName("slides.pptx")).toBe("PowerPoint");
    expect(attachmentFormatLabelForName("sheet.ods")).toBe("Excel");
    expect(attachmentFormatLabelForName("draft.rtf")).toBe("Word");
  });

  it("names unsupported files in the error message", () => {
    expect(unsupportedAttachmentMessage("archive.bin")).toBe(
      "archive.bin is not a text, code, image, or Markdown-convertible document file.",
    );
  });
});
