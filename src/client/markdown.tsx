import { useState } from "react";
import type { ReactNode } from "react";
import { MaterialIcon } from "./components/MaterialIcon.tsx";
import {
  CalendarEntryInline,
  type CalendarEntry,
} from "./components/markdown/CalendarEntry.tsx";
import { KatexMath } from "./components/markdown/KatexMath.tsx";
import {
  MarkdownCard,
  type MarkdownCardData,
} from "./components/markdown/MarkdownCard.tsx";
import { MapBlock, type MarkdownMapLocation } from "./components/markdown/MapBlock.tsx";
import { PlantUmlDiagram } from "./components/markdown/PlantUmlDiagram.tsx";
import {
  MarkdownTable,
  type MarkdownTableData,
  SmartTable,
} from "./components/markdown/SmartTable.tsx";
import {
  MarkdownTimeline,
  type MarkdownTimelineData,
} from "./components/markdown/MarkdownTimeline.tsx";
import { defaultRichFeatureSettings } from "./rich-features.ts";
import type { RichFeatureSettingsSummary } from "../shared/protocol.ts";

type AlertKind = "note" | "tip" | "important" | "warning" | "caution";

type MarkdownBlock =
  | { type: "alert"; kind: AlertKind; content: string[] }
  | { type: "card"; card: MarkdownCardData }
  | { type: "code"; language: string; content: string }
  | { type: "heading"; level: 1 | 2 | 3; content: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "map"; location: MarkdownMapLocation }
  | { type: "math"; content: string }
  | { type: "table"; table: MarkdownTableData }
  | { type: "thematicBreak" }
  | { type: "timeline"; timeline: MarkdownTimelineData }
  | { type: "paragraph"; content: string };

type HighlightTokenType =
  | "plain"
  | "attr"
  | "comment"
  | "function"
  | "keyword"
  | "number"
  | "operator"
  | "punctuation"
  | "string"
  | "tag";

type HighlightToken = {
  type: HighlightTokenType;
  value: string;
};

const ALERT_META: Record<AlertKind, { icon: string; title: string }> = {
  caution: { icon: "report", title: "Caution" },
  important: { icon: "priority_high", title: "Important" },
  note: { icon: "info", title: "Note" },
  tip: { icon: "lightbulb", title: "Tip" },
  warning: { icon: "warning", title: "Warning" },
};

const CALENDAR_ENTRY_PATTERN = /^:calendar\[([^\]\n]{1,120})\]\{([^{}\n]{1,600})\}$/;
const CALENDAR_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MAP_ENTRY_PATTERN = /^:map\[([^\]\n]{1,120})\]\{([^{}\n]{1,420})\}$/;
const MAX_FOLLOW_UP_PROMPTS = 3;
const MAX_TIMELINE_ENTRIES = 16;

const COMMON_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "do",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "interface",
  "let",
  "new",
  "null",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "undefined",
  "var",
  "void",
  "while",
]);

const KEYWORDS_BY_LANGUAGE: Record<string, Set<string>> = {
  css: new Set([
    "auto",
    "block",
    "border-box",
    "flex",
    "grid",
    "inline",
    "none",
    "relative",
    "absolute",
    "solid",
    "transparent",
  ]),
  javascript: COMMON_KEYWORDS,
  json: new Set(["false", "null", "true"]),
  markdown: new Set(["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]),
  php: new Set([
    ...COMMON_KEYWORDS,
    "array",
    "echo",
    "final",
    "foreach",
    "namespace",
    "readonly",
    "use",
  ]),
  powershell: new Set(["begin", "catch", "else", "end", "foreach", "function", "if", "param", "process", "return", "switch", "try", "where"]),
  python: new Set([
    "and",
    "as",
    "async",
    "await",
    "break",
    "class",
    "continue",
    "def",
    "elif",
    "else",
    "except",
    "False",
    "finally",
    "for",
    "from",
    "if",
    "import",
    "in",
    "is",
    "lambda",
    "None",
    "not",
    "or",
    "pass",
    "raise",
    "return",
    "True",
    "try",
    "while",
    "with",
    "yield",
  ]),
  shell: new Set(["case", "do", "done", "elif", "else", "esac", "fi", "for", "function", "if", "in", "then", "while"]),
  sql: new Set(["and", "as", "by", "case", "create", "delete", "from", "group", "insert", "into", "join", "left", "limit", "not", "null", "on", "or", "order", "right", "select", "table", "update", "values", "where"]),
  typescript: COMMON_KEYWORDS,
  yaml: new Set(["false", "null", "true"]),
};

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: "shell",
  cjs: "javascript",
  htm: "html",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  ps1: "powershell",
  pwsh: "powershell",
  py: "python",
  sh: "shell",
  ts: "typescript",
  tsx: "typescript",
  yml: "yaml",
};

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  bash: "sh",
  css: "css",
  html: "html",
  javascript: "js",
  js: "js",
  json: "json",
  jsx: "jsx",
  markdown: "md",
  md: "md",
  php: "php",
  powershell: "ps1",
  ps1: "ps1",
  py: "py",
  python: "py",
  shell: "sh",
  sh: "sh",
  sql: "sql",
  text: "txt",
  ts: "ts",
  tsx: "tsx",
  typescript: "ts",
  xml: "xml",
  yaml: "yml",
  yml: "yml",
};

