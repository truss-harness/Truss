import type { CommandTerminalLogEntry, CommandTerminalSummary } from "../../../shared/protocol.ts";
import { MaterialIcon } from "../MaterialIcon.tsx";

export function TerminalPanel({
  onClose,
  onKill,
  open,
  pendingKill,
  terminal,
}: {
  onClose(): void;
  onKill(terminal: CommandTerminalSummary): void;
  open: boolean;
  pendingKill: boolean;
  terminal: CommandTerminalSummary | null;
}) {
  if (!open || !terminal) {
    return null;
  }

  const canKill = terminal.status === "running";

  return (
    <aside className="fixed inset-y-0 right-0 z-[160] flex w-full max-w-[640px] flex-col border-l border-outline-variant bg-surface-container-lowest text-on-surface shadow-[0_0_48px_rgb(27_28_25/0.22)]">
      <header className="flex min-h-16 items-start gap-3 border-b border-outline-variant px-4 py-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm border border-outline-variant bg-surface-container-low text-primary">
          <MaterialIcon name="terminal" size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="min-w-0 truncate text-base font-semibold text-on-surface">
              {terminal.label || "Terminal"}
            </h2>
            <span className={terminalBadgeClass(terminal.status)}>
              {terminalStatusLabel(terminal.status)}
            </span>
          </div>
          <p className="mt-1 min-w-0 break-words font-mono text-xs text-on-surface-variant [overflow-wrap:anywhere]">
            {terminal.command}
          </p>
        </div>
        <button
          aria-label="Close terminal panel"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-sm border border-outline-variant bg-surface text-on-surface-variant transition hover:bg-surface-container hover:text-on-surface"
          onClick={onClose}
          type="button"
        >
          <MaterialIcon name="close" size={18} />
        </button>
      </header>

      <div className="grid gap-3 border-b border-outline-variant px-4 py-3 text-xs text-on-surface-variant">
        <div className="grid gap-1">
          <span className="font-semibold uppercase">Working directory</span>
          <span className="min-w-0 break-words font-mono [overflow-wrap:anywhere]">
            {terminal.workingDirectory || "Unavailable"}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>Started {formatDateTime(terminal.startedAt)}</span>
          <button
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-outline-variant bg-surface px-2 text-xs font-semibold text-on-surface-variant transition hover:bg-surface-container hover:text-error disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!canKill || pendingKill}
            onClick={() => onKill(terminal)}
            type="button"
          >
            <MaterialIcon name={pendingKill ? "sync" : "stop"} size={15} />
            {pendingKill ? "Killing" : "Kill"}
          </button>
        </div>
      </div>

      <div className="truss-message-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {terminal.log.length > 0 ? (
          <div className="grid gap-3">
            {terminal.log.map((entry, index) => (
              <TerminalLogEntryView entry={entry} key={`${entry.createdAt}:${index}`} />
            ))}
          </div>
        ) : (
          <p className="rounded-sm border border-outline-variant bg-surface px-3 py-3 text-sm text-on-surface-variant">
            No terminal output has been captured yet.
          </p>
        )}
      </div>
    </aside>
  );
}

function TerminalLogEntryView({ entry }: { entry: CommandTerminalLogEntry }) {
  return (
    <div className="grid gap-2 rounded-sm border border-outline-variant bg-surface px-3 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
        <span className={streamBadgeClass(entry.stream)}>{entry.stream}</span>
        <span className="text-on-surface-variant">{formatDateTime(entry.createdAt)}</span>
      </div>
      <pre className="truss-message-scrollbar max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-sm border border-outline-variant bg-surface-container-low px-3 py-2 font-mono text-xs leading-5 text-on-surface [overflow-wrap:anywhere]">
        {entry.text}
      </pre>
      {entry.guardVerdict ? (
        <div className="grid gap-1 rounded-sm border border-outline-variant bg-surface-container-low px-2 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className={guardBadgeClass(entry.guardVerdict.safetyLevel)}>
              {entry.guardVerdict.safetyLevel}
            </span>
            <span className="font-semibold text-on-surface">{entry.guardVerdict.tldr}</span>
          </div>
          <p className="leading-5 text-on-surface-variant">
            {entry.guardVerdict.safetyReasoning}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function streamBadgeClass(stream: CommandTerminalLogEntry["stream"]): string {
  const base = "rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase";

  if (stream === "stderr") {
    return `${base} bg-error-container text-error`;
  }

  if (stream === "stdin") {
    return `${base} bg-primary-container text-on-primary-container`;
  }

  if (stream === "system") {
    return `${base} bg-surface-container-high text-on-surface-variant`;
  }

  return `${base} bg-emerald-100 text-emerald-700`;
}

function guardBadgeClass(level: string): string {
  const base = "rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase";

  if (level === "dangerous") {
    return `${base} bg-error-container text-error`;
  }

  if (level === "risky") {
    return `${base} bg-amber-100 text-amber-800`;
  }

  return `${base} bg-emerald-100 text-emerald-700`;
}

function terminalStatusLabel(status: CommandTerminalSummary["status"]): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "killed":
      return "Killed";
    case "running":
      return "Running";
    case "timed_out":
      return "Timed out";
  }
}

function terminalBadgeClass(status: CommandTerminalSummary["status"]): string {
  const base = "shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase";

  if (status === "running") {
    return `${base} border border-outline-variant bg-surface-container-high text-on-surface-variant`;
  }

  if (status === "idle") {
    return `${base} bg-emerald-100 text-emerald-700`;
  }

  if (status === "timed_out") {
    return `${base} bg-amber-100 text-amber-800`;
  }

  return `${base} bg-surface-container-high text-on-surface-variant`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}
