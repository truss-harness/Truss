import type { ProviderToolCall } from "./chat-payloads.ts";

export interface ToolCallRecoveryTool {
  name: string;
}

interface TextSpan {
  end: number;
  start: number;
}

interface RawRecoveredToolCall {
  arguments: Record<string, unknown>;
  idHint?: string;
  name: string;
  position: number;
}

export function recoverTextToolCalls(
  content: string,
  tools: readonly ToolCallRecoveryTool[],
): {
  content: string;
  toolCalls: ProviderToolCall[];
} {
  if (!content.trim() || tools.length === 0) {
    return {
      content,
      toolCalls: [],
    };
  }

  const spans: TextSpan[] = [];
  const rawCalls = [
    ...parseDelimitedToolCalls(content, spans),
    ...parseDsmlToolCalls(content, spans),
    ...parseMiniMaxToolCalls(content, spans),
  ].sort((left, right) => left.position - right.position);

  if (rawCalls.length === 0) {
    return {
      content,
      toolCalls: [],
    };
  }

  const usedIds = new Set<string>();
  const toolCalls = rawCalls.map((call, index) => {
    const name = resolveRecoveredToolName(call.name, tools);

    return {
      arguments: call.arguments,
      id: recoveredToolCallId(call, index, name, usedIds),
      name,
    };
  });

  return {
    content: stripTextSpans(content, spans),
    toolCalls,
  };
}

function parseDelimitedToolCalls(content: string, spans: TextSpan[]): RawRecoveredToolCall[] {
  const rawCalls: RawRecoveredToolCall[] = [];
  const sectionPattern =
    /<tool_calls_section_begin>([\s\S]*?)<tool_calls_section_end>/g;

  for (const match of content.matchAll(sectionPattern)) {
    const section = match[1] ?? "";
    const sectionCalls = parseDelimitedToolCallSection(
      section,
      match.index + match[0].indexOf(section),
    );

    if (sectionCalls.length === 0) {
      continue;
    }

    spans.push({
      start: match.index,
      end: match.index + match[0].length,
    });
    rawCalls.push(...sectionCalls);
  }

  const bareCallPattern =
    /<tool_call_begin>([\s\S]*?)<tool_call_argument_begin>([\s\S]*?)<tool_call_end>/g;

  for (const match of content.matchAll(bareCallPattern)) {
    const start = match.index;
    const end = start + match[0].length;

    if (spans.some((span) => start >= span.start && end <= span.end)) {
      continue;
    }

    const parsed = parseDelimitedToolCall(match[1] ?? "", match[2] ?? "", start);

    if (!parsed) {
      continue;
    }

    spans.push({ start, end });
    rawCalls.push(parsed);
  }

  return rawCalls;
}

function parseDelimitedToolCallSection(
  section: string,
  sectionOffset: number,
): RawRecoveredToolCall[] {
  const callPattern =
    /<tool_call_begin>([\s\S]*?)<tool_call_argument_begin>([\s\S]*?)<tool_call_end>/g;
  const calls: RawRecoveredToolCall[] = [];

  for (const match of section.matchAll(callPattern)) {
    const parsed = parseDelimitedToolCall(
      match[1] ?? "",
      match[2] ?? "",
      sectionOffset + match.index,
    );

    if (parsed) {
      calls.push(parsed);
    }
  }

  return calls;
}

function parseDelimitedToolCall(
  header: string,
  argumentText: string,
  position: number,
): RawRecoveredToolCall | null {
  const parsedHeader = parseDelimitedToolCallHeader(header);

  if (!parsedHeader) {
    return null;
  }

  return {
    arguments: parseJsonObject(argumentText),
    idHint: parsedHeader.idHint,
    name: parsedHeader.name,
    position,
  };
}

function parseDelimitedToolCallHeader(header: string): { idHint?: string; name: string } | null {
  let name = decodeEntities(header).trim();
  let idHint: string | undefined;

  if (!name) {
    return null;
  }

  const firstWhitespace = name.search(/\s/);

  if (firstWhitespace >= 0) {
    name = name.slice(0, firstWhitespace).trim();
  }

  const idSeparator = name.lastIndexOf(":");

  if (idSeparator > 0 && idSeparator < name.length - 1) {
    idHint = name.slice(idSeparator + 1).trim();
    name = name.slice(0, idSeparator).trim();
  }

  return name ? { idHint, name } : null;
}

