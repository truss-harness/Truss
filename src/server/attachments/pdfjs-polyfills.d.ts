declare module "@napi-rs/canvas/geometry.js" {
  import type { DOMMatrix as DOMMatrixType } from "@napi-rs/canvas";

  export const DOMMatrix: typeof DOMMatrixType;
  export const DOMPoint: typeof globalThis.DOMPoint;
  export const DOMRect: typeof globalThis.DOMRect;
}

declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  const worker: unknown;
  export = worker;
}

declare global {
  // eslint-disable-next-line no-var
  var pdfjsWorker: unknown | undefined;
}
