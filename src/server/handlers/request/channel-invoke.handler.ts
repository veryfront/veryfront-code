import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import {
  type ChannelInvokeDeps,
  ChannelInvokeRequestSchema,
  defaultChannelInvokeDeps,
  executeChannelInvoke,
} from "../../../channels/invoke.ts";
import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";
import { readSignedChannelDispatchRequest } from "./channel-dispatch-request.ts";

export class ChannelInvokeHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "ChannelInvokeHandler",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
    patterns: [{ pattern: "/channels/invoke", exact: true, method: "POST" }],
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
        endpointName: "channel invoke",
        invalidRequestError: "Invalid channel invoke request",
        logLabel: "Channel invoke",
        logWarn: (message, extra) => this.logWarn(message, extra),
        schema: ChannelInvokeRequestSchema,
      });
      if (!dispatchRequest.ok) {
        return this.respond(dispatchRequest.response);
      }

      const response = await executeChannelInvoke(dispatchRequest.payload, ctx, this.deps);
      return this.respond(builder.json(response, 200));
    });
  }
}
