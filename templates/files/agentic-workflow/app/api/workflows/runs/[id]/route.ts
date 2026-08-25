import { getDemoWorkflowRun } from "../../sample-runs.ts";

export function GET(
  _request: Request,
  context: { params: Record<string, string> },
): Response {
  return Response.json(getDemoWorkflowRun(context.params.id));
}
