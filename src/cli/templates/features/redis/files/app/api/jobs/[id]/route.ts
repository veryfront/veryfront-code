import { getJob } from "../../../../lib/redis.ts";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const job = await getJob(params.id);

  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  return Response.json({ job });
}
