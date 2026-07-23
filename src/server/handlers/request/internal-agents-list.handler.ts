import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import {
  CONTROL_PLANE_AGENTS_LIST_PATH,
  type ControlPlaneAgentsListRequest,
  ControlPlaneAgentsListRequestSchema,
  type ControlPlaneSurface,
  listRuntimeAgents,
  type RuntimeAgentDiscoveryDeps,
} from "../../../channels/control-plane.ts";
import { defaultChannelInvokeDeps } from "#veryfront/channels/invoke.ts";
import {
  ControlPlaneRequestError,
  verifyControlPlaneRequest,
} from "#veryfront/internal-agents/control-plane-auth.ts";
import {
  INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES,
  InternalAgentRequestBodyEncodingError,
  InternalAgentRequestBodyTooLargeError,
  readInternalAgentRequestBody,
} from "#veryfront/internal-agents/request-body.ts";
import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";

export class InternalAgentsListHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "InternalAgentsListHandler",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
    patterns: [
      { pattern: CONTROL_PLANE_AGENTS_LIST_PATH, exact: true, method: "POST" },
    ],
  };

  constructor(private readonly deps: RuntimeAgentDiscoveryDeps = defaultChannelInvokeDeps) {
    super();
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
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
        const payload: ControlPlaneAgentsListRequest = ControlPlaneAgentsListRequestSchema.parse(
          JSON.parse(rawBody),
        );
        const claims = await verifyControlPlaneRequest(req, ctx, rawBody, {
          expectedSubject: payload.requestId,
          // Validated by `.parse()` above; narrow back to the union (object inference widens it to `string`).
          expectedSurface: payload.surface as ControlPlaneSurface,
        });

        if (
          payload.projectId !== claims.project_id ||
          (ctx.projectId !== undefined && payload.projectId !== ctx.projectId)
        ) {
          this.logWarn("Internal agents list request body did not match signed claims", {
            failureCategory: "claim-mismatch",
          });
          return this.respond(builder.json({ error: "Invalid control-plane signature" }, 401));
        }
        const response = await listRuntimeAgents(ctx, this.deps);
        return this.respond(builder.json(response, 200));
      } catch (error) {
        if (error instanceof InternalAgentRequestBodyTooLargeError) {
          return this.respond(builder.json({ error: error.message }, error.status));
        }

        if (error instanceof ControlPlaneRequestError) {
          this.logWarn("Internal agents list signature verification failed", {
            status: error.status,
            failureCategory: "verification-error",
          });
          return this.respond(builder.json({ error: error.message }, error.status));
        }

        if (
          error instanceof InternalAgentRequestBodyEncodingError ||
          error instanceof SyntaxError ||
          (error instanceof Error && "issues" in error)
        ) {
          this.logWarn("Internal agents list request validation failed", {
            failureCategory: "invalid-request",
          });
          return this.respond(builder.json({ error: "Invalid internal agents request" }, 400));
        }

        throw error;
      }
    });
  }
}
