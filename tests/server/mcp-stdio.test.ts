import { describe, expect, it } from "bun:test";
import {
  readBoundedStdioLines,
} from "../../src/server/mcp/transports/stdio.ts";

describe("readBoundedStdioLines", () => {
  it("discards an oversized unterminated line without retaining its contents", async () => {
    const discarded: number[] = [];
    const lines = await collectLines(
      readBoundedStdioLines(
        streamFromChunks(["a".repeat(16), "b".repeat(16), "\n{\"jsonrpc\":\"2.0\"}\n"]),
        24,
        () => discarded.push(1),
      ),
    );

    expect(discarded).toEqual([1]);
    expect(lines).toEqual(['{"jsonrpc":"2.0"}']);
  });

  it("preserves a partial line that remains within the configured limit", async () => {
    const lines = await collectLines(
      readBoundedStdioLines(streamFromChunks(["first", " line\nsecond"]), 32, () => {
        throw new Error("Line should not be discarded.");
      }),
    );

    expect(lines).toEqual(["first line", "second"]);
  });
});

async function collectLines(lines: AsyncIterable<string>): Promise<string[]> {
  const result: string[] = [];

  for await (const line of lines) {
    result.push(line);
  }

  return result;
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}
