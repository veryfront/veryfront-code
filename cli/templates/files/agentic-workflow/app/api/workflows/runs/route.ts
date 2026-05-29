import { listDemoWorkflowRuns } from "../sample-runs.ts";

export function GET(request: Request): Response {
  const url = new URL(request.url);
  const workflowId = url.searchParams.get("workflowId");
  const limit = Number(url.searchParams.get("limit") ?? "20");

  const runs = listDemoWorkflowRuns({ workflowId, limit });

  return Response.json({
    runs,
    totalCount: runs.length,
  });
}
