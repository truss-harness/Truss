declare module "pandoc-wasm" {
  export interface PandocConvertResult {
    files: Record<string, Blob | string>;
    mediaFiles: Record<string, Blob>;
    stderr: string;
    stdout: string;
    warnings: unknown[];
  }

  export function convert(
    options: Record<string, unknown>,
    stdin: string | null,
    files: Record<string, Blob | string>,
  ): Promise<PandocConvertResult>;
}

declare module "*pandoc-wasm/src/core.js" {
  import type { PandocConvertResult } from "pandoc-wasm";

  export interface PandocInstance {
    convert(
      options: Record<string, unknown>,
      stdin: string | null,
      files: Record<string, Blob | string>,
    ): Promise<PandocConvertResult>;
  }

  export function createPandocInstance(
    wasmBinary: BufferSource,
  ): Promise<PandocInstance>;
}

declare module "*.wasm" {
  const path: string;
  export default path;
}
