import type { ConnectionState } from "../types.ts";

export function StatusPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: ConnectionState;
}) {
  const toneClass =
    tone === "open"
      ? "bg-secondary-container text-on-secondary-container"
      : tone === "closed"
        ? "bg-error-container text-on-error-container"
        : "bg-surface-container text-on-surface-variant";

  return (
    <div className="rounded border border-outline-variant bg-surface-container-lowest p-3">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-on-surface-variant">
        {label}
      </p>
      <p className={`mt-2 truncate rounded px-2.5 py-1 text-xs font-medium ${toneClass}`}>
        {value}
      </p>
    </div>
  );
}
