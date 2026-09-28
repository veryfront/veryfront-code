/** Safe condition metadata supplied by the integration API. */
export interface IntegrationFailureCondition {
  readonly slug: string;
  readonly status: number;
  /** Server classification; never permission to automatically replay a write. */
  readonly retryable: boolean;
  readonly retry_after_seconds?: number;
}

/** Validated HTTP Problem identity without an assertion about server retryability. */
export interface IntegrationHttpProblem {
  readonly slug: string;
  readonly status: number;
}

function hasErrorIdentity(
  value: unknown,
): value is Record<string, unknown> & IntegrationHttpProblem {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    "slug" in value && typeof value.slug === "string" &&
    /^[a-z][a-z0-9-]{0,127}$/.test(value.slug) &&
    "status" in value && typeof value.status === "number" && Number.isInteger(value.status) &&
    value.status >= 400 && value.status <= 599;
}

/** @internal Copy only validated identity fields, never private Problem extensions. */
export function readIntegrationHttpProblem(value: unknown): IntegrationHttpProblem | undefined {
  return hasErrorIdentity(value) ? { slug: value.slug, status: value.status } : undefined;
}

/** @internal Native condition metadata still requires an explicit server retryability flag. */
export function readIntegrationFailureCondition(
  value: unknown,
): IntegrationFailureCondition | undefined {
  if (!hasErrorIdentity(value) || typeof value.retryable !== "boolean") return undefined;
  const retryAfter = "retry_after_seconds" in value ? value.retry_after_seconds : undefined;
  return {
    slug: value.slug,
    status: value.status,
    retryable: value.retryable,
    ...(typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter >= 0 &&
        retryAfter <= Number.MAX_SAFE_INTEGER
      ? { retry_after_seconds: retryAfter }
      : {}),
  };
}

/** Registered API refusal for an explicit selection whose connection generation was replaced. */
const INTEGRATION_CONNECTION_STALE_SLUG = "integration-connection-stale";

/**
 * @internal REST Problems carry no retryability flag. The API registers this refusal as a
 * non-retryable precondition failure: repeating the same generation cannot succeed.
 */
export function readStaleConnectionCondition(
  value: unknown,
): IntegrationFailureCondition | undefined {
  const problem = readIntegrationHttpProblem(value);
  return problem?.slug === INTEGRATION_CONNECTION_STALE_SLUG && problem.status === 409
    ? { ...problem, retryable: false }
    : undefined;
}
