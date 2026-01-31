import { listJobs, queueJob } from "../../../lib/redis.ts";

export async function GET(): Promise<Response> {
  const jobs = await listJobs();
  return Response.json({ jobs });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Failed to queue job" }, { status: 500 });
  }

  const { type, data } = (body as { type?: string; data?: unknown }) ?? {};

  if (!type) {
    return Response.json({ error: "Job type is required" }, { status: 400 });
  }

  try {
    const jobId = await queueJob(type, (data as Record<string, unknown>) ?? {});
    return Response.json({
      success: true,
      jobId,
      message: "Job queued successfully",
    });
  } catch {
    return Response.json({ error: "Failed to queue job" }, { status: 500 });
  }
}
