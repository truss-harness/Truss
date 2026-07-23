import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";

const [inputPath, mode, rawPages] = process.argv.slice(2);

if (!inputPath || (mode !== "info" && mode !== "screenshot")) {
  throw new Error("Usage: node pdf-image-renderer.mjs <input-path> <info|screenshot> [pages-json]");
}

const parser = new PDFParse({
  data: new Uint8Array(await readFile(inputPath)),
});

try {
  if (mode === "info") {
    const info = await parser.getInfo();
    process.stdout.write(JSON.stringify({ pageCount: info.total }));
  } else {
    const pages = rawPages ? JSON.parse(rawPages) : undefined;
    const result = await parser.getScreenshot({
      desiredWidth: 1200,
      imageBuffer: false,
      imageDataUrl: true,
      ...(Array.isArray(pages) && pages.length > 0 ? { partial: pages } : {}),
    });

    process.stdout.write(
      JSON.stringify({
        images: result.pages.map(({ dataUrl, pageNumber }) => ({
          dataUrl,
          pageNumber,
        })),
        pageCount: result.total,
      }),
    );
  }
} finally {
  await parser.destroy();
}