export function MarkdownView({
  richFeatures = defaultRichFeatureSettings,
  source,
}: {
  richFeatures?: RichFeatureSettingsSummary;
  source: string;
}) {
  const blocks = parseMarkdown(source, richFeatures);
  const renderInlineContent = (content: string) => renderInline(content, richFeatures);
  const renderBlockContent = (content: string) => (
    <MarkdownView richFeatures={richFeatures} source={content} />
  );

  return (
    <div className="markdown-flow">
      {blocks.map((block, index) => {
        if (block.type === "alert") {
          return <MarkdownAlert block={block} key={index} richFeatures={richFeatures} />;
        }

        if (block.type === "code") {
          if (richFeatures.plantUmlEnabled && isPlantUmlLanguage(block.language)) {
            return (
              <PlantUmlDiagram
                format={richFeatures.plantUmlFormat}
                key={index}
                serverUrl={richFeatures.plantUmlServerUrl}
                source={block.content}
              />
            );
          }

          return <CodeBlock blockIndex={index} content={block.content} key={index} language={block.language} />;
        }

        if (block.type === "card") {
          return (
            <MarkdownCard
              card={block.card}
              cardIndex={index}
              key={index}
              renderBody={renderBlockContent}
              renderInline={renderInlineContent}
            />
          );
        }

        if (block.type === "heading") {
          const Heading = `h${block.level}` as const;
          return (
            <Heading key={index} className="text-xl font-semibold text-on-surface">
              {renderInline(block.content, richFeatures)}
            </Heading>
          );
        }

        if (block.type === "list") {
          const List = block.ordered ? "ol" : "ul";
          const markerClass = block.ordered ? "list-decimal" : "list-disc";

          return (
            <List key={index} className={`${markerClass} space-y-1 pl-5`}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item, richFeatures)}</li>
              ))}
            </List>
          );
        }

        if (block.type === "map") {
          return <MapBlock key={index} location={block.location} />;
        }

        if (block.type === "math") {
          return <KatexMath display key={index} source={block.content} />;
        }

        if (block.type === "table") {
          return richFeatures.smartTablesEnabled ? (
            <SmartTable
              key={index}
              renderInline={renderInlineContent}
              table={block.table}
              tableIndex={index}
            />
          ) : (
            <MarkdownTable key={index} renderInline={renderInlineContent} table={block.table} />
          );
        }

        if (block.type === "thematicBreak") {
          return <hr className="truss-markdown-divider" key={index} />;
        }

        if (block.type === "timeline") {
          return (
            <MarkdownTimeline
              key={index}
              renderInline={renderInlineContent}
              timeline={block.timeline}
            />
          );
        }

        return <p key={index}>{renderInline(block.content, richFeatures)}</p>;
      })}
    </div>
  );
}

export function markdownContainsWideContent(
  source: string,
  richFeatures: RichFeatureSettingsSummary = defaultRichFeatureSettings,
): boolean {
  const lines = normalizeMarkdownSource(source).split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (parseMapBlock(line)) {
      return true;
    }

    if (parseTableBlock(lines, index)) {
      return true;
    }

    if (richFeatures.plantUmlEnabled && isCodeFence(line)) {
      const language = line.slice(3).trim().split(/\s+/)[0] ?? "";

      if (isPlantUmlLanguage(language)) {
        return true;
      }
    }
  }

  return false;
}

export function extractMarkdownFollowUps(
  source: string,
  richFeatures: RichFeatureSettingsSummary = defaultRichFeatureSettings,
): string[] {
  if (!richFeatures.followUpsEnabled) {
    return [];
  }

  const lines = normalizeMarkdownSource(source).split("\n");
  const prompts: string[] = [];
  let index = 0;

  while (index < lines.length && prompts.length < MAX_FOLLOW_UP_PROMPTS) {
    const block = parseFollowUpBlock(lines, index);

    if (block) {
      prompts.push(...block.prompts.slice(0, MAX_FOLLOW_UP_PROMPTS - prompts.length));
      index = block.nextIndex;
      continue;
    }

    index += 1;
  }

  return prompts;
}

