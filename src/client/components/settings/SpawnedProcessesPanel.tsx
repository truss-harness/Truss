import { useEffect, useState } from "react";
import type { SpawnedProcessesResponse } from "../../../shared/protocol.ts";
import { fetchSpawnedProcesses, terminateSpawnedProcess } from "../../api.ts";
import { errorMessage } from "../chat/chat-utils.ts";
import { MaterialIcon } from "../MaterialIcon.tsx";
import { PrimaryButton, SettingsAlert } from "./SettingsControls.tsx";

export function SpawnedProcessesPanel() {
  const [response, setResponse] = useState<SpawnedProcessesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [terminatingId, setTerminatingId] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      setResponse(await fetchSpawnedProcesses());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  async function terminate(processId: string): Promise<void> {
    setTerminatingId(processId);
    setError(null);

    try {
      await terminateSpawnedProcess(processId);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setTerminatingId(null);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm leading-6 text-on-surface-variant">
          Spawned Truss servers expire after one hour without browser or API activity. Terminating
          a server also closes its MCP child processes.
        </p>
        <PrimaryButton disabled={loading} icon="refresh" label="Refresh" onClick={() => void refresh()} />
      </div>
      {error ? <SettingsAlert tone="error" message={error} /> : null}
      {loading ? (
        <p className="text-sm text-on-surface-variant">Loading spawned processes...</p>
      ) : response?.processes.length ? (
        <div className="grid gap-3">
          {response.processes.map((process) => {
            const current = process.id === response.currentProcessId;
            const terminating = process.id === terminatingId;

            return (
              <article
                className="grid gap-4 rounded-sm border border-outline-variant bg-surface-container-lowest p-4 sm:grid-cols-[minmax(0,1fr)_auto]"
                key={process.id}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <MaterialIcon name="memory" size={18} />
                    <h3 className="font-semibold text-on-surface">
                      {current ? "Current server" : `Server on port ${process.port}`}
                    </h3>
                  </div>
                  <dl className="mt-3 grid gap-2 text-sm text-on-surface-variant">
                    <div><dt className="inline font-medium text-on-surface">Workspace: </dt><dd className="inline break-all">{process.workspacePath}</dd></div>
                    <div><dt className="inline font-medium text-on-surface">PID: </dt><dd className="inline">{process.pid} · Port {process.port}</dd></div>
                    <div><dt className="inline font-medium text-on-surface">Last activity: </dt><dd className="inline">{new Date(process.lastActiveAt).toLocaleString()}</dd></div>
                  </dl>
                </div>
                <button
                  className="h-10 rounded-sm border border-error/50 px-4 text-sm font-semibold text-error transition hover:bg-error-container disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={terminating}
                  onClick={() => void terminate(process.id)}
                  type="button"
                >
                  {terminating ? "Terminating..." : "Terminate"}
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <SettingsAlert tone="info" message="No spawned Truss servers are running." />
      )}
    </div>
  );
}
