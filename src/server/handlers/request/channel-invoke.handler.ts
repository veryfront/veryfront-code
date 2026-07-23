import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import {
  type ChannelInvokeDeps,
  ChannelInvokeRequestSchema,
  defaultChannelInvokeDeps,
  executeChannelInvoke,
} from "../../../channels/invoke.ts";
import {
  HTTP_CONTENT_TYPES,
  HTTP_UNAVAILABLE,
  PRIORITY_MEDIUM_API,
} from "#veryfront/utils/constants/index.ts";
import { readSignedChannelDispatchRequest } from "./channel-dispatch-request.ts";
import { buildRuntimeShuttingDownResponse } from "./runtime-shutdown-response.ts";
import { isServerShuttingDown } from "../../shutdown-state.ts";
import {
  serializeSignedRequestJsonResponse,
  type SignedRequestIdempotencyStore,
  signedRequestIdempotencyStore,
} from "./signed-request-idempotency.ts";

const CHANNEL_INVOKE_IDEMPOTENCY_SCOPE = "channel-invoke";

export class ChannelInvokeHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "ChannelInvokeHandler",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
    patterns: [{ pattern: "/channels/invoke", exact: true, method: "POST" }],
  };

  constructor(
    private readonly deps: ChannelInvokeDeps = defaultChannelInvokeDeps,
    private readonly idempotency: SignedRequestIdempotencyStore = signedRequestIdempotencyStore,
  ) {
    super();
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return this.continue();
    }

    // Lame-duck: reject NEW agent work during graceful shutdown before any
    // dispatch verification or agent execution, so the API gets a clean
    // pre-side-effect failure it can retry against another instance.
    if (isServerShuttingDown()) {
      return this.respond(buildRuntimeShuttingDownResponse(this.createResponseBuilder(ctx)));
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
        validateClaims: (claims, payload) =>
          claims.sub === payload.dispatchId &&
          claims.project_id === payload.projectId &&
          claims.platform === payload.platform,
      });
      if (!dispatchRequest.ok) {
        return this.respond(dispatchRequest.response);
      }

      const decision = await this.idempotency.execute(
        {
          scope: CHANNEL_INVOKE_IDEMPOTENCY_SCOPE,
          audience: dispatchRequest.claims.aud,
          projectId: dispatchRequest.claims.project_id,
          subject: dispatchRequest.claims.sub,
          fingerprint: dispatchRequest.claims.body_sha256,
          expiresAtMs: dispatchRequest.claims.exp * 1000,
        },
        async () => {
          const response = await executeChannelInvoke(
            dispatchRequest.payload,
            ctx,
            this.deps,
            { signal: req.signal },
          );
          return {
            response: serializeSignedRequestJsonResponse(response, 200),
            cache: !req.signal.aborted && response.error?.retryable !== true,
          };
        },
      );

      if (decision.kind === "conflict") {
        return this.respond(
          builder.json(
            { error: "Channel dispatch identity conflicts with a different request" },
            409,
          ),
        );
      }
      if (decision.kind === "saturated") {
        return this.respond(
          builder.json(
            { error: "Channel dispatch idempotency capacity is exhausted" },
            HTTP_UNAVAILABLE,
          ),
        );
      }
      if (decision.kind === "replay-unavailable") {
        return this.respond(
          builder.json({ error: "Channel dispatch was already processed" }, 409),
        );
      }

      return this.respond(
        builder.withContentType(
          HTTP_CONTENT_TYPES.JSON,
          decision.response.body,
          decision.response.status,
        ),
      );
    });
  }
}