export function stripMarkdownFollowUps(
  source: string,
  richFeatures: RichFeatureSettingsSummary = defaultRichFeatureSettings,
): string {
  if (!richFeatures.followUpsEnabled) {
    return source;
  }

  const lines = normalizeMarkdownSource(source).split("\n");
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const block = parseFollowUpBlock(lines, index);

    if (block) {
      index = block.nextIndex;
      continue;
    }

    output.push(lines[index] ?? "");
    index += 1;
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function MarkdownAlert({
  block,
  richFeatures,
}: {
  block: Extract<MarkdownBlock, { type: "alert" }>;
  richFeatures: RichFeatureSettingsSummary;
}) {
  const meta = ALERT_META[block.kind];

  return (
    <aside
      aria-label={meta.title}
      className={`truss-markdown-alert truss-markdown-alert-${block.kind}`}
      role="note"
    >
      <div className="truss-markdown-alert-title">
        <MaterialIcon name={meta.icon} size={17} />
        <span>{meta.title}</span>
      </div>
      {renderAlertContent(block.content, richFeatures)}
    </aside>
  );
}

function CodeBlock({
  blockIndex,
  content,
  language,
}: {
  blockIndex: number;
  content: string;
  language: string;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "done" | "error">("idle");
  const [saveStatus, setSaveStatus] = useState<"idle" | "done" | "error">("idle");
  const languageLabel = formatLanguageLabel(language);
  const languageClass = normalizeCodeLanguage(language).replace(/[^a-z0-9-]/g, "-") || "text";
  const copyLabel =
    copyStatus === "done" ? "Code copied" : copyStatus === "error" ? "Copy failed" : "Copy code";
  const saveLabel =
    saveStatus === "done" ? "Code saved" : saveStatus === "error" ? "Save failed" : "Save code";

  async function handleCopy(): Promise<void> {
    try {
      await copyTextToClipboard(content);
      setCopyStatus("done");
    } catch {
      setCopyStatus("error");
    } finally {
      window.setTimeout(() => setCopyStatus("idle"), 1800);
    }
  }

  function handleSave(): void {
    try {
      saveCodeBlock(content, language, blockIndex);
      setSaveStatus("done");
    } catch {
      setSaveStatus("error");
    } finally {
      window.setTimeout(() => setSaveStatus("idle"), 1800);
    }
  }

  return (
    <div className="truss-code-block">
      <div className="truss-code-header">
        <span className="truss-code-language">{languageLabel}</span>
        <div className="truss-code-actions">
          <button
            aria-label={copyLabel}
            className="truss-code-action"
            onClick={() => void handleCopy()}
            title={copyLabel}
            type="button"
          >
            <MaterialIcon name={copyStatus === "done" ? "check" : "content_copy"} size={16} />
          </button>
          <button
            aria-label={saveLabel}
            className="truss-code-action"
            onClick={handleSave}
            title={saveLabel}
            type="button"
          >
            <MaterialIcon name={saveStatus === "done" ? "check" : "download"} size={16} />
          </button>
        </div>
      </div>
      <pre className="truss-code-pre">
        <code className={`language-${languageClass}`}>{highlightCode(content, language)}</code>
      </pre>
    </div>
  );
}

function parseMarkdown(
  source: string,
  richFeatures: RichFeatureSettingsSummary,
): MarkdownBlock[] {
  const lines = normalizeMarkdownSource(source).split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const mathBlock = richFeatures.katexEnabled ? parseMathBlock(lines, index) : null;

    if (mathBlock) {
      blocks.push(mathBlock.block);
      index = mathBlock.nextIndex;
      continue;
    }

    if (isCodeFence(line)) {
      const language = line.slice(3).trim().split(/\s+/)[0] ?? "";
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !isCodeFence(lines[index] ?? "")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }

      blocks.push({ type: "code", language, content: codeLines.join("\n") });

      if (index < lines.length) {
        index += 1;
      }

      continue;
    }

    const mapBlock = parseMapBlock(line);

    if (mapBlock) {
      blocks.push(mapBlock);
      index += 1;
      continue;
    }

    const cardBlock = richFeatures.cardsEnabled ? parseCardBlock(lines, index) : null;

    if (cardBlock) {
      blocks.push(cardBlock.block);
      index = cardBlock.nextIndex;
      continue;
    }

    const followUpBlock = richFeatures.followUpsEnabled ? parseFollowUpBlock(lines, index) : null;

    if (followUpBlock) {
      index = followUpBlock.nextIndex;
      continue;
    }

    const timelineBlock = richFeatures.timelinesEnabled ? parseTimelineBlock(lines, index) : null;

    if (timelineBlock) {
      blocks.push(timelineBlock.block);
      index = timelineBlock.nextIndex;
      continue;
    }

    if (isThematicBreak(line)) {
      blocks.push({ type: "thematicBreak" });
      index += 1;
      continue;
    }

    const tableBlock = parseTableBlock(lines, index);

    if (tableBlock) {
      blocks.push(tableBlock.block);
      index = tableBlock.nextIndex;
      continue;
    }

    const alertBlock = richFeatures.calloutsEnabled
      ? parseAlertBlock(lines, index)
      : null;

    if (alertBlock) {
      blocks.push(alertBlock.block);
      index = alertBlock.nextIndex;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);

    if (heading) {
      const headingMarker = heading[1] ?? "#";

      blocks.push({
        type: "heading",
        level: headingMarker.length as 1 | 2 | 3,
        content: heading[2] ?? "",
      });
      index += 1;
      continue;
    }

    const listStart = matchListItem(line);

    if (listStart) {
      const ordered = listStart.ordered;
      const items: string[] = [];

      while (index < lines.length) {
        const item = matchListItem(lines[index] ?? "");

        if (!item || item.ordered !== ordered) {
          break;
        }

        items.push(item.content);
        index += 1;
      }

      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;

    while (
      index < lines.length &&
      lines[index]?.trim() &&
      !isBlockStart(lines[index] ?? "", lines[index + 1] ?? "", richFeatures)
    ) {
      paragraphLines.push(lines[index]?.trim() ?? "");
      index += 1;
    }

    blocks.push({ type: "paragraph", content: paragraphLines.join(" ") });
  }

  return blocks;
}

function normalizeMarkdownSource(source: string): string {
  return source
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function isCodeFence(line: string): boolean {
  return line.startsWith("```");
}

function isBlockStart(
  line: string,
  nextLine: string,
  richFeatures: RichFeatureSettingsSummary,
): boolean {
  return (
    isCodeFence(line) ||
    Boolean(richFeatures.katexEnabled && parseMathBlock([line, nextLine], 0)) ||
    Boolean(parseMapBlock(line)) ||
    Boolean(richFeatures.cardsEnabled && isCardStart(line)) ||
    Boolean(richFeatures.followUpsEnabled && isFollowUpStart(line)) ||
    Boolean(richFeatures.timelinesEnabled && isTimelineStart(line)) ||
    isThematicBreak(line) ||
    Boolean(parseTableBlock([line, nextLine], 0)) ||
    Boolean(richFeatures.calloutsEnabled && isAlertStart(line)) ||
    /^(#{1,3})\s+/.test(line) ||
    Boolean(matchListItem(line))
  );
}

function isCardStart(line: string): boolean {
  return /^:::\s*card(?:\s+.*)?$/i.test(line.trim());
}

function isCardEnd(line: string): boolean {
  return line.trim() === ":::";
}

function isFollowUpStart(line: string): boolean {
  return /^:::\s*follow-?ups?\s*$/i.test(line.trim());
}

function isFollowUpEnd(line: string): boolean {
  return line.trim() === ":::";
}

function isTimelineStart(line: string): boolean {
  return /^:::\s*timeline(?:\s+.*)?$/i.test(line.trim());
}

function isTimelineEnd(line: string): boolean {
  return line.trim() === ":::";
}

function isThematicBreak(line: string): boolean {
  const trimmed = line.trim();

  return /^-{3,}$/.test(trimmed) || /^\*{3,}$/.test(trimmed);
}

function isAlertStart(line: string): boolean {
  return /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*>?\s*/i.test(line);
}

function parseMathBlock(
  lines: string[],
  index: number,
): { block: Extract<MarkdownBlock, { type: "math" }>; nextIndex: number } | null {
  const line = lines[index]?.trim() ?? "";
  const inlineMatch = line.match(/^\$\$([\s\S]+)\$\$$/);

  if (inlineMatch) {
    return {
      block: { type: "math", content: inlineMatch[1]?.trim() ?? "" },
      nextIndex: index + 1,
    };
  }

  if (line !== "$$") {
    return null;
  }

  const content: string[] = [];
  let cursor = index + 1;

  while (cursor < lines.length && lines[cursor]?.trim() !== "$$") {
    content.push(lines[cursor] ?? "");
    cursor += 1;
  }

  if (cursor >= lines.length) {
    return null;
  }

  return {
    block: { type: "math", content: content.join("\n").trim() },
    nextIndex: cursor + 1,
  };
}

function parseMapBlock(line: string): Extract<MarkdownBlock, { type: "map" }> | null {
  const match = line.trim().match(MAP_ENTRY_PATTERN);

  if (!match) {
    return null;
  }

  const title = normalizeDirectiveText(match[1] ?? "", 120);
  const attributes = parseDirectiveAttributes(match[2] ?? "");
  const lat = Number(attributes?.get("lat"));
  const lng = Number(attributes?.get("lng"));
  const zoomValue = Number(attributes?.get("zoom") ?? 13);
  const location = normalizeDirectiveText(attributes?.get("location") ?? "", 120);

  if (
    !title ||
    !attributes ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  return {
    type: "map",
    location: {
      lat,
      lng,
      ...(location ? { location } : {}),
      title,
      zoom: Number.isFinite(zoomValue) ? Math.max(1, Math.min(18, zoomValue)) : 13,
    },
  };
}

function parseCardBlock(
  lines: string[],
  index: number,
): { block: Extract<MarkdownBlock, { type: "card" }>; nextIndex: number } | null {
  const firstLine = lines[index]?.trim() ?? "";
  const match = firstLine.match(/^:::\s*card(?:\s+(.*))?$/i);

  if (!match) {
    return null;
  }

  const rawAttributes = match[1]?.trim() ?? "";
  const attributes = rawAttributes
    ? parseDirectiveAttributes(rawAttributes)
    : new Map<string, string>();

  if (!attributes) {
    return null;
  }

  const content: string[] = [];
  let cursor = index + 1;

  while (cursor < lines.length && !isCardEnd(lines[cursor] ?? "")) {
    content.push(lines[cursor] ?? "");
    cursor += 1;
  }

  if (cursor >= lines.length) {
    return null;
  }

  const body = trimBlankLines(content).join("\n").trim();

  if (!body) {
    return null;
  }

  const header = normalizeDirectiveText(
    attributes.get("header") ?? attributes.get("title") ?? "",
    120,
  );
  const footer = normalizeDirectiveText(attributes.get("footer") ?? "", 180);

  return {
    block: {
      type: "card",
      card: {
        body,
        ...(footer ? { footer } : {}),
        ...(header ? { header } : {}),
      },
    },
    nextIndex: cursor + 1,
  };
}

function parseFollowUpBlock(
  lines: string[],
  index: number,
): { nextIndex: number; prompts: string[] } | null {
  if (!isFollowUpStart(lines[index] ?? "")) {
    return null;
  }

  const prompts: string[] = [];
  let cursor = index + 1;

  while (cursor < lines.length && !isFollowUpEnd(lines[cursor] ?? "")) {
    const prompt = normalizeFollowUpLine(lines[cursor] ?? "");

    if (prompt && prompts.length < MAX_FOLLOW_UP_PROMPTS) {
      prompts.push(prompt);
    }

    cursor += 1;
  }

  if (cursor >= lines.length || prompts.length === 0) {
    return null;
  }

  return {
    nextIndex: cursor + 1,
    prompts,
  };
}

function parseTimelineBlock(
  lines: string[],
  index: number,
): { block: Extract<MarkdownBlock, { type: "timeline" }>; nextIndex: number } | null {
  const firstLine = lines[index]?.trim() ?? "";
  const match = firstLine.match(/^:::\s*timeline(?:\s+(.*))?$/i);

  if (!match) {
    return null;
  }

  const rawAttributes = match[1]?.trim() ?? "";
  const attributes = rawAttributes
    ? parseDirectiveAttributes(rawAttributes)
    : new Map<string, string>();

  if (!attributes) {
    return null;
  }

  const entries: MarkdownTimelineData["entries"] = [];
  let cursor = index + 1;

  while (cursor < lines.length && !isTimelineEnd(lines[cursor] ?? "")) {
    const line = lines[cursor] ?? "";

    if (line.trim()) {
      const entry = parseTimelineEntry(line);

      if (!entry) {
        return null;
      }

      if (entries.length < MAX_TIMELINE_ENTRIES) {
        entries.push(entry);
      }
    }

    cursor += 1;
  }

  if (cursor >= lines.length || entries.length === 0) {
    return null;
  }

  const title = normalizeDirectiveText(
    attributes.get("title") ?? attributes.get("header") ?? "",
    120,
  );

  return {
    block: {
      type: "timeline",
      timeline: {
        entries,
        ...(title ? { title } : {}),
      },
    },
    nextIndex: cursor + 1,
  };
}

function parseTimelineEntry(line: string): MarkdownTimelineData["entries"][number] | null {
  const content = line.trim().replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "");

  if (!content) {
    return null;
  }

  const attributes = parseDirectiveAttributes(content);

  if (attributes) {
    const date = normalizeDirectiveText(
      attributes.get("date") ?? attributes.get("time") ?? "",
      80,
    );
    const title = normalizeDirectiveText(
      attributes.get("title") ?? attributes.get("label") ?? "",
      120,
    );
    const description = normalizeDirectiveText(
      attributes.get("description") ?? attributes.get("detail") ?? attributes.get("body") ?? "",
      240,
    );
    const icon = normalizeTimelineIcon(attributes.get("icon") ?? "");

    if (!date || !title) {
      return null;
    }

    return {
      date,
      ...(description ? { description } : {}),
      ...(icon ? { icon } : {}),
      title,
    };
  }

  const parts = content.split(/\s+\|\s+/).map((part) => normalizeDirectiveText(part, 240));
  const [date, title, description, iconSource] = parts;

  if (!date || !title) {
    return null;
  }

  const icon = normalizeTimelineIcon(iconSource ?? "");

  return {
    date: date.slice(0, 80),
    ...(description ? { description } : {}),
    ...(icon ? { icon } : {}),
    title: title.slice(0, 120),
  };
}

function parseTableBlock(
  lines: string[],
  index: number,
): { block: Extract<MarkdownBlock, { type: "table" }>; nextIndex: number } | null {
  const headerLine = lines[index] ?? "";
  const separatorLine = lines[index + 1] ?? "";

  if (!isPotentialTableRow(headerLine)) {
    return null;
  }

  const headers = parseTableRow(headerLine);
  const alignments = parseTableSeparator(separatorLine);

  if (!headers.length || !alignments || alignments.length < headers.length) {
    return null;
  }

  const rows: string[][] = [];
  let cursor = index + 2;

  while (cursor < lines.length && isPotentialTableRow(lines[cursor] ?? "")) {
    rows.push(normalizeTableRow(parseTableRow(lines[cursor] ?? ""), headers.length));
    cursor += 1;
  }

  return {
    block: {
      type: "table",
      table: {
        alignments: alignments.slice(0, headers.length),
        headers,
        rows,
      },
    },
    nextIndex: cursor,
  };
}

function isPotentialTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes("|") && !trimmed.startsWith(":");
}

function parseTableRow(line: string): string[] {
  let row = line.trim();

  if (row.startsWith("|")) {
    row = row.slice(1);
  }

  if (row.endsWith("|")) {
    row = row.slice(0, -1);
  }

  const cells: string[] = [];
  let cell = "";
  let escaped = false;

  for (const character of row) {
    if (escaped) {
      cell += character === "|" ? character : `\\${character}`;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (character === "|") {
      cells.push(normalizeTableCell(cell));
      cell = "";
      continue;
    }

    cell += character;
  }

  cells.push(normalizeTableCell(escaped ? `${cell}\\` : cell));
  return cells;
}

function parseTableSeparator(
  line: string,
): MarkdownTableData["alignments"] | null {
  if (!isPotentialTableRow(line)) {
    return null;
  }

  const cells = parseTableRow(line);
  const alignments: MarkdownTableData["alignments"] = [];

  for (const cell of cells) {
    const marker = cell.trim();

    if (!/^:?-{3,}:?$/.test(marker)) {
      return null;
    }

    if (marker.startsWith(":") && marker.endsWith(":")) {
      alignments.push("center");
    } else if (marker.endsWith(":")) {
      alignments.push("right");
    } else {
      alignments.push("left");
    }
  }

  return alignments;
}

function normalizeTableRow(row: string[], cellCount: number): string[] {
  return Array.from({ length: cellCount }, (_value, index) => row[index] ?? "");
}

function normalizeTableCell(value: string): string {
  return value.replace(/\\\|/g, "|").trim();
}

function trimBlankLines(lines: string[]): string[] {
  const next = [...lines];

  while (next.length && !next[0]?.trim()) {
    next.shift();
  }

  while (next.length && !next[next.length - 1]?.trim()) {
    next.pop();
  }

  return next;
}

function parseAlertBlock(
  lines: string[],
  index: number,
): { block: Extract<MarkdownBlock, { type: "alert" }>; nextIndex: number } | null {
  const firstLine = lines[index] ?? "";
  const match = firstLine.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*>?\s*(.*)$/i);

  if (!match) {
    return null;
  }

  const kind = (match[1] ?? "note").toLowerCase() as AlertKind;
  const content: string[] = [];
  const firstContent = match[2] ?? "";

  if (firstContent.trim()) {
    content.push(firstContent.trim());
  }

  index += 1;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.startsWith(">") || isAlertStart(line)) {
      break;
    }

    content.push(line.replace(/^>\s?/, ""));
    index += 1;
  }

  while (content.length && !content[0]?.trim()) {
    content.shift();
  }

  while (content.length && !content[content.length - 1]?.trim()) {
    content.pop();
  }

  return { block: { type: "alert", kind, content }, nextIndex: index };
}

