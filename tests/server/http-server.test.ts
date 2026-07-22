import { describe, expect, it } from "bun:test";
import { defaultServerPort, serverPortCandidates } from "../../src/server/ports.ts";
import { InvalidJsonRequestError, readJson } from "../../src/server/http/responses.ts";

describe("serverPortCandidates", () => {
  it("prefers the default Truss port before falling back to a dynamic port", () => {
    expect(defaultServerPort).toBe(7805);
    expect(serverPortCandidates(undefined)).toEqual([7805, 0]);
  });

  it("honors explicit ports without adding fallback candidates", () => {
    expect(serverPortCandidates(17771)).toEqual([17771]);
  });
});

describe("readJson", () => {
  it("throws a typed error for malformed JSON request bodies", async () => {
    await expect(
      readJson(new Request("http://truss.local/api", { method: "POST", body: "{" })),
    ).rejects.toBeInstanceOf(InvalidJsonRequestError);
  });
});
