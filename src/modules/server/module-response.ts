/**
 * Module Response - the single owner of turning a module-serve failure into
 * an HTTP Response.
 *
 * `serveModule` (module-server.ts) has two very different reasons to fail a
 * request for the same status code: the module simply doesn't exist (a
 * cacheable miss), or the request was refused by an admission/protection
 * check (an uncacheable rejection). Those two cases must never share a
 * `Cache-Control` directive. A shared cache that reused a rejection across a
 * differently-admitted request would leak an authorization decision across a
 * security boundary. Naming the two shapes here, instead of re-spelling the
 * header pair inline at each call site, is what keeps that difference from
 * being silently "tidied away" by a future edit.
 *
 * @module modules/server/module-response
 */

import { HTTP_BAD_REQUEST, HTTP_NOT_FOUND } from "#veryfront/utils";
import { metrics } from "#veryfront/observability";
import { HttpStatus } from "#veryfront/http/responses";

const TEXT_PLAIN = "text/plain; charset=utf-8";

/** Builds the Response and records the module-serve metric exactly as the call sites did inline. */
function respond(
  method: string,
  body: string,
  status: number,
  headers: Record<string, string>,
): Response {
  // This module is failure-only by design. A 2xx success shape must not be added without
  // revisiting the metric label logic to avoid silently recording success as "error".
  metrics.recordModuleServe(status === HTTP_NOT_FOUND ? "not_found" : "error");
  return new Response(method === "HEAD" ? null : body, { status, headers });
}

/**
 * Ordinary module miss: nothing exists at this path.
 *
 * `no-cache` (revalidate before reuse) is safe here because the absence of a
 * resource is not a decision that varies by caller or credential, so it is
 * fine to remember and re-check.
 */
export function moduleNotFound(method: string, message = "Module not found"): Response {
  return respond(method, message, HTTP_NOT_FOUND, {
    "Content-Type": TEXT_PLAIN,
    "Cache-Control": "no-cache",
  });
}

/**
 * Admission / protected-path rejection: the module exists, but this request
 * is not allowed to see it (protected path, production release manifest
 * admission, server-only module boundary, rejected dependency, ...).
 *
 * This must stay `no-store`. Unlike {@link moduleNotFound}, this response
 * reflects an authorization decision, not the absence of a resource, and
 * caching it would
 * risk serving (or hiding) that decision for a request it was never made for.
 * Do not change this to `no-cache` to "match" the not-found case; that is a
 * security regression, not a cleanup.
 */
export function moduleRejected(method: string, message = "Module not found"): Response {
  return respond(method, message, HTTP_NOT_FOUND, {
    "Content-Type": TEXT_PLAIN,
    "Cache-Control": "no-store",
  });
}

/** Malformed request the caller cannot fix by retrying identically. */
export function moduleBadRequest(method: string, message: string): Response {
  return respond(method, message, HTTP_BAD_REQUEST, {
    "Content-Type": TEXT_PLAIN,
    "Cache-Control": "no-cache",
  });
}

/** HTTP verb other than GET/HEAD. */
export function moduleMethodNotAllowed(method: string): Response {
  return respond(method, "Method not allowed", HttpStatus.METHOD_NOT_ALLOWED, {
    "Allow": "GET, HEAD",
    "Content-Type": TEXT_PLAIN,
    "Cache-Control": "no-store",
  });
}

/** Server-side state required to admit the request (e.g. a release manifest) isn't ready. */
export function moduleServiceUnavailable(method: string, message: string): Response {
  return respond(method, message, HttpStatus.SERVICE_UNAVAILABLE, {
    "Content-Type": TEXT_PLAIN,
    "Cache-Control": "no-store",
  });
}

/** The client's dependency-pinning cache key does not match a known snapshot. */
export function unknownDependencySnapshot(method: string): Response {
  return respond(method, "Unknown dependency snapshot", HttpStatus.CONFLICT, {
    "Content-Type": TEXT_PLAIN,
    "Cache-Control": "no-store",
  });
}
