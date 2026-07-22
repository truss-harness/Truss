import type { ChatSubAgentStatus, RichFeatureSettingsSummary } from "../../../shared/protocol.ts";
import { MaterialIcon } from "../MaterialIcon.tsx";
import { ChatTranscript } from "./ChatTranscript.tsx";
import { formatMessageTimestamp, formatThoughtDuration } from "./chat-utils.ts";
import type { ChatUiMessage } from "./types.ts";

export interface SubAgentPanelSession {
  completedAt?: string;
  elapsedMs?: number;
  messages: ChatUiMessage[];
  modelId?: string;
  parentSessionId?: string;
  startedAt?: string;
  status: ChatSubAgentStatus;
  subSessionId: string;
  task: string;
  toolTurnCount?: number;
}

export function SubAgentPanel({
  onClose,
  open,
  richFeatures,
  session,
}: {
  onClose(): void;
  open: boolean;
  richFeatures: RichFeatureSettingsSummary;
  session: SubAgentPanelSession | null;
}) {
  if (!open || !session) {
    return null;
  }

  return (
    <aside
      aria-label="Sub-agent transcript"
      className="fixed inset-0 z-160 flex justify-end bg-on-surface/15 text-on-surface"
    >
      <div className="flex h-full w-full min-w-0 flex-col border-l border-outline-variant bg-surface shadow-[0_20px_70px_rgb(27_28_25/0.24)] sm:w-[420px]">
        <header className="shrink-0 border-b border-outline-variant bg-surface-container-low px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <MaterialIcon className="shrink-0 text-primary" name="smart_toy" size={20} />
                <h2 className="truncate text-sm font-semibold text-primary">Sub-agent</h2>
                <span className={statusBadgeClass(session.status)}>
                  {session.status}
                </span>
              </div>
              <p className="mt-2 max-h-24 overflow-y-auto text-sm leading-5 text-on-surface">
                {session.task}
              </p>
            </div>
            <button
              aria-label="Close sub-agent panel"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-sm text-on-surface-variant transition hover:bg-surface-container hover:text-primary focus-visible:bg-surface-container focus-visible:text-primary focus-visible:outline-none"
              onClick={onClose}
              title="Close"
              type="button"
            >
              <MaterialIcon name="close" size={19} />
            </button>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs leading-5 text-on-surface-variant">
            <SubAgentMetric label="Model" value={session.modelId ?? "Unavailable"} />
            <SubAgentMetric label="Tool turns" value={formatToolTurns(session.toolTurnCount)} />
            <SubAgentMetric label="Elapsed" value={formatElapsed(session.elapsedMs)} />
            <SubAgentMetric label="Started" value={formatTimestamp(session.startedAt)} />
          </dl>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ChatTranscript
            disabled
            messages={session.messages}
            onCopySuccess={() => undefined}
            onDeleteMessage={noopAsync}
            onEditMessage={noopAsync}
            onRetryMessage={noopAsync}
            onUpdateAttachment={noopAsync}
            readOnly
            renderMarkdown={false}
            richFeatures={richFeatures}
          />
        </div>
      </div>
    </aside>
  );
}

function SubAgentMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-sm border border-outline-variant bg-surface px-2 py-1.5">
      <dt className="truncate font-semibold uppercase">{label}</dt>
      <dd className="truncate text-on-surface">{value}</dd>
    </div>
  );
}

function statusBadgeClass(status: ChatSubAgentStatus): string {
  const base = "rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase";

  if (status === "running") {
    return `${base} bg-primary-container text-primary`;
  }

  if (status === "error") {
    return `${base} bg-error-container text-error`;
  }

  return `${base} bg-emerald-100 text-emerald-700`;
}

function formatToolTurns(value: number | undefined): string {
  if (typeof value !== "number") {
    return "Unavailable";
  }

  return `${value}`;
}

function formatElapsed(value: number | undefined): string {
  return typeof value === "number" ? formatThoughtDuration(value) : "Unavailable";
}

function formatTimestamp(value: string | undefined): string {
  return value ? formatMessageTimestamp(value) || "Unavailable" : "Unavailable";
}

async function noopAsync(): Promise<void> {
  return undefined;
}
