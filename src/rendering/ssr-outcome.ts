import { isDataControlResult } from "#veryfront/data/helpers.ts";
import type { DataResponseMetadata, DataResult } from "#veryfront/data/types.ts";
import {
  getAttachedDataResponseMetadata,
  normalizeDataResponseMetadata,
} from "#veryfront/data/response-metadata.ts";
import { VeryfrontError } from "#veryfront/errors";

export type SSRControlOutcome =
  | ({ kind: "not-found" } & DataResponseMetadata)
  | {
    kind: "redirect";
    location: string;
    permanent: boolean;
  } & DataResponseMetadata;

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
  headers?: unknown;
  cookies?: unknown;
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

/**
 * The routing decision a failed render carries, under any brand the framework
 * raises for one.
 *
 * {@link findSSRControlOutcome} recognises only a thrown data control result.
 * Two more brands mean the same thing by the time an error leaves the render
 * pipeline: a `file-not-found` VeryfrontError, raised both when no page matches
 * the slug and when a loader answered `notFound()`; and a `render-error`
 * carrying `context.redirect`, raised when a loader answered `redirect()`.
 * Anything deciding 404-vs-500, or whether to hand a redirect to the client,
 * wants all three.
 *
 * Message text is never consulted. A project error that merely reads "not
 * found" is a failure, and answering it with a 404 hides the failure, renders
 * the wrong page, and caches a status the site never asked for.
 */
export function resolveSSRControlOutcome(error: unknown): SSRControlOutcome | null {
  const control = findSSRControlOutcome(error);
  if (control) return control;

  if (isFileNotFoundError(error)) {
    return {
      kind: "not-found",
      ...getAttachedDataResponseMetadata(error),
    };
  }

  if (error instanceof VeryfrontError && error.slug === "render-error") {
    const redirect = extractRedirectLocation(error);
    if (redirect) {
      return {
        kind: "redirect",
        location: redirect.destination,
        permanent: redirect.permanent,
        ...redirect.responseMetadata,
      };
    }
  }

  return null;
}

/**
 * True for errors raised while compiling or resolving project source, as
 * opposed to errors thrown by the running application.
 *
 * Module-load failures arrive wrapped in a RUNTIME-category `render-error`,
 * which loses the original category, so they carry a `buildFailure` flag that
 * the module loader sets at the point of failure. Failing to load is not
 * evidence on its own: a module that compiled fine and threw at module scope
 * also fails to load, and that is an application error the project's own error
 * page should present.
 *
 * This is orthogonal to {@link SSRFailureOutcome}. A build failure is still
 * classified `runtime` or `server-error` like any other error; the answer here
 * only says whether the project is allowed to dress it up.
 */
export function isSSRBuildFailure(error: unknown): boolean {
  if (!(error instanceof VeryfrontError)) return false;
  if (error.category === "BUILD" || error.category === "MODULE") return true;

  const context = error.context as { buildFailure?: unknown } | undefined;
  return context?.buildFailure === true;
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

  // Ordering against the undeployed check below is free: that one needs an
  // `api-client-error`, and neither control brand can carry that slug.
  const control = resolveSSRControlOutcome(error);
  if (control) return control;

  if (isUndeployedFileListError(error)) {
    return { kind: "undeployed", error: errorObj };
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
      ...normalizeDataResponseMetadata(result),
    };
  }

  return {
    kind: "not-found",
    ...normalizeDataResponseMetadata(result),
  };
}

function extractRedirectLocation(
  error: VeryfrontError,
): {
  destination: string;
  permanent: boolean;
  responseMetadata: DataResponseMetadata;
} | null {
  const context = error.context as RedirectResultContext | undefined;
  const redirect = context?.redirect;
  if (!redirect || typeof redirect.destination !== "string") return null;

  try {
    return {
      destination: redirect.destination,
      permanent: redirect.permanent === true,
      responseMetadata: getAttachedDataResponseMetadata(error),
    };
  } catch {
    return null;
  }
}

function isFileNotFoundError(error: unknown): error is VeryfrontError {
  return error instanceof VeryfrontError && error.slug === "file-not-found";
}

/**
 * True for the veryfront-api filesystem adapter's own "this path is not in the
 * release" error, and for nothing else.
 *
 * The `file-not-found` slug alone is not safe to route a status on. It is
 * raised in-tree for conditions that are not an absent source at all:
 * `transforms/esm/http-cache.ts` raises it when a bundle write reports success
 * and the file still is not there, and `discovery/transpiler.ts` folds EACCES,
 * EIO, aborts and timeouts into it. Both are server faults, and answering them
 * with a 404 would hide a real outage behind a status nothing alerts on.
 *
 * `code` narrows it: of the sixteen in-tree raisers of this slug, exactly two
 * set ENOENT alongside it -- `createNotFoundLikeError`, and the re-raise in
 * `rendering/orchestrator/pipeline.ts`, which carries the marker across that
 * boundary only when every critical failure already had it. Removing either
 * assignment reddens tests.
 *
 * This is a correctness guard, not a security boundary, and the distinction
 * matters because the check reads as though it were one. `FILE_NOT_FOUND` and
 * `VeryfrontError` are public API via `veryfront/errors`, so project code can
 * raise this slug and assign an own `code` that this predicate accepts. The
 * own-data-descriptor read stops an accidental accessor, not a determined
 * forgery, and no project getter runs during classification. A project that
 * did forge it would route its own route to 404 and suppress its own alerting;
 * nothing cross-tenant turns on it, and `notFound()` already lets a project
 * reach a 404 by design.
 *
 * The narrowing is deliberately conservative: adapters that raise the slug
 * without ENOENT -- `runtime/cloudflare/filesystem.ts`, `fs/github`, `mock.ts`,
 * `skill/testing.ts` -- answer 500 for a genuinely absent file rather than 404.
 * Wrong in the safe direction today because SSR is served through the
 * veryfront-api adapter. If SSR is ever served through one of those, the
 * symptom this guard exists to fix returns there and they need the marker too.
 *
 * Message text is never consulted, so an error that merely reads "not found"
 * stays a fault.
 */
export function isMissingProjectSourceError(error: unknown): boolean {
  if (!isFileNotFoundError(error)) return false;

  const code = Object.getOwnPropertyDescriptor(error, "code");
  return code !== undefined && "value" in code && code.value === "ENOENT";
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
