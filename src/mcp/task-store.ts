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

export class TaskStore {
  private tasks = new Map<string, Task>();
  private results = new Map<string, unknown>();

  create(ttl: number): Task {
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
    return this.tasks.get(taskId);
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
    const task = this.tasks.get(taskId);
    if (!task || !TERMINAL_STATUSES.has(task.status)) return undefined;
    return this.results.get(taskId);
  }

  list(): Task[] {
    return Array.from(this.tasks.values());
  }

  clear(): void {
    this.tasks.clear();
    this.results.clear();
  }
}
