import { CONTROL_PLANE_RUNS_PATH_PREFIX } from "#veryfront/channels/control-plane.ts";
import { ControlPlaneRequestError } from "#veryfront/internal-agents/control-plane-auth.ts";
import {
  InternalAgentRequestBodyEncodingError,
  InternalAgentRequestBodyTooLargeError,
} from "#veryfront/internal-agents/request-body.ts";
import { HTTP_CONTENT_TYPES, PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";
import { isServerShuttingDown } from "../../shutdown-state.ts";
import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { parseControlPlaneRunPath } from "./control-plane-run-path.ts";
import { defaultProjectRunExecuteHandlerDeps } from "./project-run-execution.ts";
import {
  ProjectRunIdentityConflictError,
  readVerifiedProjectRunRequest,
} from "./project-run-auth.ts";
import { executeIdempotentProjectRun } from "./project-run-idempotency.ts";
import { buildRuntimeShuttingDownResponse } from "./runtime-shutdown-response.ts";
import {
  type SignedRequestIdempotencyStore,
  signedRequestIdempotencyStore,
} from "./signed-request-idempotency.ts";
import type { ProjectRunExecuteHandlerDeps } from "./project-run-types.ts";

export type {
  ProjectRunExecuteHandlerDeps,
  ProjectRunExecuteRequest,
  ProjectRunExecuteResponse,
} from "./project-run-types.ts";

const EXECUTE_PATH_REGEX = /^\/api\/control-plane\/runs\/([^/]+)\/execute$/;

export class ProjectRunExecuteHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "ProjectRunExecuteHandler",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
    patterns: [{ pattern: CONTROL_PLANE_RUNS_PATH_PREFIX, prefix: true, method: "POST" }],
  };

  constructor(
    private readonly deps: ProjectRunExecuteHandlerDeps = defaultProjectRunExecuteHandlerDeps,
    private readonly idempotency: SignedRequestIdempotencyStore = signedRequestIdempotencyStore,
  ) {
    super();
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return this.continue();
    const path = parseControlPlaneRunPath(new URL(req.url).pathname, EXECUTE_PATH_REGEX);
    if (!path.matched) return this.continue();

    const builder = this.createResponseBuilder(ctx)
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined, req);
    if (!path.runId) {
      return this.respond(builder.json({ error: "Invalid project run execute request" }, 400));
    }
    if (isServerShuttingDown()) {
      return this.respond(buildRuntimeShuttingDownResponse(builder));
    }

    let verified: Awaited<ReturnType<typeof readVerifiedProjectRunRequest>>;
    try {
      verified = await readVerifiedProjectRunRequest(req, ctx, path.runId);
    } catch (error) {
      if (
        error instanceof InternalAgentRequestBodyTooLargeError ||
        error instanceof InternalAgentRequestBodyEncodingError
      ) {
        return this.respond(builder.json({ error: error.message }, error.status));
      }
      if (error instanceof ControlPlaneRequestError) {
        return this.respond(builder.json({ error: error.message }, error.status));
      }
      if (error instanceof ProjectRunIdentityConflictError) {
        this.logWarn("Rejected project run with conflicting project identity", {
          failureCategory: "project-identity-conflict",
        }, ctx);
        return this.respond(builder.json({ error: "Invalid control-plane signature" }, 401));
      }
      return this.respond(builder.json({ error: "Invalid project run execute request" }, 400));
    }

    return this.withProxyContext(ctx, async () => {
      try {
        const response = await executeIdempotentProjectRun({
          ...verified,
          req,
          ctx,
          deps: this.deps,
          idempotency: this.idempotency,
        });
        return this.respond(
          builder.withContentType(HTTP_CONTENT_TYPES.JSON, response.body, response.status),
        );
      } catch {
        this.logWarn("Project run idempotency failed", {
          failureCategory: "idempotency-operation-failed",
        }, ctx);
        return this.respond(builder.json({ error: "Invalid project run execute request" }, 400));
      }
    }, { verifiedControlPlaneClaims: verified.claims });
  }
}
