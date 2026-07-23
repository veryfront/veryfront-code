import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import {
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

const RESUME_PATH_REGEX = /^\/api\/runs\/([^/]+)\/resume$/;
const CANCEL_PATH_REGEX = /^\/api\/runs\/([^/]+)$/;

/** Signal submitted to resume a waiting AG-UI tool call. */
export interface AgUiResumeSignal {
  /** Signal discriminator. */
  type: "tool_result";
  /** Waiting tool call identifier. */
  toolCallId: string;
  /** Tool result supplied by the client. */
  result?: unknown;
  /** Whether the result represents a tool error. */
  isError: boolean;
}

/** Returns the AG-UI resume signal schema. */
export const getAgUiResumeSignalSchema: () => Schema<AgUiResumeSignal> = defineSchema((v) =>
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
export const AgUiResumeSignalSchema: Schema<AgUiResumeSignal> = lazySchema(
  getAgUiResumeSignalSchema,
);

/** Value submitted when an AG-UI tool wait resumes. */
export type ResumeValue = {
  /** Tool result supplied by the client. */
  result: unknown;
  /** Whether the submitted result represents a tool error. */
  isError: boolean;
};

function getRunId(pathname: string, regex: RegExp): string | null {
  return regex.exec(pathname)?.[1] ?? null;
}

/** Shared options for AG-UI run-control handlers. */
export interface AgUiRunControlHandlerOptions {
  /** Resolves the durable run identifier for a request. */
  resolveRunId?:
    | ((input: { request: Request; requestOrCtx: unknown }) => string | null)
    | ((input: { request: Request; requestOrCtx: unknown }) => Promise<string | null>);
}

/** Options accepted by AG-UI resume handler. */
export interface AgUiResumeHandlerOptions extends AgUiRunControlHandlerOptions {
  /** Session manager value. */
  sessionManager: RunResumeSessionManager<ResumeValue>;
}

/** Options accepted by AG-UI cancel handler. */
export interface AgUiCancelHandlerOptions<T = unknown> extends AgUiRunControlHandlerOptions {
  /** Session manager value. */
  sessionManager: RunResumeSessionManager<T>;
}

async function resolveRunId(
  requestOrCtx: unknown,
  request: Request,
  options: AgUiRunControlHandlerOptions | undefined,
  regex: RegExp,
): Promise<string | null> {
  const explicit = await options?.resolveRunId?.({ request, requestOrCtx });
  if (explicit) return explicit;
  return getRunId(new URL(request.url).pathname, regex);
}

/** Handler for create AG-UI resume. */
export function createAgUiResumeHandler(
  options: AgUiResumeHandlerOptions,
): (requestOrCtx: unknown) => Promise<Response> {
  return async function POST(requestOrCtx: unknown): Promise<Response> {
    const request = extractRequest(requestOrCtx);
    const runId = await resolveRunId(requestOrCtx, request, options, RESUME_PATH_REGEX);

    if (!runId) {
      return Response.json({ error: "Run not found" }, { status: 404 });
    }

    try {
      const parsed = getAgUiResumeSignalSchema().parse(await parseAgUiJsonBody(request));
      const outcome = options.sessionManager.submitSignal(runId, {
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

/** Handler for create AG-UI cancel. */
export function createAgUiCancelHandler<T = unknown>(
  options: AgUiCancelHandlerOptions<T>,
): (requestOrCtx: unknown) => Promise<Response> {
  return async function DELETE(requestOrCtx: unknown): Promise<Response> {
    const request = extractRequest(requestOrCtx);
    const runId = await resolveRunId(requestOrCtx, request, options, CANCEL_PATH_REGEX);

    if (!runId) {
      return Response.json({ error: "Run not found" }, { status: 404 });
    }

    const accepted = options.sessionManager.cancelRun(runId);
    if (accepted) {
      return Response.json({ accepted: true }, { status: 202 });
    }

    return new Response(null, { status: 204 });
  };
}
