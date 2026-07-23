import { SERVICE_OVERLOADED } from "#veryfront/errors";

/** Public API contract for task. */
export interface Task {
  /** Server-assigned task identifier. */
  taskId: string;
  /** Current MCP task lifecycle state. */
  status: "working" | "input_required" | "completed" | "failed" | "cancelled";
  /** Optional bounded human-readable status detail. */
  statusMessage?: string;
  /** ISO timestamp recorded when the task was created. */
  createdAt: string;
  /** ISO timestamp recorded at the latest state transition. */
  lastUpdatedAt: string;
  /** Retention period in milliseconds from task creation. */
  ttl: number;
  /** Suggested client polling interval in milliseconds. */
  pollInterval?: number;
}

/** Reason an MCP task left the in-memory task store. */
export type TaskDeletionReason = "expired" | "deleted" | "cleared";

/** Capacity, clock, and lifecycle options for the task store. */
export interface TaskStoreOptions {
  /** Maximum number of unexpired tasks retained in memory. */
  maxTasks?: number;
  /** Maximum number of concurrent result waiters retained in memory. */
  maxWaiters?: number;
  /** Clock, injectable for tests. Defaults to Date.now. */
  now?: () => number;
  /** Called after a task and its result are removed. */
  onDelete?: (taskId: string, reason: TaskDeletionReason) => void;
}

interface StoredTask {
  task: Task;
  expiresAt: number;
}

interface TaskWaiter {
  active: boolean;
  resolve: (result: unknown | undefined) => void;
  reject: (reason?: unknown) => void;
  timer?: number;
  signal?: AbortSignal;
  onAbort?: () => void;
}

const TERMINAL_STATUSES = new Set<Task["status"]>([
  "completed",
  "failed",
  "cancelled",
]);
const DEFAULT_POLL_INTERVAL = 2000;
const DEFAULT_MAX_TASKS = 1000;
const DEFAULT_MAX_WAITERS = 10_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MAX_STATUS_MESSAGE_BYTES = 16 * 1024;

/** In-memory MCP task state with bounded retention and immutable reads. */
export class TaskStore {
  private readonly tasks = new Map<string, StoredTask>();
  private readonly results = new Map<string, unknown>();
  private readonly waiters = new Map<string, Set<TaskWaiter>>();
  private readonly maxTasks: number;
  private readonly maxWaiters: number;
  private waiterCount = 0;
  private readonly now: () => number;
  private readonly onDelete?: (
    taskId: string,
    reason: TaskDeletionReason,
  ) => void;

  /** Create a task store with validated task and waiter limits. */
  constructor(options: TaskStoreOptions = {}) {
    const maxTasks = options.maxTasks ?? DEFAULT_MAX_TASKS;
    const maxWaiters = options.maxWaiters ?? DEFAULT_MAX_WAITERS;
    if (!Number.isSafeInteger(maxTasks) || maxTasks <= 0) {
      throw new TypeError("The maximum task count must be a positive integer");
    }
    if (!Number.isSafeInteger(maxWaiters) || maxWaiters <= 0) {
      throw new TypeError("The maximum task waiter count must be a positive integer");
    }
    this.maxTasks = maxTasks;
    this.maxWaiters = maxWaiters;
    this.now = options.now ?? Date.now;
    this.onDelete = options.onDelete;
  }

  /** Create a working task with a bounded creation-based TTL. */
  create(ttl: number): Task {
    if (!Number.isSafeInteger(ttl) || ttl <= 0) {
      throw new TypeError("The task TTL must be a positive integer");
    }

    const now = this.currentTime();
    const expiresAt = now + ttl;
    if (!Number.isSafeInteger(expiresAt)) {
      throw new TypeError("The task TTL is outside the supported time range");
    }

    this.sweep(now);
    if (this.tasks.size >= this.maxTasks) {
      throw SERVICE_OVERLOADED.create({
        detail:
          "Task store capacity reached. Wait for an existing task to expire before creating another task.",
      });
    }

    let taskId = crypto.randomUUID();
    for (let attempt = 0; this.tasks.has(taskId); attempt++) {
      if (attempt >= 9) {
        throw new Error("Unable to generate a unique task ID");
      }
      taskId = crypto.randomUUID();
    }

    const timestamp = new Date(now).toISOString();
    const task: Task = {
      taskId,
      status: "working",
      createdAt: timestamp,
      lastUpdatedAt: timestamp,
      ttl,
      pollInterval: Math.min(DEFAULT_POLL_INTERVAL, ttl),
    };
    this.tasks.set(taskId, { task, expiresAt });
    return this.cloneTask(task);
  }

