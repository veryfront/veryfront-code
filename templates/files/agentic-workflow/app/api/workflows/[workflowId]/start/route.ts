import { startDemoWorkflowRun } from "../../sample-runs.ts";

export async function POST(
  request: Request,
  context: { params: Record<string, string> },
): Promise<Response> {
  const body = await request.json().catch(() => ({})) as {
    input?: { topic?: string };
  };
  const run = startDemoWorkflowRun(context.params.workflowId, body.input);

  return Response.json({
    success: true,
    runId: run.id,
    id: run.id,
    workflowId: run.workflowId,
    status: run.status,
    input: run.input,
    createdAt: run.createdAt,
  });
}
