import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { CONTROL_PLANE_RUNTIME_CAPABILITIES_PATH } from "#veryfront/channels/control-plane.ts";
import {
  authenticateControlPlaneProjectMetadataRequest,
  ControlPlaneRequestError,
} from "#veryfront/internal-agents/control-plane-auth.ts";
import {
  InternalAgentRequestBodyTooLargeError,
  readInternalAgentRequestBody,
} from "#veryfront/internal-agents/request-body.ts";
import { requiresIsolatedProjectRuntime } from "#veryfront/security/project-locality.ts";
import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";

/** Reports this server's implemented protocol without evaluating tenant modules or reading secrets. */
export class RuntimeCapabilitiesHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "RuntimeCapabilitiesHandler",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
    patterns: [{ pattern: CONTROL_PLANE_RUNTIME_CAPABILITIES_PATH, exact: true, method: "POST" }],
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return this.continue();
    return this.withProxyContext(ctx, async () => {
      const builder = this.createResponseBuilder(ctx)
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req);
      try {
        const rawBody = await readInternalAgentRequestBody(req, 4096);
        const payload = await authenticateControlPlaneProjectMetadataRequest(req, ctx, rawBody);
        return this.respond(builder.json({
          project_id: payload.projectId,
          capabilities: requiresIsolatedProjectRuntime(ctx)
            ? {}
            : { account_agent_publications: { version: 1 } },
        }, 200));
      } catch (error) {
        if (
          error instanceof ControlPlaneRequestError ||
          error instanceof InternalAgentRequestBodyTooLargeError
        ) {
          return this.respond(builder.json({ error: error.message }, error.status));
        }
        if (error instanceof SyntaxError || (error instanceof Error && "issues" in error)) {
          return this.respond(builder.json({ error: "Invalid runtime capabilities request" }, 400));
        }
        throw error;
      }
    });
  }
}