  /** Read an immutable snapshot of one unexpired task. */
  get(taskId: string): Task | undefined {
    const stored = this.getStored(taskId);
    return stored ? this.cloneTask(stored.task) : undefined;
  }

  /** Complete an active task and retain a detached result snapshot. */
  complete(taskId: string, result: unknown): void {
    const stored = this.getStored(taskId);
    if (!stored || TERMINAL_STATUSES.has(stored.task.status)) return;
    const snapshot = this.cloneResult(result);
    this.transition(stored, "completed");
    this.results.set(taskId, snapshot);
    this.resolveWaiters(taskId, snapshot);
  }

  /** Fail an active task with bounded status detail and an optional result. */
  fail(taskId: string, message: string, result?: unknown): void {
    this.validateStatusMessage(message);
    const stored = this.getStored(taskId);
    if (!stored || TERMINAL_STATUSES.has(stored.task.status)) return;
    const snapshot = result === undefined ? undefined : this.cloneResult(result);
    this.transition(stored, "failed", message);
    if (result !== undefined) this.results.set(taskId, snapshot);
    this.resolveWaiters(taskId, snapshot);
  }

  /** Cancel an active task and resolve its pending result waiters. */
  cancel(taskId: string, result?: unknown): boolean {
    const stored = this.getStored(taskId);
    if (!stored || TERMINAL_STATUSES.has(stored.task.status)) return false;
    const snapshot = result === undefined ? undefined : this.cloneResult(result);
    this.transition(stored, "cancelled", "The task was cancelled by request.");
    if (result !== undefined) this.results.set(taskId, snapshot);
    this.resolveWaiters(taskId, snapshot);
    return true;
  }

  /** Read a detached result for a terminal task. */
  getResult(taskId: string): unknown | undefined {
    const stored = this.getStored(taskId);
    if (!stored || !TERMINAL_STATUSES.has(stored.task.status)) return undefined;
    if (!this.results.has(taskId)) return undefined;
    return this.cloneResult(this.results.get(taskId));
  }

