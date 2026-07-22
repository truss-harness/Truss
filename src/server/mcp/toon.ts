export function formatToonToolResult(toolName: string, value: unknown): string {
  const lines = [`${toolName}:`, ...toonObjectLines(value, 2)];

  return `${lines.join("\n")}\n`;
}

function toonObjectLines(value: unknown, indent: number): string[] {
  const prefix = " ".repeat(indent);

  if (!isToonRecord(value)) {
    return [`${prefix}value: ${toonScalar(value)}`];
  }

  const entries = Object.entries(value).filter((entry): entry is [string, unknown] =>
    entry[1] !== undefined
  );

  if (entries.length === 0) {
    return [`${prefix}{}`];
  }

  return entries.flatMap(([key, entryValue]) => toonEntryLines(key, entryValue, indent));
}

function toonEntryLines(key: string, value: unknown, indent: number): string[] {
  const prefix = " ".repeat(indent);

  if (typeof value === "string" && value.includes("\n")) {
    return [`${prefix}${key}: |-`, indentBlock(value, indent + 2)];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${prefix}${key}[0]: []`];
    }

    return [
      `${prefix}${key}[${value.length}]:`,
      ...value.flatMap((item) => toonArrayItemLines(item, indent + 2)),
    ];
  }

  if (isToonRecord(value)) {
    return [`${prefix}${key}:`, ...toonObjectLines(value, indent + 2)];
  }

  return [`${prefix}${key}: ${toonScalar(value)}`];
}

function toonArrayItemLines(value: unknown, indent: number): string[] {
  const prefix = " ".repeat(indent);

  if (!isToonRecord(value)) {
    if (Array.isArray(value)) {
      return [`${prefix}-`, ...toonEntryLines("items", value, indent + 2)];
    }

    return [`${prefix}- ${toonScalar(value)}`];
  }

  const entries = Object.entries(value).filter((entry): entry is [string, unknown] =>
    entry[1] !== undefined
  );

  if (entries.length === 0) {
    return [`${prefix}- {}`];
  }

  const firstEntry = entries[0];

  if (!firstEntry) {
    return [`${prefix}- {}`];
  }

  const remainingEntries = entries.slice(1);
  const firstLines = toonEntryLines(firstEntry[0], firstEntry[1], indent + 2);
  const childPrefix = " ".repeat(indent + 2);
  const lines =
    firstLines.length === 1 && firstLines[0]?.startsWith(childPrefix)
      ? [`${prefix}- ${firstLines[0].slice(childPrefix.length)}`]
      : [`${prefix}-`, ...firstLines];

  for (const [key, entryValue] of remainingEntries) {
    lines.push(...toonEntryLines(key, entryValue, indent + 2));
  }

  return lines;
}

function toonScalar(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value !== "string") {
    return JSON.stringify(value);
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return '""';
  }

  if (/^(true|false|null)$/i.test(normalized) || /^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return JSON.stringify(normalized);
  }

  return normalized;
}

function isToonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function indentBlock(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);

  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
