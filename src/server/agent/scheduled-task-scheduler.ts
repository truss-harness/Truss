import { Cron } from "croner";
import type { ScheduledTaskSummary } from "../../shared/protocol.ts";
import type { ServerContext } from "../http/context.ts";
import { runScheduledTask } from "../http/routes-chat.ts";
import { logToStdout, errorForLog } from "../utils/logging.ts";

/**
 * Wraps croner Cron jobs for scheduled tasks owned by this server process.
 *
 * Each Truss server process (the global instance and any per-workspace
 * instance) only schedules the tasks whose workspace scope matches its own
 * `conversationWorkspacePath`. This keeps global tasks firing exactly once
 * (from the global instance) while workspace-scoped tasks fire only while
 * their own workspace's Truss instance happens to be running.
 */
export class ScheduledTaskScheduler {
  readonly #context: ServerContext;
  readonly #jobs = new Map<string, Cron>();

  constructor(context: ServerContext) {
    this.#context = context;
  }

  /** Recomputes the set of active cron jobs from the current database state. */
  sync(): void {
    const ownedTasks = this.#context.scheduledTasks
      .listScheduledTasks({ enabledOnly: true })
      .filter((task) => this.#isOwnedByThisProcess(task));
    const ownedTaskIds = new Set(ownedTasks.map((task) => task.id));

    for (const [taskId, job] of this.#jobs) {
      if (!ownedTaskIds.has(taskId)) {
        job.stop();
        this.#jobs.delete(taskId);
      }
    }

    for (const task of ownedTasks) {
      const existing = this.#jobs.get(task.id);

      if (existing) {
        if (existing.getPattern() !== task.cronExpression) {
          existing.stop();
          this.#jobs.delete(task.id);
        } else {
          continue;
        }
      }

      this.#scheduleTask(task);
    }
  }

  /** Returns the next scheduled run time for a task owned by this process, if any. */
  nextRunAt(taskId: string): Date | null {
    return this.#jobs.get(taskId)?.nextRun() ?? null;
  }

  stop(): void {
    for (const job of this.#jobs.values()) {
      job.stop();
    }

    this.#jobs.clear();
  }

  #isOwnedByThisProcess(task: ScheduledTaskSummary): boolean {
    const processScope = this.#context.options.conversationWorkspacePath;

    return (task.workspacePath ?? null) === (processScope ?? null);
  }

  #scheduleTask(task: ScheduledTaskSummary): void {
    try {
      const job = new Cron(
        task.cronExpression,
        {
          catch: (caught) => {
            logToStdout("scheduled-tasks", "Scheduled task cron callback threw.", {
              error: errorForLog(caught),
              taskId: task.id,
            });
          },
          protect: true,
          timezone: task.timezone ?? undefined,
        },
        () => {
          const current = this.#context.scheduledTasks.getScheduledTask(task.id);

          if (!current || !current.enabled) {
            return;
          }

          void runScheduledTask(this.#context, current, "cron");
        },
      );

      this.#jobs.set(task.id, job);
    } catch (caught) {
      logToStdout("scheduled-tasks", "Failed to schedule task; invalid cron expression?", {
        cronExpression: task.cronExpression,
        error: errorForLog(caught),
        taskId: task.id,
      });
    }
  }
}