function matchListItem(line: string): { content: string; ordered: boolean } | null {
  const match = line.match(/^\s*((?:[-*+])|\d+[.)])\s+(.*)$/);

  if (!match) {
    return null;
  }

  return {
    content: match[2] ?? "",
    ordered: /^\d/.test(match[1] ?? ""),
  };
}

function renderAlertContent(
  lines: string[],
  richFeatures: RichFeatureSettingsSummary,
): ReactNode {
  const paragraphs: string[] = [];
  let buffer: string[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      if (buffer.length) {
        paragraphs.push(buffer.join(" "));
        buffer = [];
      }

      continue;
    }

    buffer.push(line.trim());
  }

  if (buffer.length) {
    paragraphs.push(buffer.join(" "));
  }

  if (!paragraphs.length) {
    return null;
  }

  return (
    <div className="truss-markdown-alert-content">
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{renderInline(paragraph, richFeatures)}</p>
      ))}
    </div>
  );
}

function renderInline(
  content: string,
  richFeatures: RichFeatureSettingsSummary,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const inlinePattern = inlinePatternForFeatures(richFeatures);
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = inlinePattern.exec(content)) !== null) {
    if (match.index > cursor) {
      nodes.push(content.slice(cursor, match.index));
    }

    const part = match[0];

    if (part.startsWith(":calendar[")) {
      const entry = parseCalendarEntry(part);

      nodes.push(
        entry ? (
          <CalendarEntryInline
            actions={{
              googleCalendar: richFeatures.smartEventsGoogleCalendarEnabled,
              ics: richFeatures.smartEventsIcsEnabled,
              outlookCalendar: richFeatures.smartEventsOutlookCalendarEnabled,
            }}
            entry={entry}
            key={`inline-${match.index}`}
          />
        ) : (
          part
        ),
      );
    } else if (richFeatures.katexEnabled && part.startsWith("$") && part.endsWith("$")) {
      nodes.push(
        <KatexMath
          display={false}
          key={`inline-${match.index}`}
          source={part.slice(1, -1)}
        />,
      );
    } else if (part.startsWith("`") && part.endsWith("`")) {
      nodes.push(
        <code
          className="rounded bg-surface-container-high px-1.5 py-0.5 font-mono text-[0.9em]"
          key={`inline-${match.index}`}
        >
          {part.slice(1, -1)}
        </code>,
      );
    } else if (part.startsWith("**") && part.endsWith("**")) {
      nodes.push(<strong key={`inline-${match.index}`}>{part.slice(2, -2)}</strong>);
    } else {
      const link = part.match(/^\[([^\]\n]+)\]\(([^) \t\n]+)\)$/);
      const autoLink = part.match(/^<((?:https?|mailto):[^<>\s]+)>$/i);
      const rawUrl = autoLink?.[1] ?? (isRawMarkdownUrl(part) ? part : null);
      const safeHref = link
        ? sanitizeMarkdownUrl(link[2] ?? "")
        : rawUrl
          ? sanitizeMarkdownUrl(rawUrl)
          : null;

      if (link && safeHref) {
        nodes.push(
          <a href={safeHref} key={`inline-${match.index}`} rel="noreferrer noopener" target="_blank">
            {link[1]}
          </a>,
        );
      } else if (link) {
        nodes.push(
          <span className="truss-markdown-unsafe-link" key={`inline-${match.index}`}>
            {link[1]}
          </span>,
        );
      } else if (rawUrl && safeHref) {
        nodes.push(
          <a href={safeHref} key={`inline-${match.index}`} rel="noreferrer noopener" target="_blank">
            {rawUrl}
          </a>,
        );
      } else {
        nodes.push(part);
      }
    }

    cursor = match.index + part.length;
  }

  if (cursor < content.length) {
    nodes.push(content.slice(cursor));
  }

  return nodes;
}

