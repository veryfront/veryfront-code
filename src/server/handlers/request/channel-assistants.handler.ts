import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import {
  ChannelAssistantsRequestSchema,
  type ChannelInvokeDeps,
  defaultChannelInvokeDeps,
  listChannelAssistants,
} from "../../../channels/invoke.ts";
import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";
import { readSignedChannelDispatchRequest } from "./channel-dispatch-request.ts";

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

      const dispatchRequest = await readSignedChannelDispatchRequest(req, ctx, {
        builder,
        endpointName: "channel assistants",
        invalidRequestError: "Invalid channel assistants request",
        logLabel: "Channel assistants",
        logWarn: (message, extra) => this.logWarn(message, extra),
        schema: ChannelAssistantsRequestSchema,
      });
      if (!dispatchRequest.ok) {
        return this.respond(dispatchRequest.response);
      }

      const { claims, payload } = dispatchRequest;

      if (
        payload.projectId !== claims.project_id ||
        (ctx.projectId !== undefined && payload.projectId !== ctx.projectId) ||
        payload.requestId !== claims.sub ||
        payload.platform !== claims.platform
      ) {
        this.logWarn("Channel assistants request body did not match signed claims", {
          projectSlug: ctx.projectSlug,
          projectId: ctx.projectId,
          requestId: payload.requestId,
          signedRequestId: claims.sub,
        });
        return this.respond(builder.json({ error: "Invalid dispatch signature" }, 401));
      }

      const response = await listChannelAssistants(ctx, this.deps);
      return this.respond(builder.json(response, 200));
    });
  }
}
