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
