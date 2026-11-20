import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import {
  CONTROL_PLANE_AGENTS_LIST_PATH,
  listRuntimeAgents,
  type RuntimeAgentDiscoveryDeps,
} from "../../../channels/control-plane.ts";
import { defaultChannelInvokeDeps } from "#veryfront/channels/invoke.ts";
import {
  authenticateControlPlaneProjectMetadataRequest,
  ControlPlaneRequestError,
} from "#veryfront/internal-agents/control-plane-auth.ts";
import {
  INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES,
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
        await authenticateControlPlaneProjectMetadataRequest(req, ctx, rawBody);
        const response = await listRuntimeAgents(ctx, this.deps);
        return this.respond(builder.json(response, 200));
      } catch (error) {
        if (error instanceof InternalAgentRequestBodyTooLargeError) {
          return this.respond(builder.json({ error: error.message }, error.status));
        }

        if (error instanceof ControlPlaneRequestError) {
          this.logWarn("Internal agents list signature verification failed", {
            error: error.message,
            projectSlug: ctx.projectSlug,
            projectId: ctx.projectId,
          });
          return this.respond(builder.json({ error: error.message }, error.status));
        }

        if (error instanceof SyntaxError || (error instanceof Error && "issues" in error)) {
          this.logWarn("Internal agents list request validation failed", {
            error: error instanceof Error ? error.message : String(error),
            projectSlug: ctx.projectSlug,
            projectId: ctx.projectId,
          });
          return this.respond(builder.json({ error: "Invalid internal agents request" }, 400));
        }

        throw error;
      }
    });
  }
}
