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
import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";

const CANCEL_PATH_REGEX = /^\/internal\/agents\/runs\/([^/]+)$/;

function getRunId(pathname: string): string | null {
  return CANCEL_PATH_REGEX.exec(pathname)?.[1] ?? null;
}

export class AgentRunCancelHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "AgentRunCancelHandler",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
    patterns: [{ pattern: "/internal/agents/runs/", prefix: true, method: "DELETE" }],
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

        const accepted = this.sessionManager.cancelRun(runId);
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
        return this.respond(builder.json({ error: "Internal cancel failed" }, 500));
      }
    });
  }
}
