import type { VerifiedControlPlaneRequestClaims } from "#veryfront/internal-agents/control-plane-auth.ts";
import { HTTP_UNAVAILABLE } from "#veryfront/utils/constants/index.ts";
import {
  serializeSignedRequestJsonResponse,
  type SignedRequestIdempotencyStore,
  type SignedRequestJsonResponse,
} from "./signed-request-idempotency.ts";
import { executeProjectRun } from "./project-run-execution.ts";
import {
  createProjectRunExecutionFailure,
  serializeProjectRunExecutionResponse,
} from "./project-run-http-policy.ts";
import type {
  ProjectRunExecuteHandlerDeps,
  ProjectRunExecuteRequest,
} from "./project-run-types.ts";
import type { HandlerContext } from "../types.ts";

const PROJECT_RUN_EXECUTE_IDEMPOTENCY_SCOPE = "project-run-execute";

export async function executeIdempotentProjectRun(input: {
  request: ProjectRunExecuteRequest;
  claims: VerifiedControlPlaneRequestClaims;
  req: Request;
  ctx: HandlerContext;
  deps: ProjectRunExecuteHandlerDeps;
  idempotency: SignedRequestIdempotencyStore;
}): Promise<SignedRequestJsonResponse> {
  const decision = await input.idempotency.execute(
    {
      scope: PROJECT_RUN_EXECUTE_IDEMPOTENCY_SCOPE,
      audience: input.claims.aud,
      projectId: input.claims.project_id,
      subject: input.claims.sub,
      fingerprint: input.claims.request_hash,
      expiresAtMs: input.claims.exp * 1_000,
    },
    async () => {
      const startedAt = input.deps.now();
      try {
        const response = await executeProjectRun(
          { request: input.request, ctx: input.ctx, req: input.req },
          input.deps,
        );
        return { response: serializeProjectRunExecutionResponse(response), cache: true };
      } catch (error) {
        const durationMs = Math.max(0, input.deps.now() - startedAt);
        return {
          response: serializeProjectRunExecutionResponse(
            createProjectRunExecutionFailure(error, durationMs),
          ),
          cache: true,
        };
      }
    },
  );

  if (decision.kind === "conflict") {
    return serializeSignedRequestJsonResponse(
      { error: "Project run identity conflicts with a different request" },
      409,
    );
  }
  if (decision.kind === "saturated") {
    return serializeSignedRequestJsonResponse(
      { error: "Project run idempotency capacity is exhausted" },
      HTTP_UNAVAILABLE,
    );
  }
  if (decision.kind === "replay-unavailable") {
    return serializeSignedRequestJsonResponse({ error: "Project run was already processed" }, 409);
  }
  return decision.response;
}
