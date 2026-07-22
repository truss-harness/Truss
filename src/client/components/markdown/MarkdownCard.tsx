import { useState } from "react";
import type { ReactNode } from "react";
import { MaterialIcon } from "../MaterialIcon.tsx";

export interface MarkdownCardData {
  body: string;
  footer?: string;
  header?: string;
}

type InlineRenderer = (content: string) => ReactNode;

export function MarkdownCard({
  card,
  cardIndex,
  renderBody,
  renderInline,
}: {
  card: MarkdownCardData;
  cardIndex: number;
  renderBody(content: string): ReactNode;
  renderInline: InlineRenderer;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "done" | "error">("idle");
  const [downloadStatus, setDownloadStatus] = useState<"idle" | "done" | "error">("idle");
  const content = cardToText(card);
  const copyLabel =
    copyStatus === "done"
      ? "Contents copied"
      : copyStatus === "error"
        ? "Copy failed"
        : "Copy contents";
  const downloadLabel =
    downloadStatus === "done"
      ? "Contents downloaded"
      : downloadStatus === "error"
        ? "Download failed"
        : "Download contents";

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

  function handleDownload(): void {
    try {
      downloadText(content, `truss-card-${cardIndex + 1}.md`);
      setDownloadStatus("done");
    } catch {
      setDownloadStatus("error");
    } finally {
      window.setTimeout(() => setDownloadStatus("idle"), 1800);
    }
  }

  return (
    <section
      aria-label={card.header ? `Card: ${card.header}` : "Card"}
      className="truss-markdown-card"
    >
      <div className="truss-markdown-card-actions">
        <button
          aria-label={copyLabel}
          className="truss-markdown-card-action"
          onClick={() => void handleCopy()}
          title={copyLabel}
          type="button"
        >
          <MaterialIcon name={copyStatus === "done" ? "check" : "content_copy"} size={17} />
        </button>
        <button
          aria-label={downloadLabel}
          className="truss-markdown-card-action"
          onClick={handleDownload}
          title={downloadLabel}
          type="button"
        >
          <MaterialIcon name={downloadStatus === "done" ? "check" : "download"} size={17} />
        </button>
      </div>
      {card.header ? (
        <header className="truss-markdown-card-header">{renderInline(card.header)}</header>
      ) : null}
      <div className="truss-markdown-card-body">{renderBody(card.body)}</div>
      {card.footer ? (
        <footer className="truss-markdown-card-footer">{renderInline(card.footer)}</footer>
      ) : null}
    </section>
  );
}

function cardToText(card: MarkdownCardData): string {
  return [card.header, card.body.trim(), card.footer]
    .filter((part): part is string => Boolean(part?.trim()))
    .join("\n\n");
}

function downloadText(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noreferrer";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
