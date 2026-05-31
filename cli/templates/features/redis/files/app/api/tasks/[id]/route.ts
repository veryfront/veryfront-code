import { getTask } from "../../../../lib/redis.ts";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const task = await getTask(params.id);

  if (!task) return Response.json({ error: "Task not found" }, { status: 404 });

  return Response.json({ task });
}
