import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import {
  ChannelAssistantsRequestSchema,
  type ChannelInvokeDeps,
  defaultChannelInvokeDeps,
  listChannelAssistants,
  verifyDispatchJws,
} from "../../../channels/invoke.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  PRIORITY_MEDIUM_API,
} from "#veryfront/utils/constants/index.ts";

const DISPATCH_JWS_HEADER = "x-veryfront-dispatch-jws";
const MAX_DISPATCH_SIGNATURE_AGE_SECONDS = 60;

export class ChannelAssistantsHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "ChannelAssistantsHandler",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
    patterns: [{ pattern: "/channels/assistants", exact: true, method: "POST" }],
  };

  constructor(private readonly deps: ChannelInvokeDeps = defaultChannelInvokeDeps) {
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
        this.logWarn("Missing CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY for channel assistants endpoint");
        return this.respond(
          builder.json(
            { error: "Channel dispatch verification is not configured" },
            HTTP_INTERNAL_SERVER_ERROR,
          ),
        );
      }

      const projectSlug = ctx.projectSlug;
      if (!projectSlug) {
        this.logWarn("Channel assistants request arrived without resolved project slug");
        return this.respond(builder.json({ error: "Project context is unavailable" }, 400));
      }

      const dispatchJws = req.headers.get(DISPATCH_JWS_HEADER);
      if (!dispatchJws) {
        return this.respond(builder.json({ error: "Missing dispatch signature" }, 401));
      }

      const rawBody = await req.text();
      try {
        await verifyDispatchJws(dispatchJws, rawBody, {
          audience: projectSlug,
          expectedProjectId: ctx.projectId,
          publicKeyPem,
          maxAgeSeconds: MAX_DISPATCH_SIGNATURE_AGE_SECONDS,
        });
      } catch (error) {
        this.logWarn("Channel assistants signature verification failed", {
          error: error instanceof Error ? error.message : String(error),
          projectSlug,
          projectId: ctx.projectId,
        });
        return this.respond(builder.json({ error: "Invalid dispatch signature" }, 401));
      }

      try {
        ChannelAssistantsRequestSchema.parse(JSON.parse(rawBody));
      } catch (error) {
        this.logWarn("Channel assistants request validation failed", {
          error: error instanceof Error ? error.message : String(error),
          projectSlug,
          projectId: ctx.projectId,
        });
        return this.respond(builder.json({ error: "Invalid channel assistants request" }, 400));
      }

      const response = await listChannelAssistants(ctx, this.deps);
      return this.respond(builder.json(response, 200));
    });
  }
}
