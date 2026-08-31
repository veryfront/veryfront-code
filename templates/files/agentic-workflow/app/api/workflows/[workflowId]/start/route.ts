import { startDemoWorkflowRun } from "../../sample-runs.ts";

export async function POST(
  request: Request,
  context: { params: Record<string, string> },
): Promise<Response> {
  const body = await request.json().catch(() => ({})) as {
    input?: { topic?: string };
  };
  const workflowId = context.params.workflowId;
  if (!workflowId) {
    return Response.json({ message: "Workflow ID is required" }, { status: 400 });
  }
  const run = startDemoWorkflowRun(workflowId, body.input);

  return Response.json({
    runId: run.id,
  });
}
