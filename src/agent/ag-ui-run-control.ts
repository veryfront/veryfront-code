import { z } from "zod";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import {
  RunNotActiveError,
  RunResumeSessionManager,
  WaitConflictError,
  WaitNotPendingError,
} from "./runtime/resume-session.ts";

const RESUME_PATH_REGEX = /^\/api\/ag-ui\/runs\/([^/]+)\/resume$/;
const CANCEL_PATH_REGEX = /^\/api\/ag-ui\/runs\/([^/]+)$/;

export const AgUiResumeSignalSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tool_result"),
    toolCallId: z.string().min(1).max(128),
    result: z.unknown(),
    isError: z.boolean().optional().default(false),
  }),
]);

export type AgUiResumeSignal = z.infer<typeof AgUiResumeSignalSchema>;

type ResumeValue = {
  result: unknown;
  isError: boolean;
};

function isRequest(value: unknown): value is Request {
  return (
    typeof value === "object" &&
    value !== null &&
    "json" in value &&
    typeof value.json === "function" &&
    "url" in value &&
    typeof value.url === "string" &&
    "method" in value &&
    typeof value.method === "string"
  );
}

function extractRequest(requestOrCtx: unknown): Request {
  if (isRequest(requestOrCtx)) return requestOrCtx;

  if (typeof requestOrCtx === "object" && requestOrCtx !== null && "request" in requestOrCtx) {
    const candidate = (requestOrCtx as Record<string, unknown>).request;
    if (isRequest(candidate)) return candidate;
  }

  throw INVALID_ARGUMENT.create({
    detail: "Invalid handler argument: expected Request or APIContext",
  });
}

function getRunId(pathname: string, regex: RegExp): string | null {
  return regex.exec(pathname)?.[1] ?? null;
}

export interface AgUiRunControlHandlerOptions {
  resolveRunId?:
    | ((input: { request: Request; requestOrCtx: unknown }) => string | null)
    | ((input: { request: Request; requestOrCtx: unknown }) => Promise<string | null>);
}

export interface AgUiResumeHandlerOptions extends AgUiRunControlHandlerOptions {
  sessionManager: RunResumeSessionManager<ResumeValue>;
}

export interface AgUiCancelHandlerOptions<T = unknown> extends AgUiRunControlHandlerOptions {
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
      const parsed = AgUiResumeSignalSchema.parse(await request.json());
      const outcome = options.sessionManager.submitSignal(runId, {
        waitKey: parsed.toolCallId,
        value: {
          result: parsed.result,
          isError: parsed.isError,
        },
      });

      return Response.json(outcome, { status: 200 });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return Response.json(
          {
            error: "Invalid AG-UI resume request",
            details: error.issues.map((issue) => ({
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
