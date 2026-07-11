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
      this.evictOldest();
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
    // Only terminal tasks expire. A still-running ('working') or waiting
    // ('input_required') task must not be deleted mid-flight while its tool is
    // executing — expiry is measured from completion via lastUpdatedAt.
    if (!TERMINAL_STATUSES.has(task.status)) return false;
    return Date.now() - new Date(task.lastUpdatedAt).getTime() > task.ttl;
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

  private evictOldest(): void {
    // Only evict terminal tasks. A running ('working') or waiting
    // ('input_required') task must never be evicted — doing so would drop a
    // task whose tool is still executing without aborting it. If every task is
    // non-terminal the store is briefly allowed to exceed MAX_TASKS rather than
    // discard live work.
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
    }
  }
}
