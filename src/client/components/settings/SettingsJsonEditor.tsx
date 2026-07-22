import { useRef } from "react";
import type { UIEvent } from "react";

import { highlightCode } from "../../markdown.tsx";

export function JsonEditor({
  ariaLabel,
  autoFocus = false,
  className = "",
  onChange,
  onFocus,
  showLineNumbers = false,
  value,
}: {
  ariaLabel: string;
  autoFocus?: boolean;
  className?: string;
  onChange(value: string): void;
  onFocus?: () => void;
  showLineNumbers?: boolean;
  value: string;
}) {
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const lineNumbersRef = useRef<HTMLPreElement | null>(null);
  const lineNumbers = showLineNumbers
    ? value
        .split(/\r\n|\r|\n/)
        .map((_, index) => String(index + 1))
        .join("\n")
    : "";

  function syncHighlightScroll(event: UIEvent<HTMLTextAreaElement>): void {
    const highlight = highlightRef.current;
    const lineNumbersElement = lineNumbersRef.current;

    if (highlight) {
      highlight.scrollLeft = event.currentTarget.scrollLeft;
      highlight.scrollTop = event.currentTarget.scrollTop;
    }

    if (lineNumbersElement) {
      lineNumbersElement.scrollTop = event.currentTarget.scrollTop;
    }
  }

  return (
    <div
      className={[
        "truss-json-editor",
        showLineNumbers ? "truss-json-editor-with-lines" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {showLineNumbers ? (
        <pre
          aria-hidden="true"
          className="truss-json-editor-line-numbers"
          ref={lineNumbersRef}
        >
          {lineNumbers}
        </pre>
      ) : null}
      <pre aria-hidden="true" className="truss-json-editor-highlight" ref={highlightRef}>
        <code className="language-json">{highlightCode(value, "json")}</code>
      </pre>
      <textarea
        aria-label={ariaLabel}
        className="truss-json-editor-input"
        data-autofocus={autoFocus ? "true" : undefined}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onScroll={syncHighlightScroll}
        spellCheck={false}
        value={value}
        wrap="off"
      />
    </div>
  );
}

