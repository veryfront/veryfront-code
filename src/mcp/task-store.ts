/** Public API contract for task. */
export interface Task {
  taskId: string;
  status: "working" | "input_required" | "completed" | "failed" | "cancelled";
  statusMessage?: string;
  createdAt: string;
  lastUpdatedAt: string;
  ttl: number;
  pollInterval?: number;
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const DEFAULT_POLL_INTERVAL = 2000;
const SWEEP_INTERVAL_MS = 30_000;
const MAX_TASKS = 1000;

/** Implement task store. */
export class TaskStore {
  private tasks = new Map<string, Task>();
  private results = new Map<string, unknown>();
  private lastSweep = 0;

  create(ttl: number): Task {
    this.lazySweep();
    if (this.tasks.size >= MAX_TASKS) {
      // The lazy sweep may be throttled even though the store just reached its
      // hard bound. Reclaim newly expired entries before rejecting live work.
      this.sweep();
      if (this.tasks.size >= MAX_TASKS && !this.evictOldest()) {
        throw new Error(
          "Task store capacity reached. Wait for an existing task to finish or expire.",
        );
      }
    }

    const now = new Date().toISOString();
    const task: Task = {
      taskId: crypto.randomUUID(),
      status: "working",
      createdAt: now,
      lastUpdatedAt: now,
      ttl,
      pollInterval: DEFAULT_POLL_INTERVAL,
    };
    this.tasks.set(task.taskId, task);
    return task;
  }

  get(taskId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    if (task && this.isExpired(task)) {
      this.tasks.delete(taskId);
      this.results.delete(taskId);
      return undefined;
    }
    return task;
  }

  complete(taskId: string, result: unknown): void {
    const task = this.tasks.get(taskId);
    if (!task || TERMINAL_STATUSES.has(task.status)) return;
    task.status = "completed";
    task.lastUpdatedAt = new Date().toISOString();
    this.results.set(taskId, result);
  }

  fail(taskId: string, message: string): void {
    const task = this.tasks.get(taskId);
    if (!task || TERMINAL_STATUSES.has(task.status)) return;
    task.status = "failed";
    task.statusMessage = message;
    task.lastUpdatedAt = new Date().toISOString();
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || TERMINAL_STATUSES.has(task.status)) return false;
    task.status = "cancelled";
    task.statusMessage = "The task was cancelled by request.";
    task.lastUpdatedAt = new Date().toISOString();
    return true;
  }

  getResult(taskId: string): unknown | undefined {
    const task = this.get(taskId);
    if (!task || !TERMINAL_STATUSES.has(task.status)) return undefined;
    return this.results.get(taskId);
  }

  list(): Task[] {
    this.lazySweep();
    return Array.from(this.tasks.values());
  }

  clear(): void {
    this.tasks.clear();
    this.results.clear();
  }

  private isExpired(task: Task): boolean {
    // TTL is anchored to task creation, but an active task must remain visible
    // so the server can still cancel and account for its pending execution.
    if (!TERMINAL_STATUSES.has(task.status)) return false;
    return Date.now() - new Date(task.createdAt).getTime() > task.ttl;
  }

  private lazySweep(): void {
    const now = Date.now();
    if (now - this.lastSweep < SWEEP_INTERVAL_MS) return;
    this.lastSweep = now;
    this.sweep();
  }

  private sweep(): void {
    for (const [id, task] of this.tasks) {
      if (this.isExpired(task)) {
        this.tasks.delete(id);
        this.results.delete(id);
      }
    }
  }

  private evictOldest(): boolean {
    // Terminal state can be evicted without losing track of active execution.
    // If every task is active, reject new work instead of exceeding the bound or
    // silently orphaning an in-flight task.
    let oldestTerminal: string | undefined;
    let oldestTerminalTime = Infinity;

    for (const [id, task] of this.tasks) {
      if (!TERMINAL_STATUSES.has(task.status)) continue;
      const created = new Date(task.createdAt).getTime();
      if (created < oldestTerminalTime) {
        oldestTerminalTime = created;
        oldestTerminal = id;
      }
    }

    if (oldestTerminal) {
      this.tasks.delete(oldestTerminal);
      this.results.delete(oldestTerminal);
      return true;
    }

    return false;
  }
}
