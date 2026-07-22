import type { SessionInfo } from "../../shared/protocol.ts";
import type { ConnectionState } from "../types.ts";
import { StatusPill } from "./StatusPill.tsx";

export function AppHeader({
  connection,
  session,
  statusLabel,
}: {
  connection: ConnectionState;
  session: SessionInfo | null;
  statusLabel: string;
}) {
  return (
    <header className="animate-rise border-b border-outline-variant pb-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-on-surface-variant">
            Local agentic harness
          </p>
          <h1 className="mt-2 text-[32px] font-semibold leading-tight text-primary">
            Truss
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-on-surface-variant sm:text-base">
            Bun backend, React frontend, SSE downstream events, and POST-based command
            resolution in one localhost process.
          </p>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-3 lg:min-w-[34rem]">
          <StatusPill label="Transport" value={statusLabel} tone={connection} />
          <StatusPill label="Port" value={session ? String(session.port) : "pending"} />
          <StatusPill
            label="Workspace"
            value={session ? compactPath(session.workspacePath) : "loading"}
          />
        </div>
      </div>
    </header>
  );
}

function compactPath(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : path;
}
