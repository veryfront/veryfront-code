import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import {
  boundAgUiRequestBody,
  createAgUiBodyLimitErrorResponse,
  extractRequest,
  parseAgUiJsonBody,
} from "./request-shared.ts";
import {
  RunNotActiveError,
  RunResumeSessionManager,
  WaitConflictError,
  WaitNotPendingError,
} from "../runtime/resume-session.ts";
import {
  cancelUnusedRequestBody,
  createApplicationRequest,
} from "#veryfront/security/http/application-request.ts";
import {
  authorizeRunControl,
  type RunControlAuthorizer,
} from "../runtime/run-control-authority.ts";

const RESUME_PATH_REGEX = /^\/api\/runs\/([^/]+)\/resume$/;
const CANCEL_PATH_REGEX = /^\/api\/runs\/([^/]+)$/;

export const getAgUiResumeSignalSchema = defineSchema((v) =>
  v.discriminatedUnion("type", [
    v.object({
      type: v.literal("tool_result"),
      toolCallId: v.string().min(1).max(128),
      result: v.unknown(),
      isError: v.boolean().optional().default(false),
    }),
  ])
);

/** Schema for AG-UI resume signal.
 * @deprecated Use getAgUiResumeSignalSchema()
 */
export const AgUiResumeSignalSchema = lazySchema(getAgUiResumeSignalSchema);

/** Public API contract for AG-UI resume signal. */
export type AgUiResumeSignal = InferSchema<ReturnType<typeof getAgUiResumeSignalSchema>>;

type ResumeValue = {
  result: unknown;
  isError: boolean;
};

function getRunId(pathname: string, regex: RegExp): string | null {
  return regex.exec(pathname)?.[1] ?? null;
}

export interface AgUiRunControlHandlerOptions {
  resolveRunId?:
    | ((input: { request: Request; requestOrCtx: unknown }) => string | null)
    | ((input: { request: Request; requestOrCtx: unknown }) => Promise<string | null>);
  /**
   * Decide whether this request may control this exact run. Required: these
   * handlers reach a run registry keyed by run id alone, so a surface that
   * mounts one without an authority decision would let any authenticated
   * caller control another caller's run. Return `true` only for a caller whose
   * permission for this run and operation has been verified.
   */
  authorizeRunControl: RunControlAuthorizer;
}

/** Options accepted by AG-UI resume handler. */
export interface AgUiResumeHandlerOptions extends AgUiRunControlHandlerOptions {
  sessionManager: RunResumeSessionManager<ResumeValue>;
}

/** Options accepted by AG-UI cancel handler. */
export interface AgUiCancelHandlerOptions<T = unknown> extends AgUiRunControlHandlerOptions {
  sessionManager: RunResumeSessionManager<T>;
}

async function resolveRunId(
  request: Request,
  options: AgUiRunControlHandlerOptions | undefined,
  regex: RegExp,
): Promise<string | null> {
  const applicationRequest = options?.resolveRunId ? createApplicationRequest(request) : request;
  try {
    const explicit = await options?.resolveRunId?.({
      request: applicationRequest,
      requestOrCtx: applicationRequest,
    });
    if (explicit) return explicit;
    return getRunId(new URL(request.url).pathname, regex);
  } finally {
    if (applicationRequest !== request) cancelUnusedRequestBody(applicationRequest);
  }
}

