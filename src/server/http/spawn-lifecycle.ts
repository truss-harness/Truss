import process from "node:process";
import { SpawnedProcessesRepository } from "../storage/spawned-processes.ts";
import { createId } from "../utils/id.ts";
import type { SpawnedProcessSummary } from "../../shared/protocol.ts";

export const spawnIdleTimeoutMs = 60 * 60 * 1000;

export interface SpawnLifecycleOptions {
  closeMcp(): Promise<void>;
  onStopped(): void;
  port: number;
  processes: SpawnedProcessesRepository;
  server: Bun.Server<undefined>;
  workspacePath: string;
}

export class SpawnLifecycle {
  readonly #id = createId("spawn");
  readonly #closeMcp: () => Promise<void>;
  readonly #onStopped: () => void;
  readonly #port: number;
  readonly #processes: SpawnedProcessesRepository;
  readonly #server: Bun.Server<undefined>;
  readonly #startedAt = new Date().toISOString();
  readonly #workspacePath: string;
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  #lastActiveAt = this.#startedAt;
  #stopping: Promise<void> | null = null;

  constructor(options: SpawnLifecycleOptions) {
    this.#closeMcp = options.closeMcp;
    this.#onStopped = options.onStopped;
    this.#port = options.port;
    this.#processes = options.processes;
    this.#server = options.server;
    this.#workspacePath = options.workspacePath;
  }

  get id(): string {
    return this.#id;
  }

  start(): void {
    this.#processes.upsert(this.summary);
    this.touch();
    process.once("SIGINT", () => void this.stop());
    process.once("SIGTERM", () => void this.stop());
  }

  get summary(): SpawnedProcessSummary {
    return {
      id: this.#id,
      lastActiveAt: this.#lastActiveAt,
      pid: process.pid,
      port: this.#port,
      startedAt: this.#startedAt,
      workspacePath: this.#workspacePath,
    };
  }

  touch(): void {
    if (this.#stopping) {
      return;
    }

    this.#lastActiveAt = new Date().toISOString();
    this.#processes.touch(this.#id, this.#lastActiveAt);
    this.#resetIdleTimer();
  }

  stop(): Promise<void> {
    if (!this.#stopping) {
      this.#stopping = this.#stop();
    }

    return this.#stopping;
  }

  #resetIdleTimer(): void {
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer);
    }

    this.#idleTimer = setTimeout(() => {
      void this.stop();
    }, spawnIdleTimeoutMs);
  }

  async #stop(): Promise<void> {
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = null;
    }

    this.#server.stop(true);

    try {
      await this.#closeMcp();
    } finally {
      this.#processes.remove(this.#id);
      this.#onStopped();
    }
  }
}
