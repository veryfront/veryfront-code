/**
 * HTTP surface for workflow React hooks and run-event clients.
 *
 * `useWorkflow`, `useWorkflowStart`, `useWorkflowList` and `useApproval` all
 * call a fixed set of paths under their `apiBase` (default `/api/workflows`).
 * Those clients are the specification for this module. Every response shape
 * below is the one its caller parses.
 *
 * Generic run reads return `WorkflowRunSummary` values. They omit
 * workflow input, output, context, node payloads, checkpoints, approval
 * payloads, source policy, and framework metadata. Use a separately authorized
 * server route backed by `WorkflowClient` when an application must expose
 * selected run interiors.
 *
 * @module workflow/http
 *
 * @example Mount every workflow route at once
 * ```typescript
 * // app/api/workflows/[...path]/route.ts
 * import { createWorkflowHandler } from "veryfront/workflow";
 * import { getSession } from "../../../../lib/auth.ts";
 * import { workflows } from "../../../../lib/workflows.ts";
 *
 * export const { GET, POST } = createWorkflowHandler(workflows, {
 *   authorize: async (request) => (await getSession(request))?.user.id ?? null,
 * });
 * ```
 */

import { isVeryfrontError } from "#veryfront/errors";
import { logger as baseLogger } from "#veryfront/utils";
import type { WorkflowClient } from "../api/index.ts";
import { ApprovalDecisionSchema, RunFilterSchema } from "../schemas/index.ts";
import { isTerminalRunStatus, type WorkflowRunEventObservation } from "../events.ts";
import type { ApprovalDecision, RunFilter } from "../types.ts";
import { DEFAULT_WORKFLOW_RUN_LIST_LIMIT } from "../limits.ts";
import { projectWorkflowRunSummary } from "./run-summary.ts";

/** Options for {@linkcode createWorkflowHandler}. */
export interface WorkflowHandlerOptions {
  /**
   * Authorize a request and return the authenticated approver identity.
   * Return null to deny access. The handler uses this server-derived identity
   * for approval decisions instead of trusting the request body. This callback
   * does not add per-run ownership filtering. Only authorize identities allowed
   * to read every run summary and approval payload visible to this client.
   */
  authorize: (request: Request) => string | null | Promise<string | null>;
  /** Maximum number of active event streams for this handler instance. */
  maxEventStreams?: number;
  /** Maximum number of active event streams for one authorized identity. */
  maxEventStreamsPerIdentity?: number;
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
const DEFAULT_MAX_EVENT_STREAMS = 64;
const DEFAULT_MAX_EVENT_STREAMS_PER_IDENTITY = 8;
const logger = baseLogger.component("workflow-http");

class WorkflowRequestError extends Error {}

function readPositiveLimit(value: number | undefined, fallback: number, name: string): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return limit;
}

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

function canonicalWorkflowPath(basePath: string, segments: readonly string[]): string {
  const baseUrl = new URL("https://workflow.invalid");
  baseUrl.pathname = `/${basePath.split("/").filter(Boolean).join("/")}`;
  const normalizedBase = baseUrl.pathname;
  const encodedSuffix = segments.map((segment) => encodeURIComponent(segment)).join("/");
  if (!encodedSuffix) return normalizedBase;
  return normalizedBase === "/" ? `/${encodedSuffix}` : `${normalizedBase}/${encodedSuffix}`;
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
  const filter: Record<string, unknown> = { limit: DEFAULT_WORKFLOW_RUN_LIST_LIMIT };

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
  release: () => void,
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
    ]).then(() => {
      release();
    });
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
          const snapshot = projectWorkflowRunSummary(observation.initial);
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
 * sends the current run summary as `snapshot`, followed by persisted step and
 * run-status events, and closes on a terminal run. Missing runs return 404.
 * Custom backends without atomic run observation return 501. Observation
 * failures send one sanitized `error` event with `retryable: true`, then close.
 * When the active stream limit is reached, the route returns 429 before opening
 * a backend observation. The default limits are 64 streams per handler and 8
 * streams per authorized identity; both limits can be configured below.
 * A snapshot that cannot be serialized fails the same way on every reconnect,
 * so that error event carries `retryable: false` instead.
 */
