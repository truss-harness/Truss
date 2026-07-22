import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { MaterialIcon } from "./MaterialIcon.tsx";
import { Modal } from "./Modal.tsx";
import { ModelSelector, type ModelSelectorOption, type SelectedModel } from "./ModelSelector.tsx";
import { MarkdownView } from "../markdown.tsx";
import {
  createScheduledTask,
  deleteScheduledTask,
  fetchLlmProviderSettings,
  fetchScheduledTaskRuns,
  fetchScheduledTasks,
  runScheduledTaskNow,
  stopScheduledTask,
  updateScheduledTask,
} from "../api.ts";
import type {
  LlmProviderSummary,
  ScheduledTaskCreateRequest,
  ScheduledTaskRunSummary,
  ScheduledTaskSummary,
  ScheduledTaskUpdateRequest,
} from "../../shared/protocol.ts";
import { formatMessageTimestamp } from "./chat/chat-utils.ts";

interface ToastState {
  id: string;
  message: string;
}

const toastDismissDelayMs = 2400;

function ToastNotification({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  return (
    <div
      aria-live="polite"
      className="truss-toast fixed bottom-6 right-6 z-[170] max-w-sm rounded-sm border border-outline-variant bg-surface px-4 py-3 text-sm font-medium text-on-surface shadow-[0_18px_44px_rgb(27_28_25/0.18)]"
      key={toast.id}
      role="status"
    >
      {toast.message}
    </div>
  );
}

export function ScheduledTasksScreen() {
  const [tasks, setTasks] = useState<ScheduledTaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<LlmProviderSummary[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const [formTask, setFormTask] = useState<ScheduledTaskSummary | null | undefined>(undefined);
  const [runsTask, setRunsTask] = useState<ScheduledTaskSummary | null>(null);
  const [runs, setRuns] = useState<ScheduledTaskRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  function showToast(message: string): void {
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    setToast({ id: `toast-${Date.now()}`, message });
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, toastDismissDelayMs);
  }

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  async function loadTasks(): Promise<void> {
    setLoading(true);
    try {
      const response = await fetchScheduledTasks();
      setTasks(response.tasks);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load scheduled tasks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTasks();
    fetchLlmProviderSettings()
      .then((response) => setProviders(response.providers))
      .catch(() => {
        // Provider list is only used to populate the form's defaults; the
        // form still works with plain text input if this fails.
      });
  }, []);

  const hasRunningTask = tasks.some((task) => task.running);

  useEffect(() => {
    if (!hasRunningTask) return;

    const interval = window.setInterval(() => {
      void loadTasks();
    }, 3000);

    return () => window.clearInterval(interval);
  }, [hasRunningTask]);


  async function handleSubmit(
    request: ScheduledTaskCreateRequest | ScheduledTaskUpdateRequest,
  ): Promise<void> {
    try {
      if (formTask) {
        await updateScheduledTask(formTask.id, request as ScheduledTaskUpdateRequest);
        showToast("Scheduled task updated.");
      } else {
        await createScheduledTask(request as ScheduledTaskCreateRequest);
        showToast("Scheduled task created.");
      }
      setFormTask(undefined);
      await loadTasks();
    } catch (err: any) {
      throw new Error(err?.message || "Failed to save scheduled task");
    }
  }

  async function handleDelete(task: ScheduledTaskSummary): Promise<void> {
    const confirmed = window.confirm(`Delete scheduled task "${task.name}"? This also removes its run history.`);
    if (!confirmed) return;

    setBusyTaskId(task.id);
    try {
      await deleteScheduledTask(task.id);
      showToast("Scheduled task deleted.");
      await loadTasks();
    } catch (err: any) {
      showToast(err?.message || "Failed to delete scheduled task");
    } finally {
      setBusyTaskId(null);
    }
  }

  async function handleRunNow(task: ScheduledTaskSummary): Promise<void> {
    setBusyTaskId(task.id);
    try {
      await runScheduledTaskNow(task.id);
      showToast(`Started "${task.name}".`);
      await loadTasks();
    } catch (err: any) {
      showToast(err?.message || "Failed to start scheduled task");
    } finally {
      setBusyTaskId(null);
    }
  }

  async function handleStop(task: ScheduledTaskSummary): Promise<void> {
    setBusyTaskId(task.id);
    try {
      await stopScheduledTask(task.id);
      showToast(`Stopping "${task.name}"...`);
      await loadTasks();
    } catch (err: any) {
      showToast(err?.message || "Failed to stop scheduled task");
    } finally {
      setBusyTaskId(null);
    }
  }

  async function openRuns(task: ScheduledTaskSummary): Promise<void> {
    setRunsTask(task);
    setRunsLoading(true);
    try {
      const response = await fetchScheduledTaskRuns(task.id);
      setRuns(response.runs);
    } catch (err: any) {
      showToast(err?.message || "Failed to load run history");
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }

  return (
    <main className="relative h-screen overflow-hidden bg-surface text-on-surface flex flex-col">
      <div className="truss-grid pointer-events-none fixed inset-0 z-0" />
      <div className="relative z-10 mx-auto flex h-full w-full max-w-[1380px] flex-col px-5 py-6 sm:px-8 lg:px-10 overflow-hidden">
        <header className="mb-6 flex flex-none flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <a
              aria-label="Back to chat"
              className="grid h-10 w-10 place-items-center rounded-sm border border-outline-variant bg-surface-container-low text-on-surface-variant transition hover:bg-surface-container hover:text-primary focus:border-outline focus:bg-surface focus:outline-none"
              href="/"
            >
              <MaterialIcon name="arrow_back" size={20} />
            </a>
            <div className="min-w-0 flex-1 lg:grid lg:gap-1">
              <p className="text-xs font-semibold uppercase text-on-surface-variant">Truss</p>
              <h1 className="truncate text-2xl font-semibold text-primary">Scheduled Tasks</h1>
            </div>
          </div>

          <button
            className="inline-flex h-10 items-center gap-2 rounded-sm bg-primary px-4 text-sm font-semibold text-on-primary transition hover:bg-primary/90"
            onClick={() => setFormTask(null)}
            type="button"
          >
            <MaterialIcon name="add" size={18} />
            New Task
          </button>
        </header>

        <div className="flex-1 overflow-auto rounded-sm border border-outline-variant bg-surface-container-low min-h-0">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container-high/40 text-xs font-semibold uppercase text-on-surface-variant">
                <th className="p-4 min-w-[200px]">Task</th>
                <th className="p-4 hidden md:table-cell">Schedule</th>
                <th className="p-4 hidden lg:table-cell">Scope</th>
                <th className="p-4 hidden sm:table-cell">Last run</th>
                <th className="p-4 hidden sm:table-cell">Next run</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4 text-right w-56">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && tasks.length === 0 ? (
                <tr>
                  <td className="p-8 text-center text-on-surface-variant" colSpan={7}>
                    Loading scheduled tasks...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td className="p-8 text-center text-error" colSpan={7}>
                    {error}
                  </td>
                </tr>
              ) : tasks.length === 0 ? (
                <tr>
                  <td className="p-8 text-center text-on-surface-variant" colSpan={7}>
                    No scheduled tasks yet. Create one, or let an assistant create one with the
                    create_scheduled_task tool.
                  </td>
                </tr>
              ) : (
                tasks.map((task) => (
                  <tr
                    className="border-b border-outline-variant/60 align-top transition hover:bg-surface-container"
                    key={task.id}
                  >
                    <td className="p-4">
                      <div className="font-semibold text-on-surface">{task.name}</div>
                      <div className="mt-1 line-clamp-2 max-w-md text-xs text-on-surface-variant">
                        {task.prompt}
                      </div>
                      <div className="mt-1 text-xs text-on-surface-variant/80">
                        {task.providerId} / {task.modelId}
                      </div>
                    </td>
                    <td className="p-4 hidden md:table-cell">
                      <code className="rounded-sm bg-surface-container px-1.5 py-0.5 text-xs">
                        {task.cronExpression}
                      </code>
                      {task.timezone ? (
                        <div className="mt-1 text-xs text-on-surface-variant">{task.timezone}</div>
                      ) : null}
                      {task.allowOverlap ? (
                        <div className="mt-1 text-xs text-on-surface-variant">Allows overlap</div>
                      ) : null}
                    </td>
                    <td className="p-4 hidden lg:table-cell">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={
                            task.workspacePath
                              ? "rounded-sm bg-surface-container px-2 py-0.5 text-xs font-medium text-on-surface-variant"
                              : "rounded-sm border border-amber-600/25 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900"
                          }
                        >
                          {task.workspacePath ? "Workspace" : "Global"}
                        </span>
                        <span
                          className={
                            task.createdBy === "llm"
                              ? "rounded-sm border border-sky-600/25 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-900"
                              : "rounded-sm border border-outline-variant bg-surface px-2 py-0.5 text-xs font-medium text-on-surface-variant"
                          }
                        >
                          Created by {task.createdBy === "llm" ? "assistant" : "user"}
                        </span>
                      </div>
                    </td>
                    <td className="p-4 hidden sm:table-cell text-xs text-on-surface-variant">
                      {task.lastRunAt ? formatMessageTimestamp(task.lastRunAt) : "Never"}
                    </td>
                    <td className="p-4 hidden sm:table-cell text-xs text-on-surface-variant">
                      {task.enabled && task.nextRunAt ? formatMessageTimestamp(task.nextRunAt) : "—"}
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {task.running ? (
                          <span
                            aria-hidden="true"
                            className="truss-spinner h-3 w-3 shrink-0 rounded-full border-2 border-outline-variant border-t-primary"
                          />
                        ) : null}
                        <span
                          className={
                            task.running
                              ? "rounded-sm border border-sky-600/25 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-900"
                              : task.enabled
                                ? "rounded-sm bg-tertiary-container px-2 py-0.5 text-xs font-medium text-on-tertiary"
                                : "rounded-sm bg-surface-container-high px-2 py-0.5 text-xs text-on-surface-variant"
                          }
                        >
                          {task.running ? "Running" : task.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex justify-end">
                        <div className="inline-flex divide-x divide-outline-variant/70 overflow-visible rounded-sm border border-outline-variant/70">
                          {task.running ? (
                            <IconActionButton
                              danger
                              disabled={busyTaskId === task.id}
                              icon="stop"
                              label="Stop"
                              onClick={() => void handleStop(task)}
                            />
                          ) : (
                            <IconActionButton
                              disabled={busyTaskId === task.id}
                              icon="play_arrow"
                              label="Run now"
                              onClick={() => void handleRunNow(task)}
                            />
                          )}
                          <IconActionButton
                            icon="history"
                            label="View runs"
                            onClick={() => void openRuns(task)}
                          />
                          <IconActionButton
                            icon="edit"
                            label="Edit"
                            onClick={() => setFormTask(task)}
                          />
                          <IconActionButton
                            danger
                            disabled={busyTaskId === task.id}
                            icon="delete"
                            label="Delete"
                            onClick={() => void handleDelete(task)}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {formTask !== undefined ? (
        <ScheduledTaskFormModal
          onClose={() => setFormTask(undefined)}
          onSubmit={handleSubmit}
          providers={providers}
          task={formTask}
        />
      ) : null}

      {runsTask ? (
        <ScheduledTaskRunsModal
          loading={runsLoading}
          onClose={() => setRunsTask(null)}
          runs={runs}
          task={runsTask}
        />
      ) : null}

      <ToastNotification toast={toast} />
    </main>
  );
}

function IconActionButton({
  danger = false,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  danger?: boolean;
  disabled?: boolean;
  icon: string;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      aria-label={label}
      className={[
        "group/action relative grid h-8 w-8 place-items-center transition disabled:cursor-not-allowed disabled:opacity-40",
        danger
          ? "text-error hover:bg-error-container/40"
          : "text-on-surface-variant hover:bg-surface-container hover:text-primary",
      ].join(" ")}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <MaterialIcon name={icon} size={16} />
      <span className="pointer-events-none absolute bottom-[calc(100%+7px)] left-1/2 z-[130] w-max max-w-44 -translate-x-1/2 translate-y-[0.25rem] whitespace-nowrap rounded-sm border border-outline-variant bg-surface px-2 py-1 text-xs font-medium text-on-surface opacity-0 shadow-[0_10px_24px_rgb(27_28_25/0.14)] transition group-hover/action:translate-y-0 group-hover/action:opacity-100 group-focus-visible/action:translate-y-0 group-focus-visible/action:opacity-100">
        {label}
      </span>
    </button>
  );
}

function ScheduledTaskFormModal({
  onClose,
  onSubmit,
  providers,
  task,
}: {
  onClose(): void;
  onSubmit(request: ScheduledTaskCreateRequest | ScheduledTaskUpdateRequest): Promise<void>;
  providers: LlmProviderSummary[];
  task: ScheduledTaskSummary | null;
}) {
  const [name, setName] = useState(task?.name ?? "");
  const [prompt, setPrompt] = useState(task?.prompt ?? "");
  const [cronExpression, setCronExpression] = useState(task?.cronExpression ?? "0 * * * *");
  const [timezone, setTimezone] = useState(task?.timezone ?? "");
  const [workingDirectory, setWorkingDirectory] = useState(task?.workingDirectory ?? "");
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(
    task ? { modelId: task.modelId, providerId: task.providerId } : null,
  );
  const [allowOverlap, setAllowOverlap] = useState(task?.allowOverlap ?? false);
  const [enabled, setEnabled] = useState(task?.enabled ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const modelOptions = useMemo(() => buildProviderModelOptions(providers), [providers]);

  useEffect(() => {
    if (task || selectedModel) {
      return;
    }

    const defaultOption = modelOptions[0];

    if (defaultOption) {
      setSelectedModel({ modelId: defaultOption.modelId, providerId: defaultOption.providerId });
    }
  }, [modelOptions, selectedModel, task]);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      await onSubmit({
        name,
        prompt,
        cronExpression,
        timezone: timezone.trim() || null,
        workingDirectory: workingDirectory.trim() || null,
        providerId: selectedModel?.providerId || undefined,
        modelId: selectedModel?.modelId || undefined,
        allowOverlap,
        enabled,
      });
    } catch (err: any) {
      setFormError(err?.message || "Failed to save scheduled task");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      icon="schedule"
      onClose={onClose}
      open
      size="lg"
      title={task ? "Edit Scheduled Task" : "New Scheduled Task"}
      footer={
        <>
          <button
            className="inline-flex h-9 items-center rounded-sm border border-outline-variant px-4 text-sm font-medium text-on-surface-variant transition hover:bg-surface-container"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex h-9 items-center rounded-sm bg-primary px-4 text-sm font-semibold text-on-primary transition hover:bg-primary/90 disabled:opacity-50"
            disabled={submitting || !name.trim() || !prompt.trim() || !cronExpression.trim()}
            form="scheduled-task-form"
            type="submit"
          >
            {submitting ? "Saving..." : task ? "Save changes" : "Create task"}
          </button>
        </>
      }
    >
      <form className="grid gap-4" id="scheduled-task-form" onSubmit={handleSubmit}>
        {formError ? (
          <p className="rounded-sm border border-error/40 bg-error-container/30 px-3 py-2 text-sm text-error">
            {formError}
          </p>
        ) : null}

        {!task ? (
          <p className="rounded-sm border border-outline-variant/70 bg-surface-container px-3 py-2 text-xs text-on-surface-variant">
            Scheduled tasks created here are global and visible to every Truss workspace.
          </p>
        ) : null}

        <label className="grid gap-1 text-sm">
          <span className="font-medium text-on-surface-variant">Name</span>
          <input
            className="h-10 rounded-sm border border-outline-variant bg-surface-container px-3 text-on-surface outline-none focus:border-outline"
            data-autofocus="true"
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
            required
            type="text"
            value={name}
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-medium text-on-surface-variant">Prompt</span>
          <textarea
            className="min-h-[100px] rounded-sm border border-outline-variant bg-surface-container px-3 py-2 text-on-surface outline-none focus:border-outline"
            maxLength={40000}
            onChange={(event) => setPrompt(event.target.value)}
            required
            value={prompt}
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-on-surface-variant">Cron expression</span>
            <input
              className="h-10 rounded-sm border border-outline-variant bg-surface-container px-3 font-mono text-sm text-on-surface outline-none focus:border-outline"
              onChange={(event) => setCronExpression(event.target.value)}
              placeholder="0 * * * *"
              required
              type="text"
              value={cronExpression}
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="font-medium text-on-surface-variant">Timezone (optional)</span>
            <input
              className="h-10 rounded-sm border border-outline-variant bg-surface-container px-3 text-on-surface outline-none focus:border-outline"
              onChange={(event) => setTimezone(event.target.value)}
              placeholder="America/New_York"
              type="text"
              value={timezone}
            />
          </label>
        </div>

        <label className="grid gap-1 text-sm">
          <span className="font-medium text-on-surface-variant">Working directory (optional)</span>
          <input
            className="h-10 rounded-sm border border-outline-variant bg-surface-container px-3 text-on-surface outline-none focus:border-outline"
            onChange={(event) => setWorkingDirectory(event.target.value)}
            placeholder="Absolute path"
            type="text"
            value={workingDirectory}
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-medium text-on-surface-variant">Model</span>
          <ModelSelector
            disabled={submitting}
            loading={false}
            onChange={setSelectedModel}
            options={modelOptions}
            selected={selectedModel}
          />
        </label>

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm text-on-surface-variant">
            <input
              checked={allowOverlap}
              className="h-4 w-4 rounded-sm border-outline-variant text-primary focus:ring-primary"
              onChange={(event) => setAllowOverlap(event.target.checked)}
              type="checkbox"
            />
            Allow overlapping runs
          </label>

          <label className="flex items-center gap-2 text-sm text-on-surface-variant">
            <input
              checked={enabled}
              className="h-4 w-4 rounded-sm border-outline-variant text-primary focus:ring-primary"
              onChange={(event) => setEnabled(event.target.checked)}
              type="checkbox"
            />
            Enabled
          </label>
        </div>
      </form>
    </Modal>
  );
}

function ScheduledTaskRunsModal({
  loading,
  onClose,
  runs,
  task,
}: {
  loading: boolean;
  onClose(): void;
  runs: ScheduledTaskRunSummary[];
  task: ScheduledTaskSummary;
}) {
  return (
    <Modal
      icon="history"
      onClose={onClose}
      open
      size="lg"
      title={`Runs: ${task.name}`}
      bodyClassName="max-h-[60vh] overflow-auto"
    >
      {loading ? (
        <p className="text-sm text-on-surface-variant">Loading run history...</p>
      ) : runs.length === 0 ? (
        <p className="text-sm text-on-surface-variant">No runs yet.</p>
      ) : (
        <div className="grid gap-3">
          {runs.map((run) => (
            <details
              className="truss-disclosure rounded-sm border border-outline-variant/70 bg-surface-container-low p-3"
              key={run.id}
              open
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <MaterialIcon
                    className="truss-disclosure-icon shrink-0 text-on-surface-variant"
                    name="add"
                    size={16}
                  />
                  <span
                    className={[
                      "rounded-sm px-2 py-0.5 text-xs font-semibold",
                      run.status === "done"
                        ? "bg-tertiary-container text-on-tertiary"
                        : run.status === "error"
                          ? isStoppedRun(run)
                            ? "border border-outline-variant bg-surface-container-high text-on-surface-variant"
                            : "bg-error-container text-on-error-container"
                          : run.status === "running"
                            ? "bg-primary-container text-on-primary-container"
                            : "bg-surface-container-high text-on-surface-variant",
                    ].join(" ")}
                  >
                    {isStoppedRun(run) ? "stopped" : run.status}
                  </span>
                </span>
                <span className="text-xs text-on-surface-variant">
                  {run.trigger === "manual" ? "Manual" : "Scheduled"} · {formatMessageTimestamp(run.startedAt)}
                </span>
              </summary>

              <div className="truss-disclosure-panel mt-3 grid gap-2 border-t border-outline-variant/60 pt-3 text-sm">
                {run.summary ? <MarkdownView source={run.summary} /> : null}
                {run.error ? (
                  <div className={isStoppedRun(run) ? "text-on-surface-variant" : "text-error"}>
                    <MarkdownView source={run.error} />
                  </div>
                ) : null}
                {run.sessionId ? (
                  <a
                    className="inline-block text-xs text-primary hover:underline"
                    href={`/?session=${encodeURIComponent(run.sessionId)}`}
                  >
                    View sub-agent conversation
                  </a>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      )}
    </Modal>
  );
}

function isStoppedRun(run: ScheduledTaskRunSummary): boolean {
  return run.status === "error" && run.error === "Stopped by user.";
}

function buildProviderModelOptions(providers: LlmProviderSummary[]): ModelSelectorOption[] {
  const options: ModelSelectorOption[] = [];

  for (const provider of providers.filter((provider) => provider.enabled && provider.configured)) {
    const models = uniqueStrings([provider.defaultModel, ...provider.models]);

    for (const modelId of models) {
      options.push({
        modelId,
        providerId: provider.id,
        providerLabel: provider.label,
        source: "configured",
      });
    }
  }

  return options;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
