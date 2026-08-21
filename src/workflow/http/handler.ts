/**
 * HTTP surface for the workflow React hooks.
 *
 * `useWorkflow`, `useWorkflowStart`, `useWorkflowList` and `useApproval` all
 * call a fixed set of paths under their `apiBase` (default `/api/workflows`).
 * Those hooks are the specification for this module: every route below exists
 * because a hook calls it, and every response shape below is the one its caller
 * parses.
 *
 * @module workflow/http
 *
 * @example Mount every workflow route at once
 * ```typescript
 * // app/api/workflows/[...path]/route.ts
 * import { createWorkflowHandler } from "veryfront/workflow";
 * import { workflows } from "../../../../lib/workflows.ts";
 *
 * export const { GET, POST } = createWorkflowHandler(workflows);
 * ```
 */

import { isVeryfrontError } from "#veryfront/errors";
import type { WorkflowClient } from "../api/index.ts";
import { ApprovalDecisionSchema, RunFilterSchema } from "../schemas/index.ts";
import type {
  ApprovalDecision,
  PendingApproval,
  RunFilter,
  WorkflowContext,
  WorkflowRun,
} from "../types.ts";

/** Options for {@linkcode createWorkflowHandler}. */
export interface WorkflowHandlerOptions {
  /**
   * Path this handler is mounted at. It has to match the `apiBase` the hooks
   * use, because the handler resolves a route by what follows it.
   */
  basePath?: string;
}

/** Route handlers to re-export from a catch-all route module. */
export interface WorkflowHandlers {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
}

const DEFAULT_BASE_PATH = "/api/workflows";

class WorkflowRequestError extends Error {}

function toSegments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/**
 * Segments of `pathname` that follow `basePath`, or null when the request did
 * not land under the mount point at all.
 */
function routeSegments(pathname: string, basePath: string): string[] | null {
  const base = toSegments(basePath);
  const actual = toSegments(pathname);
  if (actual.length < base.length) return null;

  for (const [index, segment] of base.entries()) {
    if (actual[index] !== segment) return null;
  }
  return actual.slice(base.length);
}

function problem(message: string, status: number): Response {
  // `message` rather than `error`: useWorkflowStart surfaces `errorData.message`
  // to the caller, and anything else reaches the user as a bare status code.
  return Response.json({ message }, { status });
}

/**
 * Answer with the failure instead of throwing it.
 *
 * These routes drive UI, and the hooks read a status code and a `message`. An
 * escaping exception gives them neither. Framework errors already carry the
 * status they deserve, so a refusal like resuming a cancelled run reaches the
 * caller as a conflict rather than a generic 500.
 */
async function answering(work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof WorkflowRequestError) return problem(error.message, 400);
    if (isVeryfrontError(error)) return problem(error.message, error.status);
    return problem(error instanceof Error ? error.message : String(error), 500);
  }
}

