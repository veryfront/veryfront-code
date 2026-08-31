import {
  getDemoWorkflowRun,
  projectDemoWorkflowRunSummary,
} from "../../sample-runs.ts";

export function GET(
  _request: Request,
  context: { params: Record<string, string> },
): Response {
  const runId = context.params.id;
  if (!runId) return Response.json({ message: "Workflow run ID is required" }, { status: 400 });
  return Response.json(projectDemoWorkflowRunSummary(getDemoWorkflowRun(runId)));
}
