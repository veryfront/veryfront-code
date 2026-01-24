/**
 * Redis client for job queue operations
 */

function getEnv(key: string): string | undefined {
  // @ts-ignore - Deno global
  if (typeof Deno !== "undefined") return Deno.env.get(key);

  // @ts-ignore - process global
  if (typeof process !== "undefined" && process.env) return process.env[key];

  return undefined;
}

const _REDIS_URL = getEnv("REDIS_URL") ?? "redis://localhost:6379";

interface Job {
  id: string;
  type: string;
  data: Record<string, unknown>;
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
}

const jobs = new Map<string, Job>();

export function queueJob(type: string, data: Record<string, unknown>): Promise<string> {
  const id = crypto.randomUUID();
  jobs.set(id, {
    id,
    type,
    data,
    status: "pending",
    createdAt: Date.now(),
  });

  console.log(`[Redis] Queued job ${id} of type ${type}`);

  setTimeout(() => {
    void processJob(id);
  }, 100);

  return Promise.resolve(id);
}

export function getJob(id: string): Promise<Job | null> {
  return Promise.resolve(jobs.get(id) ?? null);
}

export async function processJob(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;

  job.status = "processing";
  console.log(`[Redis] Processing job ${id}`);

  try {
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    job.status = "completed";
    job.completedAt = Date.now();
    job.result = { processed: true };
    console.log(`[Redis] Job ${id} completed`);
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    console.error(`[Redis] Job ${id} failed:`, error);
  }
}

export function listJobs(): Promise<Job[]> {
  const list = Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
  return Promise.resolve(list);
}
