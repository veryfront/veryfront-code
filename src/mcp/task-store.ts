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

import { SERVICE_OVERLOADED } from "#veryfront/errors";
import { type BoundedJsonValue, snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const DEFAULT_POLL_INTERVAL = 2000;
const SWEEP_INTERVAL_MS = 30_000;
const MAX_TASKS = 1000;
const MAX_SCOPED_TASKS = 100;
const TASK_LIST_PAGE_SIZE = 50;

/** A bounded page of task metadata and its optional continuation cursor. */
export interface TaskPage {
  tasks: Task[];
  nextCursor?: string;
}

interface TaskRecord {
  task: Task;
  scope: string | undefined;
  result: BoundedJsonValue | undefined;
  hasResult: boolean;
  resultWaiters: Set<(result: BoundedJsonValue | undefined) => void>;
}

function cloneTask(task: Task): Task {
  return { ...task };
}

function snapshotResult(result: unknown): BoundedJsonValue {
  const snapshot = snapshotBoundedJsonValue(result);
  if (!snapshot.success) {
    throw new TypeError("Task result must be bounded, data-only JSON");
  }
  return snapshot.value;
}

function cloneResult(result: BoundedJsonValue): BoundedJsonValue {
  // Stored results have already passed the bounded JSON snapshotter. Taking a
  // second snapshot gives every caller an independent, data-only value without
  // invoking user-defined clone hooks.
  const snapshot = snapshotBoundedJsonValue(result);
  if (!snapshot.success) {
    throw new TypeError("Stored task result is invalid");
  }
  return snapshot.value;
}

/** Stores bounded, optionally session-scoped MCP task state and results. */
export class TaskStore {
  private tasks = new Map<string, TaskRecord>();
  private lastSweep = 0;

  create(ttl: number, scope?: string): Task {
    if (!Number.isSafeInteger(ttl) || ttl <= 0) {
      throw new TypeError("Task TTL must be a positive safe integer");
    }

    this.lazySweep();
    if (
      scope !== undefined &&
      this.countScope(scope) >= MAX_SCOPED_TASKS &&
      !this.evictOldestTerminal(scope)
    ) {
      throw SERVICE_OVERLOADED.create({
        detail: "Task scope capacity reached. Wait for an existing task to finish or expire.",
      });
    }
    if (this.tasks.size >= MAX_TASKS) {
      // The lazy sweep may be throttled even though the store just reached its
      // hard bound. Reclaim newly expired entries before rejecting live work.
      this.sweep();
      if (this.tasks.size >= MAX_TASKS && !this.evictOldestTerminal()) {
        throw SERVICE_OVERLOADED.create({
          detail: "Task store capacity reached. Wait for an existing task to finish or expire.",
        });
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
    this.tasks.set(task.taskId, {
      task,
      scope,
      result: undefined,
      hasResult: false,
      resultWaiters: new Set(),
    });
    return cloneTask(task);
  }

  get(taskId: string, scope?: string): Task | undefined {
    const record = this.getRecord(taskId, scope);
    return record ? cloneTask(record.task) : undefined;
  }

  complete(taskId: string, result: unknown, scope?: string): void {
    const record = this.getRecord(taskId, scope);
    if (!record || TERMINAL_STATUSES.has(record.task.status)) return;

    // Snapshot before changing state so an invalid result cannot leave a task
    // marked completed without a retrievable result.
    record.result = snapshotResult(result);
    record.hasResult = true;
    record.task.status = "completed";
    record.task.lastUpdatedAt = new Date().toISOString();
    this.settleResultWaiters(record);
  }

  fail(
    taskId: string,
    message: string,
    scope?: string,
    result?: unknown,
  ): void {
    const record = this.getRecord(taskId, scope);
    if (!record || TERMINAL_STATUSES.has(record.task.status)) return;

    if (result !== undefined) {
      record.result = snapshotResult(result);
      record.hasResult = true;
    }
    record.task.status = "failed";
    record.task.statusMessage = message;
    record.task.lastUpdatedAt = new Date().toISOString();
    this.settleResultWaiters(record);
  }

  cancel(taskId: string, scope?: string, result?: unknown): boolean {
    const record = this.getRecord(taskId, scope);
    if (!record || TERMINAL_STATUSES.has(record.task.status)) return false;

    if (result !== undefined) {
      record.result = snapshotResult(result);
      record.hasResult = true;
    }
    record.task.status = "cancelled";
    record.task.statusMessage = "The task was cancelled by request.";
    record.task.lastUpdatedAt = new Date().toISOString();
    this.settleResultWaiters(record);
    return true;
  }

  getResult(taskId: string, scope?: string): unknown | undefined {
    const record = this.getRecord(taskId, scope);
    if (
      !record ||
      !TERMINAL_STATUSES.has(record.task.status) ||
      !record.hasResult
    ) {
      return undefined;
    }
    return cloneResult(record.result!);
  }

  async waitForResult(
    taskId: string,
    scope?: string,
    signal?: AbortSignal,
  ): Promise<unknown | undefined> {
    const record = this.getRecord(taskId, scope);
    if (!record) return undefined;
    if (TERMINAL_STATUSES.has(record.task.status)) {
      return record.hasResult ? cloneResult(record.result!) : undefined;
    }
    if (signal?.aborted) {
      throw signal.reason ??
        new DOMException("The result request was cancelled.", "AbortError");
    }

    const result = await new Promise<BoundedJsonValue | undefined>((resolve, reject) => {
      let settled = false;
      const settle = (value: BoundedJsonValue | undefined) => {
        if (settled) return;
        settled = true;
        record.resultWaiters.delete(settle);
        signal?.removeEventListener("abort", abort);
        resolve(value);
      };
      const abort = () => {
        if (settled) return;
        settled = true;
        record.resultWaiters.delete(settle);
        signal?.removeEventListener("abort", abort);
        reject(
          signal?.reason ??
            new DOMException("The result request was cancelled.", "AbortError"),
        );
      };
      record.resultWaiters.add(settle);
      signal?.addEventListener("abort", abort, { once: true });
    });
    return result === undefined ? undefined : cloneResult(result);
  }

  list(scope?: string): Task[] {
    this.lazySweep();
    return Array.from(
      this.tasks.values(),
      (record) => record.scope === scope ? cloneTask(record.task) : undefined,
    ).filter((task): task is Task => task !== undefined);
  }

  listPage(scope?: string, cursor?: string): TaskPage {
    const tasks = this.list(scope);
    let start = 0;
    if (cursor !== undefined) {
      if (typeof cursor !== "string" || cursor.length === 0) {
        throw new TypeError("Task cursor must be a non-empty string");
      }
      const cursorIndex = tasks.findIndex((task) => task.taskId === cursor);
      if (cursorIndex < 0) {
        throw new TypeError("Task cursor is invalid for this scope");
      }
      start = cursorIndex + 1;
    }

    const page = tasks.slice(start, start + TASK_LIST_PAGE_SIZE);
    const hasMore = start + page.length < tasks.length;
    return {
      tasks: page,
      ...(hasMore ? { nextCursor: page.at(-1)!.taskId } : {}),
    };
  }

  removeScope(scope: string): string[] {
    const removed: string[] = [];
    for (const [taskId, record] of this.tasks) {
      if (record.scope !== scope) continue;
      removed.push(taskId);
      this.deleteRecord(taskId, record);
    }
    return removed;
  }

  clear(): void {
    for (const [taskId, record] of this.tasks) {
      this.deleteRecord(taskId, record);
    }
  }

  private isExpired(task: Task): boolean {
    // MCP allows cleanup after the creation-based TTL elapses. Veryfront keeps
    // terminal state and results for one full TTL after the terminal transition
    // so long-running tasks still have a result retrieval window.
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
    for (const [id, record] of this.tasks) {
      if (this.isExpired(record.task)) {
        this.deleteRecord(id, record);
      }
    }
  }

  private evictOldestTerminal(scope?: string): boolean {
    // Terminal state can be evicted without losing track of active execution.
    // If every task is active, reject new work instead of exceeding the bound or
    // silently orphaning an in-flight task.
    let oldestTerminal: string | undefined;
    let oldestTerminalTime = Infinity;

    for (const [id, record] of this.tasks) {
      if (scope !== undefined && record.scope !== scope) continue;
      if (!TERMINAL_STATUSES.has(record.task.status)) continue;
      const created = new Date(record.task.createdAt).getTime();
      if (created < oldestTerminalTime) {
        oldestTerminalTime = created;
        oldestTerminal = id;
      }
    }

    if (oldestTerminal) {
      this.deleteRecord(oldestTerminal, this.tasks.get(oldestTerminal)!);
      return true;
    }

    return false;
  }

  private countScope(scope: string): number {
    let count = 0;
    for (const record of this.tasks.values()) {
      if (record.scope === scope) count++;
    }
    return count;
  }

  private getRecord(taskId: string, scope?: string): TaskRecord | undefined {
    const record = this.tasks.get(taskId);
    if (!record || record.scope !== scope) return undefined;
    if (this.isExpired(record.task)) {
      this.deleteRecord(taskId, record);
      return undefined;
    }
    return record;
  }

  private settleResultWaiters(record: TaskRecord): void {
    for (const resolve of record.resultWaiters) {
      resolve(record.hasResult ? cloneResult(record.result!) : undefined);
    }
    record.resultWaiters.clear();
  }

  private deleteRecord(taskId: string, record: TaskRecord): void {
    if (!this.tasks.delete(taskId)) return;
    for (const resolve of record.resultWaiters) resolve(undefined);
    record.resultWaiters.clear();
  }
}