function parseDsmlToolCalls(content: string, spans: TextSpan[]): RawRecoveredToolCall[] {
  const rawCalls: RawRecoveredToolCall[] = [];
  const sectionPattern =
    /<\s*\|\s*\|\s*DSML\s*\|\s*\|\s*tool_calls\s*>([\s\S]*?)<\s*\/\s*\|\s*\|\s*DSML\s*\|\s*\|\s*tool_calls\s*>/g;

  for (const match of content.matchAll(sectionPattern)) {
    const section = match[1] ?? "";
    const sectionCalls = parseDsmlToolCallSection(section, match.index);

    if (sectionCalls.length === 0) {
      continue;
    }

    spans.push({
      start: match.index,
      end: match.index + match[0].length,
    });
    rawCalls.push(...sectionCalls);
  }

  return rawCalls;
}

function parseMiniMaxToolCalls(content: string, spans: TextSpan[]): RawRecoveredToolCall[] {
  const rawCalls: RawRecoveredToolCall[] = [];
  const sectionPattern = /<tool_calls?\b[^>]*>([\s\S]*?)<\/tool_calls?>/g;

  for (const match of content.matchAll(sectionPattern)) {
    const start = match.index;
    const end = start + match[0].length;

    if (spans.some((span) => start >= span.start && end <= span.end)) {
      continue;
    }

    const section = stripMiniMaxSeparators(match[1] ?? "");
    const sectionCalls = parseMiniMaxToolCallSection(section, start);

    if (sectionCalls.length === 0) {
      continue;
    }

    spans.push({ start, end });
    rawCalls.push(...sectionCalls);
  }

  return rawCalls;
}

function parseMiniMaxToolCallSection(
  section: string,
  sectionPosition: number,
): RawRecoveredToolCall[] {
  const invokePattern = /<invoke\b([^>]*)>([\s\S]*?)<\/invoke>/g;
  const calls: RawRecoveredToolCall[] = [];

  for (const match of section.matchAll(invokePattern)) {
    const attrs = parseAttributes(match[1] ?? "");
    const name = attrs.name?.trim();

    if (!name) {
      continue;
    }

    calls.push({
      arguments: parseMiniMaxArguments(match[2] ?? ""),
      name,
      position: sectionPosition + match.index,
    });
  }

  return calls;
}

function stripMiniMaxSeparators(value: string): string {
  return value.replace(/\]\s*<\s*\]\s*minimax\s*\[\s*>\s*\[/gi, "");
}

function parseMiniMaxArguments(body: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const argumentPattern = /<([a-zA-Z_][\w.-]*)\b[^>]*>([\s\S]*?)<\/\1>/g;

  for (const match of body.matchAll(argumentPattern)) {
    const name = match[1]?.trim();

    if (!name || name === "invoke") {
      continue;
    }

    args[name] = parseMiniMaxArgumentValue(match[2] ?? "");
  }

  return args;
}

function parseMiniMaxArgumentValue(value: string): unknown {
  return parseScalarValue(decodeEntities(stripMiniMaxSeparators(value)).trim());
}

function parseDsmlToolCallSection(
  section: string,
  sectionPosition: number,
): RawRecoveredToolCall[] {
  const normalized = normalizeDsmlTags(section);
  const invokeMatches = [...normalized.matchAll(/<invoke\b([^>]*)>/g)];
  const calls: RawRecoveredToolCall[] = [];

  invokeMatches.forEach((match, index) => {
    const attrs = parseAttributes(match[1] ?? "");
    const name = attrs.name?.trim();

    if (!name) {
      return;
    }

    const bodyStart = match.index + match[0].length;
    const bodyEnd = invokeMatches[index + 1]?.index ?? normalized.length;
    let body = normalized.slice(bodyStart, bodyEnd);
    const invokeEnd = body.indexOf("</invoke>");

    if (invokeEnd >= 0) {
      body = body.slice(0, invokeEnd);
    }

    calls.push({
      arguments: parseDsmlParameters(body),
      name,
      position: sectionPosition + index,
    });
  });

  return calls;
}

function normalizeDsmlTags(value: string): string {
  return value.replace(
    /<\s*(\/?)\s*\|\s*\|\s*DSML\s*\|\s*\|\s*([^>]*?)>/g,
    (_match, closing: string, body: string) => `<${closing}${body.trim()}>`,
  );
}

