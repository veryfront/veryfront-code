import type { Agent } from "#veryfront/agent";
import { defaultChannelInvokeDeps } from "#veryfront/channels/invoke.ts";
import { type RuntimeAgentDiscoveryDeps } from "#veryfront/channels/control-plane.ts";
import {
  createRuntimeAgentStreamResponse,
  type RuntimeAgentStreamExecutionDeps,
} from "#veryfront/internal-agents/run-stream.ts";
import {
  ControlPlaneRequestError,
  verifyControlPlaneRequest,
} from "#veryfront/internal-agents/control-plane-auth.ts";
import {
  INTERNAL_AGENT_STREAM_MAX_BODY_BYTES,
  InternalAgentRequestBodyTooLargeError,
  readInternalAgentRequestBody,
} from "#veryfront/internal-agents/request-body.ts";
import {
  AgentRunAlreadyExistsError,
  agentRunSessionManager,
} from "#veryfront/internal-agents/session-manager.ts";
import { RuntimeRunAgentInputSchema } from "#veryfront/internal-agents/schema.ts";
import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";

export interface AgentStreamHandlerDeps
  extends RuntimeAgentDiscoveryDeps, RuntimeAgentStreamExecutionDeps {}

const defaultDeps: AgentStreamHandlerDeps = {
  ...defaultChannelInvokeDeps,
  sessionManager: agentRunSessionManager,
};

function applyBuilderHeaders(target: Response, source: Headers): Response {
  const headers = new Headers(target.headers);
  for (const [key, value] of source.entries()) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  return new Response(target.body, {
    status: target.status,
    statusText: target.statusText,
    headers,
  });
}

export class AgentStreamHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "AgentStreamHandler",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
    patterns: [{ pattern: "/internal/agents/stream", exact: true, method: "POST" }],
  };

  constructor(private readonly deps: AgentStreamHandlerDeps = defaultDeps) {
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
          INTERNAL_AGENT_STREAM_MAX_BODY_BYTES,
        );
        const payload = RuntimeRunAgentInputSchema.parse(JSON.parse(rawBody));
        await verifyControlPlaneRequest(req, ctx, rawBody, {
          expectedSubject: payload.runId,
          expectedSurface: "studio",
        });

        await this.deps.ensureProjectDiscovery(ctx);

        const agent = this.deps.getAgent(payload.agentId);
        if (!agent) {
          return this.respond(builder.json({ error: "Agent not found" }, 404));
        }

        const response = await createRuntimeAgentStreamResponse(payload, agent as Agent, this.deps);
        return this.respond(applyBuilderHeaders(response, builder.headers));
      } catch (error) {
        if (error instanceof InternalAgentRequestBodyTooLargeError) {
          return this.respond(builder.json({ error: error.message }, error.status));
        }

        if (error instanceof ControlPlaneRequestError) {
          return this.respond(builder.json({ error: error.message }, error.status));
        }

        if (error instanceof SyntaxError) {
          return this.respond(
            builder.json({ error: "Invalid internal agent stream request" }, 400),
          );
        }

        if (error instanceof AgentRunAlreadyExistsError) {
          return this.respond(builder.json({ error: error.message }, 409));
        }

        if (error instanceof Error && error.name === "ZodError") {
          return this.respond(
            builder.json({ error: "Invalid internal agent stream request" }, 400),
          );
        }

        this.logWarn("Internal agent stream request failed", {
          error: error instanceof Error ? error.message : String(error),
          projectId: ctx.projectId,
          projectSlug: ctx.projectSlug,
        });
        return this.respond(builder.json({ error: "Internal agent stream failed" }, 500));
      }
    });
  }
}
