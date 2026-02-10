/**
 * Workflow API Routes
 *
 * POST /api/workflow         - Start a workflow
 * GET  /api/workflow?id=...  - Check workflow status
 */

import type { APIContext } from "veryfront/context";
import { WorkflowClient } from "veryfront/workflow";
import { codeReviewWorkflow, bugFixWorkflow } from "../../../workflows/index.ts";

// Create client (in-memory backend for local dev)
const client = new WorkflowClient();
client.register(codeReviewWorkflow);
client.register(bugFixWorkflow);

/**
 * Start a workflow
 *
 * POST /api/workflow
 * Body: { workflow: "code-review" | "bug-fix", input: {...} }
 */
export async function POST(ctx: APIContext) {
  const body = await ctx.request.json();
  const { workflow: workflowId, input } = body;

  if (!workflowId || !input) {
    return ctx.json({ error: "Missing workflow or input" }, { status: 400 });
  }

  try {
    const handle = await client.start(workflowId, input);
    return ctx.json({ runId: handle.runId, status: "started" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return ctx.json({ error: message }, { status: 500 });
  }
}

/**
 * Check workflow status
 *
 * GET /api/workflow?id=<runId>
 */
export async function GET(ctx: APIContext) {
  const url = new URL(ctx.request.url);
  const runId = url.searchParams.get("id");

  if (!runId) {
    return ctx.json({ error: "Missing id parameter" }, { status: 400 });
  }

  try {
    const run = await client.getStatus(runId);
    if (!run) {
      return ctx.json({ error: "Run not found" }, { status: 404 });
    }
    return ctx.json(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return ctx.json({ error: message }, { status: 500 });
  }
}