export function createWorkflowHandler(
  client: WorkflowClient,
  options: WorkflowHandlerOptions,
): WorkflowHandlers {
  const basePath = (options.basePath ?? DEFAULT_BASE_PATH).replace(/\/+$/, "") || "/";
  const maxEventStreams = readPositiveLimit(
    options.maxEventStreams,
    DEFAULT_MAX_EVENT_STREAMS,
    "maxEventStreams",
  );
  const maxEventStreamsPerIdentity = readPositiveLimit(
    options.maxEventStreamsPerIdentity,
    DEFAULT_MAX_EVENT_STREAMS_PER_IDENTITY,
    "maxEventStreamsPerIdentity",
  );
  let activeEventStreams = 0;
  const activeEventStreamsByIdentity = new Map<string, number>();

  const reserveEventStream = (identity: string): (() => void) | undefined => {
    const activeForIdentity = activeEventStreamsByIdentity.get(identity) ?? 0;
    if (
      activeEventStreams >= maxEventStreams ||
      activeForIdentity >= maxEventStreamsPerIdentity
    ) return undefined;
    activeEventStreams++;
    activeEventStreamsByIdentity.set(identity, activeForIdentity + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeEventStreams--;
      const remainingForIdentity = (activeEventStreamsByIdentity.get(identity) ?? 1) - 1;
      if (remainingForIdentity === 0) activeEventStreamsByIdentity.delete(identity);
      else activeEventStreamsByIdentity.set(identity, remainingForIdentity);
    };
  };

  function GET(request: Request): Promise<Response> {
    return answering(async () => {
      const url = new URL(request.url);
      const segments = routeSegments(url.pathname, basePath);
      if (!segments) return problem("Not a workflow route", 404);
      if (url.pathname !== canonicalWorkflowPath(basePath, segments)) {
        return problem("Workflow route must use its canonical path", 400);
      }
      const authorizedIdentity = await options.authorize(request);
      if (authorizedIdentity === null) {
        return problem("Workflow request is not authorized", 403);
      }

      const [first, runId, third, approvalId] = segments;

      if (segments.length === 1 && first === "runs") {
        const filter = readFilter(url);
        const runs = await client.listRuns(filter);
        const offset = filter.offset ?? 0;
        const cursor = filter.limit && runs.length === filter.limit
          ? String(offset + runs.length)
          : undefined;
        return Response.json({
          runs: runs.map((run) => projectWorkflowRunSummary(run)),
          cursor,
        });
      }

      if (segments.length === 2 && first === "runs" && runId) {
        const run = await client.getRun(runId);
        if (!run) return problem(`No workflow run ${runId}`, 404);
        return Response.json(projectWorkflowRunSummary(run));
      }

      if (segments.length === 3 && first === "runs" && runId && third === "events") {
        const release = reserveEventStream(authorizedIdentity);
        if (!release) return problem("Too many workflow event streams", 429);
        try {
          const observation = await client.observeRunEvents(runId, { signal: request.signal });
          if (!observation) {
            release();
            return problem(`No workflow run ${runId}`, 404);
          }
          if (!observation.supported) {
            release();
            return problem("Workflow event observation is not supported", 501);
          }
          return runEventStream(observation, request.signal, runId, release);
        } catch (error) {
          release();
          throw error;
        }
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
      if (url.pathname !== canonicalWorkflowPath(basePath, segments)) {
        return problem("Workflow route must use its canonical path", 400);
      }
      const authorizedApprover = await options.authorize(request.clone());
      if (authorizedApprover === null) return problem("Workflow request is not authorized", 403);

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
            authorizedApprover,
            decision.comment,
            decision.data,
          )
          : await client.reject(
            second,
            approvalId,
            authorizedApprover,
            decision.comment,
            decision.data,
          );

        return Response.json({
          approvalId,
          approved: decision.approved,
          result: resolved ?? null,
          resolvedBy: authorizedApprover,
        });
      }

      return problem(`Unknown workflow route ${url.pathname}`, 404);
    });
  }

  return { GET, POST };
}
