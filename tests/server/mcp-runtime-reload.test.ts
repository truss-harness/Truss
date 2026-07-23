import { describe, expect, it } from "bun:test";
import { replaceMcpRuntime } from "../../src/server/http/context.ts";

describe("replaceMcpRuntime", () => {
  it("closes the previous runtime without waiting for the replacement to settle", async () => {
    let closed = false;
    const previous = {
      close: async () => {
        closed = true;
      },
    };
    const next = {
      close: async () => undefined,
      waitUntilSettled: () => new Promise<void>(() => {}),
    };

    await expect(replaceMcpRuntime(previous, async () => next)).resolves.toBe(next);
    expect(closed).toBe(true);
  });
});
