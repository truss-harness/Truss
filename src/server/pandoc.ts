import pandocWasmPath from "../../node_modules/pandoc-wasm/src/pandoc.wasm" with {
  type: "file",
};
import type { PandocConvertResult } from "pandoc-wasm";

interface PandocInstance {
  convert(
    options: Record<string, unknown>,
    stdin: string | null,
    files: Record<string, Blob | string>,
  ): Promise<PandocConvertResult>;
}

let pandocInstancePromise: Promise<PandocInstance> | null = null;

export async function convertWithPandocWasm(
  options: Record<string, unknown>,
  stdin: string | null,
  files: Record<string, Blob | string>,
): Promise<PandocConvertResult> {
  const pandoc = await getPandocInstance();

  return pandoc.convert(options, stdin, files);
}

async function getPandocInstance(): Promise<PandocInstance> {
  pandocInstancePromise ??= createPandocInstance();

  return pandocInstancePromise;
}

export async function convertMarkdownToDocx(
  markdown: string,
  referenceDocBlob?: Blob,
): Promise<Blob> {
  const files: Record<string, Blob | string> = {
    "input.md": markdown,
  };
  const options: Record<string, unknown> = {
    from: "gfm",
    to: "docx",
    "output-file": "output.docx",
  };

  if (referenceDocBlob) {
    files["reference.docx"] = referenceDocBlob;
    options["reference-doc"] = "reference.docx";
  }

  const result = await convertWithPandocWasm(options, null, files);

  if (result.stderr.trim()) {
    throw new Error(`Pandoc docx conversion failed: ${result.stderr.trim()}`);
  }

  const docxBlob = result.files["output.docx"];

  if (!docxBlob || typeof docxBlob === "string") {
    throw new Error("Pandoc did not produce a docx output file.");
  }

  return docxBlob;
}

async function createPandocInstance(): Promise<PandocInstance> {
  const [{ createPandocInstance }, wasmBinary] = await Promise.all([
    import("../../node_modules/pandoc-wasm/src/core.js"),
    Bun.file(pandocWasmPath).arrayBuffer(),
  ]);

  return createPandocInstance(wasmBinary);
}
