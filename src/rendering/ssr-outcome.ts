import { isDataControlResult } from "#veryfront/data/helpers.ts";
import type { DataResult } from "#veryfront/data/types.ts";
import { VeryfrontError } from "#veryfront/errors";

export type SSRControlOutcome =
  | { kind: "not-found" }
  | {
    kind: "redirect";
    location: string;
    permanent: boolean;
  };

export type SSRFailureOutcome =
  | SSRControlOutcome
  | {
    kind: "app-router-error-boundary";
    html: string;
    error: Error;
  }
  | {
    kind: "undeployed";
    error: Error;
  }
  | {
    kind: "overloaded";
    status: number;
    error: Error;
  }
  | {
    kind: "runtime";
    exposure: "development-overlay";
    error: Error;
  }
  | {
    kind: "server-error";
    exposure: "generic";
    error: Error;
  };

interface RedirectResultContext {
  redirect?: {
    destination?: unknown;
    permanent?: unknown;
  };
}

interface ErrorBoundarySignal {
  errorBoundaryHtml?: unknown;
}

export function findSSRControlOutcome(error: unknown): SSRControlOutcome | null {
  const seen = new Set<unknown>();
  const stack: unknown[] = [error];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;

    if (isDataControlResult(current)) {
      return toSSRControlOutcome(current);
    }

    seen.add(current);
    stack.push((current as { cause?: unknown }).cause);
    const aggregated = (current as { errors?: unknown }).errors;
    if (Array.isArray(aggregated)) stack.push(...aggregated);
  }

  return null;
}

export function isSSRControlOutcome(error: unknown): boolean {
  return findSSRControlOutcome(error) !== null;
}

export function resolveSSRFailure(
  error: unknown,
  context: { isLocalProject: boolean },
): SSRFailureOutcome {
  const errorObj = error instanceof Error ? error : new Error(String(error));
  const errorBoundaryHtml = (error as ErrorBoundarySignal | undefined)?.errorBoundaryHtml;
  if (typeof errorBoundaryHtml === "string") {
    return {
      kind: "app-router-error-boundary",
      html: errorBoundaryHtml,
      error: errorObj,
    };
  }

  const control = findSSRControlOutcome(error);
  if (control) return control;

  if (error instanceof VeryfrontError && error.slug === "file-not-found") {
    return { kind: "not-found" };
  }

  if (isUndeployedFileListError(error)) {
    return { kind: "undeployed", error: errorObj };
  }

  if (error instanceof VeryfrontError && error.slug === "render-error") {
    const redirect = extractRedirectLocation(error);
    if (redirect) {
      return {
        kind: "redirect",
        location: redirect.destination,
        permanent: redirect.permanent,
      };
    }
  }

  if (error instanceof VeryfrontError && error.slug === "service-overloaded") {
    return { kind: "overloaded", status: error.status ?? 503, error: errorObj };
  }

  if (context.isLocalProject) {
    return { kind: "runtime", exposure: "development-overlay", error: errorObj };
  }

  return { kind: "server-error", exposure: "generic", error: errorObj };
}

function toSSRControlOutcome(result: DataResult): SSRControlOutcome {
  if (result.redirect) {
    return {
      kind: "redirect",
      location: result.redirect.destination,
      permanent: result.redirect.permanent === true,
    };
  }

  return { kind: "not-found" };
}

function extractRedirectLocation(
  error: VeryfrontError,
): { destination: string; permanent: boolean } | null {
  const redirect = (error.context as RedirectResultContext | undefined)?.redirect;
  if (!redirect || typeof redirect.destination !== "string") return null;

  return {
    destination: redirect.destination,
    permanent: redirect.permanent === true,
  };
}

function isUndeployedFileListError(error: unknown): boolean {
  if (!(error instanceof VeryfrontError) || error.slug !== "api-client-error") return false;
  if (error.status !== 404) return false;

  const apiUrl =
    (((error.context as { details?: { url?: string } } | undefined)?.details?.url) ?? "")
      .toString();

  return apiUrl.includes("/files") &&
    !apiUrl.includes("/files/") &&
    (apiUrl.includes("/environments/") || apiUrl.includes("/branches/"));
}
