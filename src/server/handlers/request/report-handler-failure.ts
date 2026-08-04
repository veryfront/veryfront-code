import { captureApplicationError } from "#veryfront/observability/application-errors.ts";

/**
 * Report a 5xx request-handler failure.
 *
 * Handlers convert every error into a response, so nothing escapes to a global
 * handler and these would otherwise never reach Sentry. Call this only for 5xx:
 * 4xx is mostly validation and auth noise.
 *
 * Callers pass `detail` where they have it, because errorToResponse strips it
 * from 5xx bodies and it is then lost entirely. Attributes are sanitized by the
 * reporter (URL credentials stripped, sensitive keys redacted, values
 * truncated) before leaving the process.
 *
 * No-op when no reporter is installed, so Sentry stays optional.
 */
export function reportHandlerFailure(
  error: unknown,
  details: {
    boundary: string;
    method: string;
    status: number;
    runId?: string | null;
    projectId?: string;
    projectSlug?: string;
    slug?: string;
    category?: string;
    detail?: string;
    cause?: string;
  },
): void {
  const attributes: Record<string, string | number | boolean> = {
    "http.status": details.status,
  };
  if (details.slug) attributes["error.slug"] = details.slug;
  if (details.category) attributes["error.category"] = details.category;
  if (details.detail) attributes["error.detail"] = details.detail;
  if (details.cause) attributes["error.cause"] = details.cause;
  if (details.projectId) attributes["project.id"] = details.projectId;
  if (details.projectSlug) attributes["project.slug"] = details.projectSlug;

  captureApplicationError(error, {
    boundary: details.boundary,
    method: details.method,
    ...(details.runId ? { requestId: details.runId } : {}),
    attributes,
  });
}
