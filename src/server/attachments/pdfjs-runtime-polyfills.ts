import type { DOMMatrix as DOMMatrixType } from "@napi-rs/canvas";

interface GeometryPolyfillModule {
  DOMMatrix: typeof DOMMatrixType;
  DOMPoint: typeof globalThis.DOMPoint;
  DOMRect: typeof globalThis.DOMRect;
}

/**
 * pdfjs-dist expects browser graphics globals (DOMMatrix, SVGMatrix, etc.) that
 * are normally provided by @napi-rs/canvas in Node.js/Bun. When Truss is
 * compiled into a single executable with `bun build --compile`, the native
 * @napi-rs/canvas binding cannot be loaded, so those globals remain undefined
 * and pdfjs-dist throws during initialization.
 *
 * This helper detects the missing globals and patches them using the pure-JS
 * geometry module shipped with @napi-rs/canvas. It also pre-loads the pdfjs
 * worker and exposes it globally so pdfjs-dist does not try (and fail) to
 * dynamically import `./pdf.worker.mjs` from the compiled executable path.
 *
 * The polyfills are only installed when the globals are already missing, so
 * regular `bun` runs continue to use the real @napi-rs/canvas implementation.
 */
export async function ensurePdfjsRuntimePolyfills(): Promise<void> {
  if (typeof globalThis.DOMMatrix !== "undefined") {
    return;
  }

  const geometry = (await import("@napi-rs/canvas/geometry.js")) as GeometryPolyfillModule;

  if (!globalThis.DOMMatrix) {
    globalThis.DOMMatrix = geometry.DOMMatrix as typeof globalThis.DOMMatrix;
  }

  if (!globalThis.DOMPoint) {
    globalThis.DOMPoint = geometry.DOMPoint as typeof globalThis.DOMPoint;
  }

  if (!globalThis.DOMRect) {
    globalThis.DOMRect = geometry.DOMRect as typeof globalThis.DOMRect;
  }

  // geometry.js does not expose SVGMatrix, but pdfjs-dist performs
  // `instanceof SVGMatrix` checks. Pointing it at the DOMMatrix polyfill is
  // sufficient because the SVGMatrix code path is not actually exercised for
  // text extraction.
  if (!globalThis.SVGMatrix) {
    globalThis.SVGMatrix = geometry.DOMMatrix as unknown as typeof globalThis.SVGMatrix;
  }

  const g = globalThis as unknown as { pdfjsWorker?: unknown };

  if (!g.pdfjsWorker) {
    g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  }
}
