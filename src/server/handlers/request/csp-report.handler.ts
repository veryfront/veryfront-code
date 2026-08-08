/**
 * CSP Violation Report Handler
 *
 * Receives the reports the platform CSP asks browsers to send, and writes them
 * to the server log.
 *
 * Without this the report-only floor is inert at the platform level: it does
 * not enforce, so it protects nothing, and with no reporting endpoint the
 * violations it names reach only whoever happens to open devtools on the
 * affected page. That leaves the enforcement rollout with no instrument --
 * no way to answer "which projects would break if we enforced?" short of
 * breaking them and waiting for complaints, which is how the floor shipped
 * the first time.
 *
 * Endpoint: POST /_vf/csp-report
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { HTTP_NO_CONTENT, PRIORITY_HIGH } from "#veryfront/utils/constants/index.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { CSP_REPORT_PATH } from "#veryfront/security/http/csp-report-endpoint.ts";

const logger = serverLogger.component("csp-report");

/**
 * Reports come from browsers, unauthenticated, and anyone can post whatever
 * they like to this path. Nothing here is trusted: the body is size-capped
 * before parsing, every logged field is truncated, and the response is always
 * 204 so a hostile poster learns nothing about what was accepted.
 */
const MAX_BODY_BYTES = 64 * 1024;
const MAX_FIELD_LENGTH = 512;
const MAX_REPORTS_PER_REQUEST = 16;

/**
 * A busy project can emit violations on every page view. Logging each one
 * would let a single misconfigured site drown the log stream, so keep a
 * per-process ceiling per window and record how many were dropped.
 */
const LOG_WINDOW_MS = 60_000;
const MAX_LOGGED_PER_WINDOW = 100;

let windowStartedAt = 0;
let loggedInWindow = 0;
let droppedInWindow = 0;

/** Exposed for tests; a fresh process starts with an empty window anyway. */
export function resetCspReportRateLimit(): void {
  windowStartedAt = 0;
  loggedInWindow = 0;
  droppedInWindow = 0;
}

function admitToLog(now: number): { admitted: boolean; dropped: number } {
  if (now - windowStartedAt >= LOG_WINDOW_MS) {
    const dropped = droppedInWindow;
    windowStartedAt = now;
    loggedInWindow = 0;
    droppedInWindow = 0;
    if (dropped > 0) return { admitted: true, dropped };
  }

  if (loggedInWindow >= MAX_LOGGED_PER_WINDOW) {
    droppedInWindow += 1;
    return { admitted: false, dropped: 0 };
  }

  loggedInWindow += 1;
  return { admitted: true, dropped: 0 };
}

function truncate(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.length > MAX_FIELD_LENGTH ? `${value.slice(0, MAX_FIELD_LENGTH)}…` : value;
}

interface NormalizedViolation {
  documentUri?: string;
  effectiveDirective?: string;
  blockedUri?: string;
  disposition?: string;
  statusCode?: number;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * Two wire formats reach this path and both are still in the field: the legacy
 * `application/csp-report` body with a single `csp-report` key, and the
 * Reporting API's `application/reports+json` array. Normalize to one shape so
 * the log has a single schema regardless of which browser sent it.
 */
function normalizeReports(payload: unknown): NormalizedViolation[] {
  const fromBody = (body: Record<string, unknown>): NormalizedViolation => ({
    documentUri: truncate(body["document-uri"] ?? body.documentURL),
    // `violated-directive` is the deprecated spelling; prefer the current one.
    effectiveDirective: truncate(body["effective-directive"] ?? body["violated-directive"]),
    blockedUri: truncate(body["blocked-uri"] ?? body.blockedURL),
    disposition: truncate(body.disposition),
    statusCode: typeof body["status-code"] === "number" ? body["status-code"] : undefined,
  });

  if (Array.isArray(payload)) {
    return payload
      .slice(0, MAX_REPORTS_PER_REQUEST)
      .filter((entry) => readRecord(entry)?.type === "csp-violation")
      .map((entry) => fromBody(readRecord(readRecord(entry)?.body) ?? {}));
  }

  const record = readRecord(payload);
  if (!record) return [];

  const legacy = readRecord(record["csp-report"]);
  return legacy ? [fromBody(legacy)] : [];
}

export class CspReportHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "CspReportHandler",
    priority: PRIORITY_HIGH as HandlerPriority,
    patterns: [{ pattern: CSP_REPORT_PATH, exact: true, method: "POST" }],
  };

  override async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return this.continue();
    if (req.method !== "POST") return this.continue();

    // Always 204, whatever the body turned out to be. A browser has nothing to
    // do with an error, and a hostile poster should learn nothing from one.
    const accepted = this.respond(new Response(null, { status: HTTP_NO_CONTENT }));

    const declaredLength = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return accepted;

    let payload: unknown;
    try {
      const raw = await req.text();
      if (raw.length === 0 || raw.length > MAX_BODY_BYTES) return accepted;
      payload = JSON.parse(raw);
    } catch {
      return accepted;
    }

    const violations = normalizeReports(payload);
    if (violations.length === 0) return accepted;

    const { admitted, dropped } = admitToLog(Date.now());
    if (!admitted) return accepted;

    for (const violation of violations) {
      logger.warn("CSP violation reported", {
        projectSlug: ctx.projectSlug,
        ...violation,
        ...(dropped > 0 ? { droppedSincePreviousWindow: dropped } : {}),
      });
    }

    return accepted;
  }
}
