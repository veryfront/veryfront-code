import { captureApplicationError } from "#veryfront/observability/application-errors.ts";

/**
 * Report a 5xx handler failure. Handlers convert errors into responses, so
 * these never escape to a global handler and would not otherwise reach Sentry.
 * 4xx is excluded as noise. No-op when no reporter is installed.
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
