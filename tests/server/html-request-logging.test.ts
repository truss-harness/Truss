import { describe, it, expect } from "bun:test";
import { logHtmlRequest } from "../../src/server/utils/html-request-logging.ts";
import { join } from "node:path";
import { existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

describe("HTML Request Logging", () => {
  it("writes log entries to a file", async () => {
    const testDir = join(homedir(), ".truss-test-logs");
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    const logFile = join(testDir, "logs", "web-requests.jsonl");

    // Cleanup previous test run
    if (existsSync(logFile)) {
      rmSync(logFile);
    }

    const entry = {
      timestamp: new Date().toISOString(),
      url: "https://example.com",
      method: "GET",
      status: 200,
      statusText: "OK",
    };

    await logHtmlRequest(testDir, entry);

    expect(existsSync(logFile)).toBe(true);
    const content = readFileSync(logFile, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.url).toBe("https://example.com");
    expect(parsed.status).toBe(200);

    // Cleanup
    rmSync(testDir, { recursive: true, force: true });
  });
});
