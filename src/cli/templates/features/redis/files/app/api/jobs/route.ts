import { listJobs, queueJob } from "../../../lib/redis.ts";

export async function GET() {
  const jobs = await listJobs();
  return Response.json({ jobs });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { type, data } = body;

    if (!type) {
      return Response.json({ error: "Job type is required" }, { status: 400 });
    }

    const jobId = await queueJob(type, data || {});

    return Response.json({
      success: true,
      jobId,
      message: "Job queued successfully",
    });
  } catch (_error) {
    return Response.json({ error: "Failed to queue job" }, { status: 500 });
  }
}
