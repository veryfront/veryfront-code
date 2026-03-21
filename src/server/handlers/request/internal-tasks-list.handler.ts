import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";
import { ZodError } from "zod";
import {
  type ControlPlaneTasksListRequest,
  ControlPlaneTasksListRequestSchema,
  defaultRuntimeTaskDiscoveryDeps,
  listRuntimeTasks,
  type RuntimeTaskDiscoveryDeps,
} from "../../../task/control-plane.ts";
import {
  ControlPlaneRequestError,
  verifyControlPlaneRequest,
} from "#veryfront/internal-agents/control-plane-auth.ts";
import {
  INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES,
  InternalAgentRequestBodyTooLargeError,
  readInternalAgentRequestBody,
} from "#veryfront/internal-agents/request-body.ts";
import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";

export class InternalTasksListHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "InternalTasksListHandler",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
    patterns: [{ pattern: "/internal/tasks/list", exact: true, method: "POST" }],
  };

  constructor(
    private readonly deps: RuntimeTaskDiscoveryDeps = defaultRuntimeTaskDiscoveryDeps,
  ) {
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
        const payload: ControlPlaneTasksListRequest = ControlPlaneTasksListRequestSchema.parse(
          JSON.parse(rawBody),
        );
        const claims = await verifyControlPlaneRequest(req, ctx, rawBody, {
          expectedSubject: payload.requestId,
          expectedSurface: payload.surface,
        });

        if (
          payload.projectId !== claims.project_id ||
          (ctx.projectId !== undefined && payload.projectId !== ctx.projectId)
        ) {
          this.logWarn("Internal tasks list request body did not match signed claims", {
            projectSlug: ctx.projectSlug,
            projectId: ctx.projectId,
            requestId: payload.requestId,
            signedRequestId: claims.sub,
            surface: payload.surface,
            signedSurface: claims.surface,
          });
          return this.respond(builder.json({ error: "Invalid control-plane signature" }, 401));
        }

        const response = await listRuntimeTasks(ctx, this.deps);
        return this.respond(builder.json(response, 200));
      } catch (error) {
        if (error instanceof InternalAgentRequestBodyTooLargeError) {
          return this.respond(builder.json({ error: error.message }, error.status));
        }

        if (error instanceof ControlPlaneRequestError) {
          this.logWarn("Internal tasks list signature verification failed", {
            error: error.message,
            projectSlug: ctx.projectSlug,
            projectId: ctx.projectId,
          });
          return this.respond(builder.json({ error: error.message }, error.status));
        }

        if (error instanceof SyntaxError || error instanceof ZodError) {
          this.logWarn("Internal tasks list request validation failed", {
            error: error instanceof Error ? error.message : String(error),
            projectSlug: ctx.projectSlug,
            projectId: ctx.projectId,
          });
          return this.respond(builder.json({ error: "Invalid internal tasks request" }, 400));
        }

        throw error;
      }
    });
  }
}
