import { renderToString } from "katex";

export function KatexMath({
  display,
  source,
}: {
  display: boolean;
  source: string;
}) {
  const rendered = renderMath(source, display);

  if (!rendered.ok) {
    return display ? (
      <pre className="truss-katex-error">{source}</pre>
    ) : (
      <code className="truss-katex-error-inline">{source}</code>
    );
  }

  const className = display ? "truss-katex-display" : "truss-katex-inline";

  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: rendered.html }}
    />
  );
}

function renderMath(
  source: string,
  display: boolean,
): { html: string; ok: true } | { ok: false } {
  try {
    return {
      html: renderToString(source, {
        displayMode: display,
        output: "mathml",
        strict: "ignore",
        throwOnError: false,
      }),
      ok: true,
    };
  } catch {
    return { ok: false };
  }
}
