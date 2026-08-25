/**
 * HTTP surface for workflow React hooks and run-event clients.
 *
 * `useWorkflow`, `useWorkflowStart`, `useWorkflowList` and `useApproval` all
 * call a fixed set of paths under their `apiBase` (default `/api/workflows`).
 * Those clients are the specification for this module. Every response shape
 * below is the one its caller parses.
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
import { logger as baseLogger } from "#veryfront/utils";
import type { WorkflowClient } from "../api/index.ts";
import { ApprovalDecisionSchema, RunFilterSchema } from "../schemas/index.ts";
import { isTerminalRunStatus, type WorkflowRunEventObservation } from "../events.ts";
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
const logger = baseLogger.component("workflow-http");

class WorkflowRequestError extends Error {}

function readDecimalInteger(value: string): number {
  if (!/^[0-9]+$/.test(value)) {
    throw new WorkflowRequestError("Invalid workflow run filter");
  }
  return Number(value);
}

function toSegments(path: string): string[] {
  return path.split("/").filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      throw new WorkflowRequestError("Invalid workflow route encoding");
    }
  });
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
    return problem("Internal workflow handler error", 500);
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
  if (limit !== null) filter.limit = readDecimalInteger(limit);

  // The hook round-trips an opaque `cursor`; this backend paginates by offset,
  // so the cursor is the offset. Keeping it opaque on the wire leaves room to
  // change that without touching the hook.
  const cursor = params.get("cursor");
  if (cursor !== null) filter.offset = readDecimalInteger(cursor);

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
): Record<string, unknown> & Pick<WorkflowRun, "status"> {
  const {
    _tenant: _tenant,
    _runtimeStateVersion: _runtimeStateVersion,
    _workflowProjection: _workflowProjection,
    _traceContext: _traceContext,
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
 * Stream a run's transitions as Server-Sent Events until it reaches a terminal
 * status or the client disconnects.
 *
 * Polling `GET /runs/:id` is the alternative, and it cannot report a
 * transition that begins and ends inside one interval. A fast step is simply
 * never seen. This reports every persisted change once, in order.
 *
 * The current run is sent first as a `snapshot` event, and the diff baseline
 * is seeded from that same read. A subscriber therefore starts from a known
 * state and receives only what happened after it, rather than having to
 * reconstruct the run from a partial event history it joined midway.
 */
function runEventStream(
  observation: WorkflowRunEventObservation,
  signal: AbortSignal,
  runId: string,
): Response {
  const encoder = new TextEncoder();
  const iterator = observation.events[Symbol.asyncIterator]();
  let snapshotPending = true;
  let closed = false;
  let cleanupPromise: Promise<void> | undefined;

  const cleanup = (): Promise<void> => {
    if (cleanupPromise) return cleanupPromise;
    signal.removeEventListener("abort", abort);
    const returnIterator = (() => {
      try {
        return Promise.resolve(iterator.return?.());
      } catch (error) {
        return Promise.reject(error);
      }
    })();
    const closeObservation = (() => {
      try {
        return Promise.resolve(observation.close());
      } catch (error) {
        return Promise.reject(error);
      }
    })();
    cleanupPromise = Promise.allSettled([
      returnIterator,
      closeObservation,
    ]).then(() => {});
    return cleanupPromise;
  };

  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;

  const close = (): void => {
    if (closed) return;
    closed = true;
    try {
      streamController?.close();
    } catch {
      // The body may already have been cancelled by its consumer.
    }
    void cleanup();
  };

  function abort(): void {
    close();
  }

  const encode = (event: string, data: unknown): Uint8Array =>
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const failStream = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    frame: { code: string; message: string; retryable: boolean },
  ): void => {
    controller.enqueue(encode("error", frame));
    close();
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      if (signal.aborted) {
        close();
        return;
      }
      signal.addEventListener("abort", abort);
    },
    async pull(controller) {
      if (closed) return;

      if (snapshotPending) {
        snapshotPending = false;
        try {
          const snapshot = projectRun(observation.initial);
          controller.enqueue(encode("snapshot", snapshot));
          if (isTerminalRunStatus(snapshot.status)) close();
        } catch {
          // A snapshot failure raises the run's own data (a getter or `toJSON`
          // can throw with customer content), so log a classification rather
          // than the error itself. Reconnecting re-reads the same stored run
          // and fails the same way, so the failure is not retryable.
          logger.error("Workflow run snapshot serialization failed", {
            runId,
            errorName: "serialization_error",
          });
          failStream(controller, {
            code: "workflow_snapshot_serialization_failed",
            message: "Workflow run snapshot could not be serialized",
            retryable: false,
          });
        }
        return;
      }

      try {
        const next = await iterator.next();
        if (closed) return;
        if (next.done) {
          close();
          return;
        }

        controller.enqueue(encode(next.value.type, next.value));
        if (
          next.value.type === "run.status" && isTerminalRunStatus(next.value.status)
        ) close();
      } catch (error) {
        if (closed) return;
        logger.error("Workflow event observation failed", {
          runId,
        }, error);
        failStream(controller, {
          code: "workflow_observation_failed",
          message: "Workflow event observation failed",
          retryable: true,
        });
      }
    },
    cancel() {
      closed = true;
      return cleanup();
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Proxies that buffer by default would defeat the point of streaming.
      "x-accel-buffering": "no",
    },
  });
}

/**
 * Build the HTTP routes the workflow hooks call.
 *
 * Pass the same client the rest of the app starts workflows with. A client
 * created here instead would carry its own in-memory backend and would not see
 * those runs.
 *
 * `GET {basePath}/runs/{runId}/events` returns a Server-Sent Events stream. It
 * sends the current public run as `snapshot`, followed by persisted step and
 * run-status events, and closes on a terminal run. Missing runs return 404.
 * Custom backends without atomic run observation return 501. Observation
 * failures send one sanitized `error` event with `retryable: true`, then close.
 * A snapshot that cannot be serialized fails the same way on every reconnect,
 * so that error event carries `retryable: false` instead.
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
        return Response.json(projectRun(run));
      }

      if (segments.length === 3 && first === "runs" && runId && third === "events") {
        const observation = await client.observeRunEvents(runId, { signal: request.signal });
        if (!observation) return problem(`No workflow run ${runId}`, 404);
        if (!observation.supported) {
          return problem("Workflow event observation is not supported", 501);
        }
        return runEventStream(observation, request.signal, runId);
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