function parseDsmlParameters(body: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const parameterPattern = /<parameter\b([^>]*)>([\s\S]*?)<\/parameter>/g;

  for (const match of body.matchAll(parameterPattern)) {
    const attrs = parseAttributes(match[1] ?? "");
    const name = attrs.name?.trim();

    if (!name) {
      continue;
    }

    args[name] = parseDsmlParameterValue(match[2] ?? "", attrs);
  }

  return args;
}

function parseDsmlParameterValue(
  value: string,
  attrs: Record<string, string>,
): unknown {
  const text = decodeEntities(value).trim();

  if (attrs.string === "true") {
    return text;
  }

  return parseScalarValue(text);
}

function parseAttributes(value: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attributePattern = /([a-zA-Z_:-][\w:.-]*)\s*=\s*"([^"]*)"/g;

  for (const match of value.matchAll(attributePattern)) {
    const key = match[1];

    if (key) {
      attrs[key] = decodeEntities(match[2] ?? "");
    }
  }

  return attrs;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value.trim()) as unknown;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

function parseScalarValue(value: string): unknown {
  if (!value) {
    return "";
  }

  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)) {
    return Number(value);
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (value === "null") {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function resolveRecoveredToolName(
  rawName: string,
  tools: readonly ToolCallRecoveryTool[],
): string {
  const candidates = recoveredToolNameCandidates(rawName);
  const toolNames = tools.map((tool) => tool.name);

  for (const candidate of candidates) {
    if (toolNames.includes(candidate)) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    const lowerMatch = toolNames.filter(
      (toolName) => toolName.toLowerCase() === candidate.toLowerCase(),
    );

    if (lowerMatch.length === 1) {
      const match = lowerMatch[0];

      if (match) {
        return match;
      }
    }
  }

  for (const candidate of candidates) {
    const suffixMatches = toolNames.filter((toolName) =>
      toolName.endsWith(`__${candidate}`),
    );

    if (suffixMatches.length === 1) {
      const match = suffixMatches[0];

      if (match) {
        return match;
      }
    }
  }

  return candidates[0] ?? "unknown_tool";
}

function recoveredToolNameCandidates(rawName: string): string[] {
  const trimmed = rawName.trim();
  const withoutFunctionsPrefix = trimmed.replace(/^functions\./i, "");
  const afterLastDot = withoutFunctionsPrefix.includes(".")
    ? withoutFunctionsPrefix.slice(withoutFunctionsPrefix.lastIndexOf(".") + 1)
    : withoutFunctionsPrefix;
  const primary = sanitizeRecoveredIdentifier(withoutFunctionsPrefix);
  const dotted = sanitizeRecoveredIdentifier(afterLastDot);
  const raw = sanitizeRecoveredIdentifier(trimmed);

  return unique(
    [
      primary,
      ...recoveredToolAliases(primary),
      dotted,
      ...recoveredToolAliases(dotted),
      raw,
    ].filter(Boolean),
  );
}

function recoveredToolAliases(name: string): string[] {
  if (name === "read_file") {
    return ["read_text_file"];
  }

  if (name === "list_files" || name === "list_dir") {
    return ["list_directory"];
  }

  return [];
}

function recoveredToolCallId(
  call: RawRecoveredToolCall,
  index: number,
  toolName: string,
  usedIds: Set<string>,
): string {
  const source = call.idHint?.trim() || `${index}_${toolName}`;
  const base = `call_recovered_${sanitizeRecoveredIdentifier(source) || index}`.slice(0, 64);
  let candidate = base;
  let suffix = 2;

  while (usedIds.has(candidate)) {
    const suffixText = `_${suffix}`;

    candidate = `${base.slice(0, 64 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }

  usedIds.add(candidate);
  return candidate;
}

function sanitizeRecoveredIdentifier(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function stripTextSpans(content: string, spans: TextSpan[]): string {
  const orderedSpans = [...spans]
    .sort((left, right) => left.start - right.start)
    .reduce<TextSpan[]>((merged, span) => {
      const previous = merged[merged.length - 1];

      if (previous && span.start <= previous.end) {
        previous.end = Math.max(previous.end, span.end);
        return merged;
      }

      merged.push({ ...span });
      return merged;
    }, []);
  let result = "";
  let cursor = 0;

  for (const span of orderedSpans) {
    result += content.slice(cursor, span.start);
    cursor = Math.max(cursor, span.end);
  }

  result += content.slice(cursor);

  return result
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
