import { CONTROL_PLANE_RUNS_PATH_PREFIX } from "#veryfront/channels/control-plane.ts";
import {
  ControlPlaneRequestError,
  verifyControlPlaneRequest,
} from "#veryfront/internal-agents/control-plane-auth.ts";
import {
  type AgentRunControl,
  AgentRunControlBindingError,
} from "#veryfront/internal-agents/run-control.ts";
import { agentRunControl } from "#veryfront/internal-agents/agent-run-control-runtime.ts";
import {
  INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES,
  InternalAgentRequestBodyEncodingError,
  InternalAgentRequestBodyTooLargeError,
  readInternalAgentRequestBody,
} from "#veryfront/internal-agents/request-body.ts";
import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";
import { parseControlPlaneRunPath } from "./control-plane-run-path.ts";

const CANCEL_PATH_REGEX = /^\/api\/control-plane\/runs\/([^/]+)$/;

export class AgentRunCancelHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "AgentRunCancelHandler",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
    patterns: [
      { pattern: CONTROL_PLANE_RUNS_PATH_PREFIX, prefix: true, method: "DELETE" },
    ],
  };

  constructor(private readonly runControl: AgentRunControl = agentRunControl) {
    super();
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return this.continue();
    }

    const pathMatch = parseControlPlaneRunPath(new URL(req.url).pathname, CANCEL_PATH_REGEX);
    if (!pathMatch.matched) {
      return this.continue();
    }
    const runId = pathMatch.runId;
    if (!runId) {
      const builder = this.createResponseBuilder(ctx)
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req);
      return this.respond(builder.json({ error: "Invalid run id" }, 400));
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
        const verifiedClaims = await verifyControlPlaneRequest(req, ctx, rawBody, {
          expectedSubject: runId,
          expectedSurface: "studio",
        });

        const accepted = await this.runControl.cancelRun(runId, {
          projectId: verifiedClaims.project_id,
          projectSlug: verifiedClaims.aud,
        });
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

        if (error instanceof AgentRunControlBindingError) {
          return this.respond(builder.json({ error: "Invalid control-plane signature" }, 401));
        }

        if (error instanceof InternalAgentRequestBodyEncodingError) {
          return this.respond(builder.json({ error: "Invalid cancel request" }, error.status));
        }

        this.logWarn("Internal agent run cancel failed", {
          failureCategory: "handler-error",
        });
        return this.respond(builder.json({ error: "Internal cancel failed" }, 500));
      }
    });
  }
}
