import { join } from "node:path";
import { appendFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";

export interface HtmlRequestLogEntry {
  timestamp: string;
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  error?: string;
  headers?: Record<string, string>;
  responseExcerpt?: string;
  isStealth?: boolean;
}

export async function logHtmlRequest(trussHomeDir: string, entry: HtmlRequestLogEntry): Promise<void> {
  const logsDir = join(trussHomeDir, "logs");
  const logFile = join(logsDir, "web-requests.jsonl");

  try {
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }

    const line = JSON.stringify(entry) + "\n";
    await appendFile(logFile, line, "utf-8");
  } catch (caught) {
    console.error(`[logging] Failed to write HTML request log: ${caught}`);
  }
}
