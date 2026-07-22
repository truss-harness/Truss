import type { ReactNode } from "react";
import { MaterialIcon } from "../MaterialIcon.tsx";

export interface MarkdownTimelineEntry {
  date: string;
  description?: string;
  icon?: string;
  title: string;
}

export interface MarkdownTimelineData {
  entries: MarkdownTimelineEntry[];
  title?: string;
}

type InlineRenderer = (content: string) => ReactNode;

export function MarkdownTimeline({
  renderInline,
  timeline,
}: {
  renderInline: InlineRenderer;
  timeline: MarkdownTimelineData;
}) {
  const title = timeline.title;
  const timelineClassName = title
    ? "truss-markdown-timeline truss-markdown-timeline--card"
    : "truss-markdown-timeline";

  return (
    <section
      aria-label={title ? `Timeline: ${title}` : "Timeline"}
      className={timelineClassName}
    >
      {title ? (
        <header className="truss-markdown-timeline-header">
          <MaterialIcon name="timeline" size={18} />
          <span>{renderInline(title)}</span>
        </header>
      ) : null}
      <ol className="truss-markdown-timeline-list">
        {timeline.entries.map((entry, index) => (
          <li className="truss-markdown-timeline-entry" key={`${entry.date}-${entry.title}-${index}`}>
            <span className="truss-markdown-timeline-marker">
              <MaterialIcon fill name={entry.icon ?? "radio_button_checked"} size={15} />
            </span>
            <div className="truss-markdown-timeline-content">
              <span className="truss-markdown-timeline-date">{renderInline(entry.date)}</span>
              <span className="truss-markdown-timeline-title">{renderInline(entry.title)}</span>
              {entry.description ? (
                <span className="truss-markdown-timeline-description">
                  {renderInline(entry.description)}
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