/** Parse the list filter that useWorkflowList encodes into the query string. */
function readFilter(url: URL): RunFilter {
  const params = url.searchParams;
  const filter: Record<string, unknown> = {};

  const workflowId = params.get("workflowId");
  if (workflowId) filter.workflowId = workflowId;

  const statuses = params.getAll("status");
  if (statuses.length === 1) filter.status = statuses[0];
  else if (statuses.length > 1) filter.status = statuses;

  const createdAfter = params.get("createdAfter");
  if (createdAfter) filter.createdAfter = new Date(createdAfter);

  const createdBefore = params.get("createdBefore");
  if (createdBefore) filter.createdBefore = new Date(createdBefore);

  const limit = params.get("limit");
  if (limit !== null) filter.limit = Number(limit);

  // The hook round-trips an opaque `cursor`; this backend paginates by offset,
  // so the cursor is the offset. Keeping it opaque on the wire leaves room to
  // change that without touching the hook.
  const cursor = params.get("cursor");
  if (cursor !== null) filter.offset = Number(cursor);

  try {
    return RunFilterSchema.parse(filter);
  } catch {
    throw new WorkflowRequestError("Invalid workflow run filter");
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new WorkflowRequestError("Request body must contain valid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new WorkflowRequestError("Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

function projectContext(context: WorkflowContext): WorkflowContext {
  const { env: _env, _tenant: _tenant, _loop: _loop, ...publicContext } = context;
  return publicContext as WorkflowContext;
}

function projectRun(
  run: WorkflowRun,
  pendingApprovals: PendingApproval[] = run.pendingApprovals,
): Record<string, unknown> {
  const {
    _tenant: _tenant,
    _runtimeStateVersion: _runtimeStateVersion,
    _workflowProjection: _workflowProjection,
    checkpoints: _checkpoints,
    workerId: _workerId,
    heartbeatAt: _heartbeatAt,
    error,
    context,
    pendingApprovals: _pendingApprovals,
    ...publicRun
  } = run;

  return {
    ...publicRun,
    context: projectContext(context),
    pendingApprovals,
    ...(error ? { error: { message: error.message, nodeId: error.nodeId } } : {}),
  };
}

/**
 * Build the HTTP routes the workflow hooks call.
 *
 * Pass the same client the rest of the app starts workflows with. A client
 * created here instead would carry its own in-memory backend and would not see
 * those runs.
 */
export function createWorkflowHandler(
  client: WorkflowClient,
  options: WorkflowHandlerOptions = {},
): WorkflowHandlers {
  const basePath = options.basePath ?? DEFAULT_BASE_PATH;

  function GET(request: Request): Promise<Response> {
    return answering(async () => {
      const url = new URL(request.url);
      const segments = routeSegments(url.pathname, basePath);
      if (!segments) return problem("Not a workflow route", 404);

      const [first, runId, third, approvalId] = segments;

      if (segments.length === 1 && first === "runs") {
        const filter = readFilter(url);
        const runs = await client.listRuns(filter);
        const offset = filter.offset ?? 0;
        const cursor = filter.limit && runs.length === filter.limit
          ? String(offset + runs.length)
          : undefined;
        return Response.json({ runs: runs.map((run) => projectRun(run)), cursor });
      }

      if (segments.length === 2 && first === "runs" && runId) {
        const run = await client.getRun(runId);
        if (!run) return problem(`No workflow run ${runId}`, 404);

        // A waiting run does not carry its own pending approvals: they live in
        // the approval manager, while `run.pendingApprovals` stays empty.
        // useWorkflow reads them off the run body to fire onApprovalRequired,
        // so the projection has to put them back or a paused workflow never
        // surfaces its approval. The durable fix belongs in the run record.
        const pendingApprovals = await client.getPendingApprovals(runId);
        return Response.json(projectRun(run, pendingApprovals));
      }

      if (
        segments.length === 4 && first === "runs" && runId && third === "approvals" && approvalId
      ) {
        const approvals = await client.getPendingApprovals(runId);
        const approval = approvals.find((candidate) => candidate.id === approvalId);
        if (!approval) return problem(`No approval ${approvalId} on run ${runId}`, 404);
        return Response.json(approval);
      }

      return problem(`Unknown workflow route ${url.pathname}`, 404);
    });
  }

  function POST(request: Request): Promise<Response> {
    return answering(async () => {
      const url = new URL(request.url);
      const segments = routeSegments(url.pathname, basePath);
      if (!segments) return problem("Not a workflow route", 404);

      const [first, second, third, approvalId] = segments;

      if (segments.length === 2 && first && first !== "runs" && second === "start") {
        const body = await readJson(request);
        const handle = await client.start(first, body.input);
        return Response.json({ runId: handle.runId });
      }

      if (segments.length === 3 && first === "runs" && second && third === "cancel") {
        await client.cancel(second);
        return Response.json({ runId: second, status: "cancelled" });
      }

      if (segments.length === 3 && first === "runs" && second && third === "retry") {
        await client.retry(second);
        return Response.json({ runId: second, status: "retrying" });
      }

      if (
        segments.length === 4 && first === "runs" && second && third === "approvals" && approvalId
      ) {
        let decision: ApprovalDecision;
        try {
          decision = ApprovalDecisionSchema.parse(await readJson(request));
        } catch (error) {
          if (error instanceof WorkflowRequestError) throw error;
          throw new WorkflowRequestError(
            "An approval decision needs an `approved` boolean and an `approver` string",
          );
        }

        const resolved = decision.approved
          ? await client.approve(
            second,
            approvalId,
            decision.approver,
            decision.comment,
            decision.data,
          )
          : await client.reject(
            second,
            approvalId,
            decision.approver,
            decision.comment,
            decision.data,
          );

        return Response.json({ approvalId, approved: decision.approved, result: resolved ?? null });
      }

      return problem(`Unknown workflow route ${url.pathname}`, 404);
    });
  }

  return { GET, POST };
}
