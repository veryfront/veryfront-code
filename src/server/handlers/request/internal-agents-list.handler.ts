import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import {
  type ControlPlaneAgentsListRequest,
  ControlPlaneAgentsListRequestSchema,
  listRuntimeAgents,
  type RuntimeAgentDiscoveryDeps,
  verifyControlPlaneJws,
} from "../../../channels/control-plane.ts";
import { defaultChannelInvokeDeps } from "../../../channels/invoke.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  PRIORITY_MEDIUM_API,
} from "#veryfront/utils/constants/index.ts";

const CONTROL_PLANE_JWS_HEADER = "x-veryfront-control-plane-jws";
const MAX_CONTROL_PLANE_SIGNATURE_AGE_SECONDS = 60;

export class InternalAgentsListHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "InternalAgentsListHandler",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
    patterns: [{ pattern: "/internal/agents/list", exact: true, method: "POST" }],
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

      const publicKeyPem = ctx.adapter.env.get("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
      if (!publicKeyPem) {
        this.logWarn("Missing CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY for internal agents list");
        return this.respond(
          builder.json(
            { error: "Control-plane verification is not configured" },
            HTTP_INTERNAL_SERVER_ERROR,
          ),
        );
      }

      const projectSlug = ctx.projectSlug;
      if (!projectSlug) {
        this.logWarn("Internal agents list request arrived without resolved project slug");
        return this.respond(builder.json({ error: "Project context is unavailable" }, 400));
      }

      const controlPlaneJws = req.headers.get(CONTROL_PLANE_JWS_HEADER);
      if (!controlPlaneJws) {
        return this.respond(builder.json({ error: "Missing control-plane signature" }, 401));
      }

      const rawBody = await req.text();
      let claims: Awaited<ReturnType<typeof verifyControlPlaneJws>> | undefined;
      try {
        claims = await verifyControlPlaneJws(controlPlaneJws, rawBody, {
          audience: projectSlug,
          expectedProjectId: ctx.projectId,
          publicKeyPem,
          maxAgeSeconds: MAX_CONTROL_PLANE_SIGNATURE_AGE_SECONDS,
        });
      } catch (error) {
        this.logWarn("Internal agents list signature verification failed", {
          error: error instanceof Error ? error.message : String(error),
          projectSlug,
          projectId: ctx.projectId,
        });
        return this.respond(builder.json({ error: "Invalid control-plane signature" }, 401));
      }

      let payload: ControlPlaneAgentsListRequest;
      try {
        payload = ControlPlaneAgentsListRequestSchema.parse(JSON.parse(rawBody));
      } catch (error) {
        this.logWarn("Internal agents list request validation failed", {
          error: error instanceof Error ? error.message : String(error),
          projectSlug,
          projectId: ctx.projectId,
        });
        return this.respond(builder.json({ error: "Invalid internal agents request" }, 400));
      }

      if (
        !claims ||
        payload.projectId !== claims.project_id ||
        (ctx.projectId !== undefined && payload.projectId !== ctx.projectId) ||
        payload.requestId !== claims.sub ||
        payload.surface !== claims.surface
      ) {
        this.logWarn("Internal agents list request body did not match signed claims", {
          projectSlug,
          projectId: ctx.projectId,
          requestId: payload.requestId,
          signedRequestId: claims?.sub,
          surface: payload.surface,
          signedSurface: claims?.surface,
        });
        return this.respond(builder.json({ error: "Invalid control-plane signature" }, 401));
      }

      const response = await listRuntimeAgents(ctx, this.deps);
      return this.respond(builder.json(response, 200));
    });
  }
}
