import {
  createErrorResponseFromDefinition,
  PROJECT_EXECUTION_UNAVAILABLE,
} from "#veryfront/errors";
import type { HandlerHelpers } from "#veryfront/security";
import type { HandlerContext } from "../types.ts";

export interface ProjectExecutionUnavailableOptions {
  /** Human-readable reason, e.g. "... for agent discovery". */
  detail: string;
  /** RFC 9457 `instance`: the request pathname the denial applies to. */
  instance: string;
}

/**
 * Builds the shared-runtime denial every capability-gated handler answers
 * with once the isolated-runtime predicate from
 * `#veryfront/security/project-locality.ts` refuses: a
 * `project-execution-unavailable` problem response with CORS, security and
 * `no-store` headers applied.
 *
 * Deliberately does not call that predicate itself. Each surface keeps its
 * own call so the execution-surface inventory
 * (`execution-surface-policy.test.ts`) still sees every gate; this helper
 * only builds the response, so every surface denies with the same shape.
 */
export function buildProjectExecutionUnavailableResponse(
  helpers: Pick<HandlerHelpers, "createResponseBuilder">,
  req: Request,
  ctx: HandlerContext,
  options: ProjectExecutionUnavailableOptions,
): Response {
  const problem = createErrorResponseFromDefinition(PROJECT_EXECUTION_UNAVAILABLE, {
    detail: options.detail,
    instance: options.instance,
  });
  return helpers
    .createResponseBuilder(ctx)
    .withCORS(req, ctx.securityConfig?.cors)
    .withSecurity(ctx.securityConfig ?? undefined, req)
    .withCache("no-store")
    .withHeaders(problem.headers)
    .build(problem.body, problem.status);
}
