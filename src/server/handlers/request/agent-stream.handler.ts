import {
  ControlPlaneRequestError,
  verifyControlPlaneRequest,
} from "#veryfront/internal-agents/control-plane-auth.ts";
import {
  INTERNAL_AGENT_STREAM_MAX_BODY_BYTES,
  InternalAgentRequestBodyEncodingError,
  InternalAgentRequestBodyTooLargeError,
  readInternalAgentRequestBody,
} from "#veryfront/internal-agents/request-body.ts";
import { AgentRunAlreadyExistsError } from "#veryfront/internal-agents/session-manager.ts";
import { AgentRunWorkerCapacityError } from "#veryfront/internal-agents/agent-run-worker-coordinator.ts";
import { AgentRunWorkerExecutionError } from "#veryfront/security/sandbox/agent-run-worker-client.ts";
import { serverLogger } from "#veryfront/utils";
import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";
import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { isServerShuttingDown } from "../../shutdown-state.ts";
import { buildRuntimeShuttingDownResponse } from "./runtime-shutdown-response.ts";
import { parseControlPlaneRunPath } from "./control-plane-run-path.ts";
import { AgentStreamEnvironmentSelectionError } from "./agent-stream-environment-service.ts";
import {
  type AgentStreamIsolationDeps,
  executeIsolatedAgentStream,
  parseAgentStreamPayload,
  withAgentSourceContext,
} from "./agent-stream-isolated-execution.ts";

const logger = serverLogger.component("agent-stream-handler");
const RUN_STREAM_PATH_REGEX = /^\/api\/control-plane\/runs\/([^/]+)\/stream$/;

export type AgentStreamHandlerDeps = AgentStreamIsolationDeps;

function applyBuilderHeaders(target: Response, source: Headers): Response {
  const headers = new Headers(target.headers);
  for (const [key, value] of source.entries()) {
    if (!headers.has(key)) headers.set(key, value);
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
    patterns: [{ pattern: RUN_STREAM_PATH_REGEX, method: "POST" }],
  };

  constructor(private readonly deps: AgentStreamHandlerDeps = {}) {
    super();
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return this.continue();
    if (isServerShuttingDown()) {
      return this.respond(buildRuntimeShuttingDownResponse(this.createResponseBuilder(ctx)));
    }
    const builder = this.createResponseBuilder(ctx)
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined, req);

    try {
      const path = parseControlPlaneRunPath(new URL(req.url).pathname, RUN_STREAM_PATH_REGEX);
      if (!path.matched || !path.runId) {
        return this.respond(builder.json({ error: "CONTROL_PLANE_RUN_ID_MISMATCH" }, 400));
      }
      const rawBody = await readInternalAgentRequestBody(req, INTERNAL_AGENT_STREAM_MAX_BODY_BYTES);
      const parsed = parseAgentStreamPayload(JSON.parse(rawBody));
      if (path.runId !== parsed.payload.runId) {
        return this.respond(builder.json({ error: "CONTROL_PLANE_RUN_ID_MISMATCH" }, 400));
      }
      const claims = await verifyControlPlaneRequest(req, ctx, rawBody, {
        expectedSubject: parsed.payload.runId,
        expectedSurface: "studio",
      });
      if (
        parsed.project.projectId !== claims.project_id ||
        parsed.project.projectSlug !== claims.aud
      ) {
        return this.respond(builder.json({ error: "Invalid control-plane signature" }, 401));
      }

      const token = parsed.payload.credentials?.authToken || ctx.proxyToken || "";
      const requestContext: HandlerContext = {
        ...ctx,
        proxyToken: token || undefined,
        requestContext: ctx.requestContext ? { ...ctx.requestContext, token } : ctx.requestContext,
      };
      const response = await this.withProxyContext(
        requestContext,
        () =>
          withAgentSourceContext(
            requestContext,
            parsed.payload.agentSource,
            token,
            () =>
              executeIsolatedAgentStream({
                req,
                ctx: requestContext,
                parsed,
                apiAuthToken: token,
                deps: this.deps,
              }),
          ),
        { verifiedControlPlaneClaims: claims },
      );
      return this.respond(applyBuilderHeaders(response, builder.headers));
    } catch (error) {
      if (error instanceof InternalAgentRequestBodyTooLargeError) {
        return this.respond(builder.json({ error: error.message }, error.status));
      }
      if (error instanceof ControlPlaneRequestError) {
        return this.respond(builder.json({ error: error.message }, error.status));
      }
      if (error instanceof AgentRunAlreadyExistsError) {
        return this.respond(builder.json({ error: error.message }, 409));
      }
      if (error instanceof AgentStreamEnvironmentSelectionError) {
        return this.respond(builder.json({ error: error.message }, error.status));
      }
      if (error instanceof AgentRunWorkerCapacityError) {
        return this.respond(builder.json({ error: "Agent runtime capacity reached" }, 503));
      }
      if (error instanceof AgentRunWorkerExecutionError && error.code === "AGENT_NOT_FOUND") {
        return this.respond(builder.json({ error: "Agent not found" }, 404));
      }
      if (
        error instanceof InternalAgentRequestBodyEncodingError || error instanceof SyntaxError ||
        (error instanceof Error && error.name === "ZodError")
      ) {
        return this.respond(builder.json({ error: "Invalid internal agent stream request" }, 400));
      }
      logger.error("Internal agent stream handler failed", { failureCategory: "handler-error" });
      return this.respond(builder.json({ error: "Internal agent stream failed" }, 500));
    }
  }
}
