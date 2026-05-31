import { listTasks, queueTask } from "../../../lib/redis.ts";

export async function GET(): Promise<Response> {
  const tasks = await listTasks();
  return Response.json({ tasks });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Failed to queue task" }, { status: 500 });
  }

  const { type, data } = (body as { type?: string; data?: unknown }) ?? {};

  if (!type) {
    return Response.json({ error: "Task type is required" }, { status: 400 });
  }

  try {
    const taskId = await queueTask(type, (data as Record<string, unknown>) ?? {});
    return Response.json({
      success: true,
      taskId,
      message: "Task queued successfully",
    });
  } catch {
    return Response.json({ error: "Failed to queue task" }, { status: 500 });
  }
}