/** Handler for create AG-UI resume. */
export function createAgUiResumeHandler(
  options: AgUiResumeHandlerOptions,
): (requestOrCtx: unknown) => Promise<Response> {
  return async function POST(requestOrCtx: unknown): Promise<Response> {
    const request = await boundAgUiRequestBody(
      extractRequest(requestOrCtx),
      "Invalid AG-UI run control request",
      true,
    );
    if (request instanceof Response) return request;
    const runId = await resolveRunId(request, options, RESUME_PATH_REGEX);

    if (!runId) {
      return Response.json({ error: "Run not found" }, { status: 404 });
    }

    const authorizationRequest = createApplicationRequest(request);
    const authority = await authorizeRunControl(options.authorizeRunControl, {
      request: authorizationRequest,
      runId,
      operation: "resume",
    }).finally(() => cancelUnusedRequestBody(authorizationRequest));
    if (!authority) {
      return Response.json({ errorCode: "FORBIDDEN" }, { status: 403 });
    }

    try {
      const parsed = getAgUiResumeSignalSchema().parse(await parseAgUiJsonBody(request));
      const outcome = options.sessionManager.submitSignalWithAuthority(authority, {
        waitKey: parsed.toolCallId,
        value: {
          result: parsed.result,
          isError: parsed.isError,
        },
      });

      return Response.json(outcome, { status: 200 });
    } catch (error) {
      const bodyLimitError = createAgUiBodyLimitErrorResponse(
        error,
        "Invalid AG-UI resume request",
      );
      if (bodyLimitError) return bodyLimitError;

      if (
        error instanceof Error &&
        "issues" in error &&
        Array.isArray((error as Record<string, unknown>).issues)
      ) {
        const issues = (error as { issues: Array<{ path: unknown[]; message: string }> }).issues;
        return Response.json(
          {
            error: "Invalid AG-UI resume request",
            details: issues.map((issue) => ({
              path: issue.path,
              message: issue.message,
            })),
          },
          { status: 400 },
        );
      }

      if (error instanceof WaitConflictError) {
        return Response.json({ error: "TOOL_RESULT_CONFLICT" }, { status: 409 });
      }

      if (error instanceof WaitNotPendingError) {
        return Response.json({ error: "TOOL_RESULT_NOT_WAITING" }, { status: 409 });
      }

      if (error instanceof RunNotActiveError) {
        return Response.json({ error: "RUN_NOT_ACTIVE" }, { status: 410 });
      }

      return Response.json(
        {
          error: error instanceof Error ? error.message : "Internal resume failed",
        },
        { status: 500 },
      );
    }
  };
}

/**
 * Cancel reason sent by the control plane when it parks a run on an integration
 * auth wall. The turn is stopped, but the run stays startable so the resume that
 * follows once the integration is connected is not refused.
 */
const INTEGRATION_AUTH_PARK_CANCEL_REASON = "integration_auth_park";

function parsePositiveEventId(value: string | null): number | undefined {
  if (value === null || !/^[1-9][0-9]*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** Handler for create AG-UI cancel. */
export function createAgUiCancelHandler<T = unknown>(
  options: AgUiCancelHandlerOptions<T>,
): (requestOrCtx: unknown) => Promise<Response> {
  return async function DELETE(requestOrCtx: unknown): Promise<Response> {
    const request = await boundAgUiRequestBody(
      extractRequest(requestOrCtx),
      "Invalid AG-UI run control request",
      true,
    );
    if (request instanceof Response) return request;
    const runId = await resolveRunId(request, options, CANCEL_PATH_REGEX);

    if (!runId) {
      return Response.json({ error: "Run not found" }, { status: 404 });
    }

    const authorizationRequest = createApplicationRequest(request);
    const authority = await authorizeRunControl(options.authorizeRunControl, {
      request: authorizationRequest,
      runId,
      operation: "cancel",
    }).finally(() => cancelUnusedRequestBody(authorizationRequest));
    if (!authority) {
      return Response.json({ errorCode: "FORBIDDEN" }, { status: 403 });
    }

    // A park stops the turn so a waiting run cannot finish, then resumes the same
    // run later. Remembering that cancellation outright would refuse the resume
    // start as a delayed start of a cancelled run, so a park cancellation only
    // refuses delayed starts dispatched from before the parked event.
    // The authority check above already limits this to a verified caller.
    const parkCancellation =
      new URL(request.url).searchParams.get("reason") === INTEGRATION_AUTH_PARK_CANCEL_REASON;
    const parkedAfterEventId = parkCancellation
      ? parsePositiveEventId(new URL(request.url).searchParams.get("parked_after_event_id"))
      : undefined;
    const accepted = options.sessionManager.cancelRunWithAuthority(authority, {
      rememberCancellation: !parkCancellation,
      ...(parkedAfterEventId !== undefined
        ? { onlyIfStartedBeforeEventId: parkedAfterEventId }
        : {}),
    });
    if (accepted) {
      return Response.json({ accepted: true }, { status: 202 });
    }

    return new Response(null, { status: 204 });
  };
}
