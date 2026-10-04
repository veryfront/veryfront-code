import { CONTROL_PLANE_RUNS_PATH_PREFIX } from "#veryfront/channels/control-plane.ts";
import {
  ControlPlaneRequestError,
  verifyControlPlaneRequest,
} from "#veryfront/internal-agents/control-plane-auth.ts";
import {
  type AgentRunSessionManager,
  agentRunSessionManager,
} from "#veryfront/internal-agents/session-manager.ts";
import {
  INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES,
  InternalAgentRequestBodyTooLargeError,
  readInternalAgentRequestBody,
} from "#veryfront/internal-agents/request-body.ts";
import { privateTextTrim } from "#veryfront/security/private-text.ts";
import { setActiveSpanAttributes } from "#veryfront/observability/tracing/otlp-setup.ts";
import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  PRIORITY_MEDIUM_API,
} from "#veryfront/utils/constants/index.ts";
import { reportHandlerFailure } from "./report-handler-failure.ts";

const CANCEL_PATH_REGEX = /^\/api\/control-plane\/runs\/([^/]+)$/;

function getRunId(pathname: string): string | null {
  return CANCEL_PATH_REGEX.exec(pathname)?.[1] ?? null;
}

const JsonParse = JSON.parse;
const hasOwn = Object.hasOwn;

/**
 * A plain cancel may carry no body or a non-JSON one; only an explicit own flag opts in.
 * Captured intrinsics keep project prototype mutations from steering this decision.
 */
function readConfirmStopped(rawBody: string): boolean {
  if (privateTextTrim(rawBody) === "") return false;
  try {
    const body: unknown = JsonParse(rawBody);
    return typeof body === "object" && body !== null && hasOwn(body, "confirmStopped") &&
      (body as { confirmStopped?: unknown }).confirmStopped === true;
  } catch {
    return false;
  }
}

export class AgentRunCancelHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "AgentRunCancelHandler",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
    patterns: [
      { pattern: CONTROL_PLANE_RUNS_PATH_PREFIX, prefix: true, method: "DELETE" },
    ],
  };

  constructor(private readonly sessionManager: AgentRunSessionManager = agentRunSessionManager) {
    super();
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return this.continue();
    }

    const runId = getRunId(new URL(req.url).pathname);
    if (!runId) {
      return this.continue();
    }

    return this.withProxyContext(ctx, async () => {
      const builder = this.createResponseBuilder(ctx)
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req);

      try {
        const rawBody = await readInternalAgentRequestBody(
          req,
          INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES,
        );
        await verifyControlPlaneRequest(req, ctx, rawBody, {
          expectedSubject: runId,
          expectedSurface: "studio",
        });

        // This request bypasses the proxy, so its own release headers are untrusted.
        // Only the pod running the run knows which release or branch served it. A pod
        // that does not own the run (the 204 path) stamps nothing: platform-scoped.
        setActiveSpanAttributes(
          this.sessionManager.getServingSpanAttributes(runId, ctx.projectId) ?? {},
        );
        const confirmStopped = readConfirmStopped(rawBody);
        const stop = confirmStopped
          ? this.sessionManager.stopRegistry.requestStop(runId)
          : undefined;
        const accepted = this.sessionManager.cancelRun(runId);
        if (stop) {
          if (!accepted && !stop.accepted) return this.respond(builder.build(null, 204));
          return this.respond(
            builder.json(
              { accepted: accepted || stop.accepted, stopped: stop.stopped },
              stop.stopped ? 200 : 202,
            ),
          );
        }
        if (accepted) {
          return this.respond(builder.json({ accepted: true }, 202));
        }

        return this.respond(builder.build(null, 204));
      } catch (error) {
        if (error instanceof InternalAgentRequestBodyTooLargeError) {
          return this.respond(builder.json({ error: error.message }, error.status));
        }

        if (error instanceof ControlPlaneRequestError) {
          return this.respond(builder.json({ error: error.message }, error.status));
        }

        this.logWarn("Internal agent run cancel failed", {
          error: error instanceof Error ? error.message : String(error),
          runId,
          projectId: ctx.projectId,
          projectSlug: ctx.projectSlug,
        });
        reportHandlerFailure(error, {
          boundary: "agent.run.cancel",
          method: req.method,
          status: HTTP_INTERNAL_SERVER_ERROR,
          runId,
          projectId: ctx.projectId,
          projectSlug: ctx.projectSlug,
        });
        return this.respond(builder.json({ error: "Internal cancel failed" }, 500));
      }
    });
  }
}
