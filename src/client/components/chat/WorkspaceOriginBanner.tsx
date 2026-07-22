import { MaterialIcon } from "../MaterialIcon.tsx";

export function WorkspaceOriginBanner({
  launchDisabled,
  launchPending,
  onCopyWorkspacePath,
  onDismiss,
  onLaunchWorkspace,
  workspaceDisplayName,
  workspaceExists,
  workspacePath,
}: {
  launchDisabled: boolean;
  launchPending: boolean;
  onCopyWorkspacePath(): void;
  onDismiss(): void;
  onLaunchWorkspace(): void;
  workspaceDisplayName?: string;
  workspaceExists?: boolean;
  workspacePath: string;
}) {
  const unavailable = workspaceExists === false;
  const displayName = workspaceDisplayName ?? compactWorkspacePath(workspacePath);

  return (
    <aside
      className="truss-message-pop rounded-sm border border-primary/ bg-surface-container px-4 py-3 text-sm text-on-surface shadow-[0_10px_26px_rgb(27_28_25/0.08)]"
      role="note"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-surface text-primary">
          <MaterialIcon name={unavailable ? "warning" : "folder_open"} size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-primary">
                This conversation belongs to a workspace
              </h3>
              <p className="mt-1 min-w-0 text-xs leading-5 text-on-surface-variant">
                Created in:{" "}
                <code
                  className="rounded-sm bg-surface/70 px-1.5 py-0.5 font-mono text-[11px] text-on-surface"
                  title={workspacePath}
                >
                  {displayName}
                </code>
              </p>
            </div>
            <button
              aria-label="Dismiss workspace banner"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-on-surface-variant transition hover:bg-surface/70 hover:text-on-surface focus-visible:bg-surface focus-visible:outline-none"
              onClick={onDismiss}
              type="button"
            >
              <MaterialIcon name="close" size={17} />
            </button>
          </div>

          {unavailable ? (
            <div className="mt-3 flex items-start gap-2 rounded-sm border border-error-container bg-error-container/25 px-3 py-2 text-xs leading-5 text-error">
              <MaterialIcon className="mt-0.5 shrink-0" name="warning" size={16} />
              <span>Workspace path is no longer available.</span>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              className="inline-flex h-9 items-center gap-2 rounded-sm bg-primary px-3 text-xs font-semibold text-on-primary transition hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-45"
              disabled={launchDisabled || launchPending || unavailable}
              onClick={onLaunchWorkspace}
              type="button"
            >
              <MaterialIcon name={launchPending ? "sync" : "open_in_new"} size={16} />
              Launch workspace
            </button>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-sm border border-outline-variant bg-surface/60 px-3 text-xs font-semibold text-on-surface-variant transition hover:border-outline hover:bg-surface hover:text-on-surface focus-visible:border-outline focus-visible:outline-none"
              onClick={onCopyWorkspacePath}
              type="button"
            >
              <MaterialIcon name="content_copy" size={16} />
              Copy workspace path
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function compactWorkspacePath(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);

  return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : path;
}
