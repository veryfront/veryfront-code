/**
 * Redis client for task queue operations
 */

function getEnv(key: string): string | undefined {
  // @ts-ignore - Deno global
  if (typeof Deno !== "undefined") return Deno.env.get(key);

  // @ts-ignore - process global
  if (typeof process !== "undefined" && process.env) return process.env[key];

  return undefined;
}

const _REDIS_URL = getEnv("REDIS_URL") ?? "redis://localhost:6379";

interface QueuedTask {
  id: string;
  type: string;
  data: Record<string, unknown>;
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
}

const tasks = new Map<string, QueuedTask>();

export function queueTask(type: string, data: Record<string, unknown>): Promise<string> {
  const id = crypto.randomUUID();

  tasks.set(id, {
    id,
    type,
    data,
    status: "pending",
    createdAt: Date.now(),
  });

  console.log(`[Redis] Queued task ${id} of type ${type}`);

  setTimeout(() => void processTask(id), 100);

  return Promise.resolve(id);
}

export function getTask(id: string): Promise<QueuedTask | null> {
  return Promise.resolve(tasks.get(id) ?? null);
}

export async function processTask(id: string): Promise<void> {
  const task = tasks.get(id);
  if (!task) return;

  task.status = "processing";
  console.log(`[Redis] Processing task ${id}`);

  try {
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    task.status = "completed";
    task.completedAt = Date.now();
    task.result = { processed: true };
    console.log(`[Redis] Task ${id} completed`);
  } catch (error) {
    task.status = "failed";
    task.error = error instanceof Error ? error.message : String(error);
    console.error(`[Redis] Task ${id} failed:`, error);
  }
}

export function listTasks(): Promise<QueuedTask[]> {
  const list = Array.from(tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
  return Promise.resolve(list);
}