  /** Wait for a task to become terminal, expire, or be aborted. */
  waitForResult(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<unknown | undefined> {
    const stored = this.getStored(taskId);
    if (!stored) return Promise.resolve(undefined);
    if (TERMINAL_STATUSES.has(stored.task.status)) {
      return Promise.resolve(this.getResult(taskId));
    }
    if (signal?.aborted) {
      return Promise.reject(this.abortReason(signal));
    }
    if (this.waiterCount >= this.maxWaiters) {
      throw SERVICE_OVERLOADED.create({
        detail: "Task result waiter capacity reached. Retry after an existing wait completes.",
      });
    }

    return new Promise((resolve, reject) => {
      const waiter: TaskWaiter = { active: true, resolve, reject, signal };
      let taskWaiters = this.waiters.get(taskId);
      if (!taskWaiters) {
        taskWaiters = new Set();
        this.waiters.set(taskId, taskWaiters);
      }
      taskWaiters.add(waiter);
      this.waiterCount++;

      try {
        if (signal) {
          waiter.onAbort = () => {
            this.removeWaiter(taskId, waiter);
            reject(this.abortReason(signal));
          };
          signal.addEventListener("abort", waiter.onAbort, { once: true });
        }
        this.scheduleWaiterExpiry(taskId, waiter);
      } catch (error) {
        this.removeWaiter(taskId, waiter);
        reject(error);
      }
    });
  }

  /** List immutable snapshots of all unexpired tasks. */
  list(): Task[] {
    this.sweep(this.currentTime());
    return Array.from(this.tasks.values(), ({ task }) => this.cloneTask(task));
  }

  /** Delete one task and its retained result. */
  delete(taskId: string): boolean {
    return this.remove(taskId, "deleted");
  }

  /** Delete every task, result, and associated waiter. */
  clear(): void {
    for (const taskId of [...this.tasks.keys()]) {
      this.remove(taskId, "cleared");
    }
  }

  /** Read one stored task after applying expiration. */
  private getStored(taskId: string): StoredTask | undefined {
    const stored = this.tasks.get(taskId);
    if (!stored) return undefined;
    if (this.isExpired(stored, this.currentTime())) {
      this.remove(taskId, "expired");
      return undefined;
    }
    return stored;
  }

  /** Apply one lifecycle transition and update its timestamp. */
  private transition(
    stored: StoredTask,
    status: Task["status"],
    statusMessage?: string,
  ): void {
    stored.task.status = status;
    stored.task.lastUpdatedAt = new Date(this.currentTime()).toISOString();
    if (statusMessage === undefined) {
      delete stored.task.statusMessage;
    } else {
      stored.task.statusMessage = statusMessage;
    }
  }

  /** Read and validate the configured clock. */
  private currentTime(): number {
    const now = this.now();
    if (!Number.isSafeInteger(now) || Math.abs(now) > 8_640_000_000_000_000) {
      throw new TypeError(
        "The task clock must return an integer in the JavaScript Date range",
      );
    }
    return now;
  }

  /** Report if a stored task reached its creation-based expiry. */
  private isExpired(stored: StoredTask, now: number): boolean {
    return now >= stored.expiresAt;
  }

  /** Remove all tasks that are expired at the supplied time. */
  private sweep(now: number): void {
    for (const [taskId, stored] of this.tasks) {
      if (this.isExpired(stored, now)) this.remove(taskId, "expired");
    }
  }

  /** Remove one task and settle every dependent waiter. */
  private remove(taskId: string, reason: TaskDeletionReason): boolean {
    if (!this.tasks.delete(taskId)) return false;
    this.results.delete(taskId);
    this.resolveWaiters(taskId, undefined);
    this.onDelete?.(taskId, reason);
    return true;
  }

  /** Resolve and clean every waiter registered for one task. */
  private resolveWaiters(taskId: string, result: unknown | undefined): void {
    const taskWaiters = this.waiters.get(taskId);
    if (!taskWaiters) return;
    this.waiters.delete(taskId);
    for (const waiter of taskWaiters) {
      this.cleanupWaiter(waiter);
      waiter.resolve(this.cloneResult(result));
    }
  }

  /** Remove and clean one registered task waiter. */
  private removeWaiter(taskId: string, waiter: TaskWaiter): void {
    const taskWaiters = this.waiters.get(taskId);
    taskWaiters?.delete(waiter);
    if (taskWaiters?.size === 0) this.waiters.delete(taskId);
    this.cleanupWaiter(waiter);
  }

  /** Release timer, signal, and capacity state owned by a waiter. */
  private cleanupWaiter(waiter: TaskWaiter): void {
    if (!waiter.active) return;
    waiter.active = false;
    this.waiterCount--;
    if (waiter.timer !== undefined) clearTimeout(waiter.timer);
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
  }

  /** Schedule bounded wakeups until a waiter's task expires. */
  private scheduleWaiterExpiry(taskId: string, waiter: TaskWaiter): void {
    const stored = this.tasks.get(taskId);
    if (!stored) {
      this.removeWaiter(taskId, waiter);
      waiter.resolve(undefined);
      return;
    }
    const remaining = stored.expiresAt - this.currentTime();
    if (remaining <= 0) {
      this.remove(taskId, "expired");
      return;
    }
    waiter.timer = setTimeout(() => {
      waiter.timer = undefined;
      const current = this.tasks.get(taskId);
      if (!current) {
        this.removeWaiter(taskId, waiter);
        waiter.resolve(undefined);
      } else if (this.isExpired(current, this.currentTime())) {
        this.remove(taskId, "expired");
      } else {
        this.scheduleWaiterExpiry(taskId, waiter);
      }
    }, Math.min(remaining, MAX_TIMER_DELAY_MS));
  }

  /** Detach a task before exposing it to a caller. */
  private cloneTask(task: Task): Task {
    return { ...task };
  }

  /** Detach a task result or reject values that cannot be cloned. */
  private cloneResult(result: unknown): unknown {
    try {
      return structuredClone(result);
    } catch {
      throw new TypeError("The task result must be cloneable");
    }
  }

  /** Validate one externally visible task status message. */
  private validateStatusMessage(message: string): void {
    if (
      typeof message !== "string" || message.trim().length === 0 ||
      new TextEncoder().encode(message).byteLength > MAX_STATUS_MESSAGE_BYTES
    ) {
      throw new TypeError(
        `The task status message must be non-empty and at most ${MAX_STATUS_MESSAGE_BYTES} bytes`,
      );
    }
  }

  /** Select the caller-provided abort reason or a stable fallback. */
  private abortReason(signal: AbortSignal): unknown {
    return signal.reason ?? new DOMException("The task result wait was aborted", "AbortError");
  }
}
