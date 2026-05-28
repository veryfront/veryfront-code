import { createDemoWorkflowRun } from "../sample-runs.ts";

export function GET(request: Request): Response {
  const url = new URL(request.url);
  const workflowId = url.searchParams.get("workflowId");
  const limit = Number(url.searchParams.get("limit") ?? "20");

  const runs = [createDemoWorkflowRun()].filter((run) =>
    !workflowId || run.workflowId === workflowId
  ).slice(0, Number.isFinite(limit) ? limit : 20);

  return Response.json({
    runs,
    totalCount: runs.length,
  });
}