function inlinePatternForFeatures(richFeatures: RichFeatureSettingsSummary): RegExp {
  const parts = [
    "`[^`\\n]+`",
    "\\*\\*[^*\\n]+?\\*\\*",
    "\\[[^\\]\\n]+\\]\\([^) \\t\\n]+\\)",
    "<(?:https?|mailto):[^<>\\s]+>",
    "(?:https?://|mailto:)[^\\s<>)\\]]+",
  ];

  if (richFeatures.smartEventsEnabled) {
    parts.unshift(":calendar\\[[^\\]\\n]{1,120}\\]\\{[^{}\\n]{1,600}\\}");
  }

  if (richFeatures.katexEnabled) {
    parts.unshift("\\$(?!\\$)(?:\\\\.|[^$\\\\\\n]){1,500}\\$");
  }

  return new RegExp(`(${parts.join("|")})`, "g");
}

function isRawMarkdownUrl(value: string): boolean {
  return /^(?:https?:\/\/|mailto:)[^\s<>\]]+$/i.test(value);
}

function parseCalendarEntry(part: string): CalendarEntry | null {
  const match = part.match(CALENDAR_ENTRY_PATTERN);

  if (!match) {
    return null;
  }

  const title = normalizeDirectiveText(match[1] ?? "", 120);
  const attributes = parseDirectiveAttributes(match[2] ?? "");
  const date = normalizeDirectiveText(attributes?.get("date") ?? "", 20);
  const time = normalizeDirectiveText(attributes?.get("time") ?? "", 8);
  const end = normalizeDirectiveText(attributes?.get("end") ?? "", 8);
  const description = normalizeDirectiveText(attributes?.get("description") ?? "", 220);
  const location = normalizeDirectiveText(attributes?.get("location") ?? "", 120);

  if (!title || !attributes || !isValidCalendarDate(date)) {
    return null;
  }

  if ((time && !CALENDAR_TIME_PATTERN.test(time)) || (end && !CALENDAR_TIME_PATTERN.test(end))) {
    return null;
  }

  return {
    date,
    ...(description ? { description } : {}),
    ...(time ? { time } : {}),
    ...(end ? { end } : {}),
    ...(location ? { location } : {}),
    title,
  };
}

function parseDirectiveAttributes(rawAttributes: string): Map<string, string> | null {
  const attributes = new Map<string, string>();
  let cursor = 0;

  while (cursor < rawAttributes.length) {
    const whitespace = rawAttributes.slice(cursor).match(/^\s+/);

    if (whitespace) {
      cursor += whitespace[0].length;
      continue;
    }

    const attribute = rawAttributes.slice(cursor).match(/^([A-Za-z][A-Za-z0-9-]*)="([^"\n]*)"/);

    if (!attribute) {
      return null;
    }

    attributes.set((attribute[1] ?? "").toLowerCase(), attribute[2] ?? "");
    cursor += attribute[0].length;
  }

  return attributes;
}

function normalizeDirectiveText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeTimelineIcon(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function normalizeFollowUpLine(value: string): string {
  return value
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function isValidCalendarDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function sanitizeMarkdownUrl(rawUrl: string): string | null {
  const url = rawUrl.trim();

  if (!url || /[\u0000-\u001F\u007F]/.test(url)) {
    return null;
  }

  const compactLower = url.replace(/\s+/g, "").toLowerCase();

  if (/^(?:data|javascript|vbscript):/.test(compactLower)) {
    return null;
  }

  const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();

  if (scheme) {
    return scheme === "http" || scheme === "https" || scheme === "mailto" ? url : null;
  }

  if (url.startsWith("\\") || url.startsWith("//")) {
    return null;
  }

  return url;
}

export function highlightCode(content: string, language: string): ReactNode[] {
  return tokenizeCode(content, normalizeCodeLanguage(language)).map((token, index) => {
    if (token.type === "plain") {
      return token.value;
    }

    return (
      <span className={`truss-code-token truss-code-token-${token.type}`} key={index}>
        {token.value}
      </span>
    );
  });
}

function tokenizeCode(code: string, language: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  const keywords = KEYWORDS_BY_LANGUAGE[language] ?? COMMON_KEYWORDS;
  let cursor = 0;

  while (cursor < code.length) {
    const rest = code.slice(cursor);
    const token =
      matchWhitespace(rest) ??
      matchComment(rest, language) ??
      matchString(rest) ??
      matchHtmlTag(rest, language) ??
      matchNumber(rest) ??
      matchIdentifier(rest, code, cursor, keywords) ??
      matchOperator(rest) ??
      matchPunctuation(rest);

    if (token) {
      tokens.push(token);
      cursor += token.value.length;
      continue;
    }

    tokens.push({ type: "plain", value: rest[0] ?? "" });
    cursor += 1;
  }

  return mergeAdjacentTokens(tokens);
}

function matchWhitespace(rest: string): HighlightToken | null {
  const match = rest.match(/^\s+/);
  return match ? { type: "plain", value: match[0] } : null;
}

function matchComment(rest: string, language: string): HighlightToken | null {
  const htmlComment = rest.match(/^<!--[\s\S]*?-->/);

  if (htmlComment) {
    return { type: "comment", value: htmlComment[0] };
  }

  const blockComment = rest.match(/^\/\*[\s\S]*?\*\//);

  if (blockComment) {
    return { type: "comment", value: blockComment[0] };
  }

  if (["python", "powershell", "shell", "yaml"].includes(language)) {
    const hashComment = rest.match(/^#[^\n]*/);

    if (hashComment) {
      return { type: "comment", value: hashComment[0] };
    }
  }

  if (!["python", "powershell", "shell", "yaml"].includes(language)) {
    const slashComment = rest.match(/^\/\/[^\n]*/);

    if (slashComment) {
      return { type: "comment", value: slashComment[0] };
    }
  }

  return null;
}

function matchString(rest: string): HighlightToken | null {
  const stringMatch =
    rest.match(/^"(?:\\[\s\S]|[^"\\])*"/) ??
    rest.match(/^'(?:\\[\s\S]|[^'\\])*'/) ??
    rest.match(/^`(?:\\[\s\S]|[^`\\])*`/);

  return stringMatch ? { type: "string", value: stringMatch[0] } : null;
}

function matchHtmlTag(rest: string, language: string): HighlightToken | null {
  if (!["html", "xml"].includes(language)) {
    return null;
  }

  const tag = rest.match(/^<\/?[A-Za-z][^>\n]*?>/);
  return tag ? { type: "tag", value: tag[0] } : null;
}

function matchNumber(rest: string): HighlightToken | null {
  const number = rest.match(/^-?\b(?:0x[\da-f]+|\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?\b/i);
  return number ? { type: "number", value: number[0] } : null;
}

function matchIdentifier(
  rest: string,
  fullCode: string,
  cursor: number,
  keywords: Set<string>,
): HighlightToken | null {
  const identifier = rest.match(/^[A-Za-z_$][\w$-]*/);

  if (!identifier) {
    return null;
  }

  const value = identifier[0];
  const previousCharacter = fullCode[cursor - 1] ?? "";
  const nextCharacter = fullCode.slice(cursor + value.length).match(/^\s*(.)/)?.[1] ?? "";

  if (keywords.has(value) || keywords.has(value.toLowerCase())) {
    return { type: "keyword", value };
  }

  if (previousCharacter === ".") {
    return { type: "attr", value };
  }

  if (nextCharacter === "(") {
    return { type: "function", value };
  }

  return { type: "plain", value };
}

function matchOperator(rest: string): HighlightToken | null {
  const operator = rest.match(/^(?:=>|===|!==|==|!=|<=|>=|\+\+|--|\|\||&&|\?\?|\+=|-=|\*=|\/=|%=|=|\+|-|\*|\/|%|!|<|>|\?|:)/);
  return operator ? { type: "operator", value: operator[0] } : null;
}

function matchPunctuation(rest: string): HighlightToken | null {
  const punctuation = rest.match(/^[{}\[\]().,;]/);
  return punctuation ? { type: "punctuation", value: punctuation[0] } : null;
}

function mergeAdjacentTokens(tokens: HighlightToken[]): HighlightToken[] {
  const merged: HighlightToken[] = [];

  for (const token of tokens) {
    const previous = merged[merged.length - 1];

    if (previous?.type === token.type) {
      previous.value += token.value;
    } else {
      merged.push({ ...token });
    }
  }

  return merged;
}

function normalizeCodeLanguage(language: string): string {
  const rawLanguage = sanitizeLanguageSegment(language);
  return LANGUAGE_ALIASES[rawLanguage] ?? rawLanguage ?? "text";
}

function isPlantUmlLanguage(language: string): boolean {
  const normalized = normalizeCodeLanguage(language);
  return normalized === "plantuml" || normalized === "puml";
}

function sanitizeLanguageSegment(language: string): string {
  return language.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9+#.-]/g, "") ?? "";
}

function formatLanguageLabel(language: string): string {
  const normalized = normalizeCodeLanguage(language);

  if (!normalized) {
    return "text";
  }

  return normalized.replace(/-/g, " ");
}

function saveCodeBlock(content: string, language: string, blockIndex: number): void {
  const extension = codeBlockExtension(language);
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `truss-codeblock-${blockIndex + 1}.${extension}`;
  anchor.rel = "noreferrer";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function codeBlockExtension(language: string): string {
  const rawLanguage = sanitizeLanguageSegment(language);
  const normalized = normalizeCodeLanguage(language);
  const extension = LANGUAGE_EXTENSIONS[rawLanguage] ?? LANGUAGE_EXTENSIONS[normalized] ?? "txt";

  return extension.replace(/[^a-z0-9]/g, "") || "txt";
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");

  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();

  try {
    document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}
