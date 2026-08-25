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
import { isRequestBodyTooLargeError, readBodyWithLimit } from "#veryfront/security/index.ts";

const logger = serverLogger.component("csp-report");

/**
 * Reports come from browsers, unauthenticated, and anyone can post whatever
 * they like to this path. Nothing here is trusted: the body is read against a
 * byte budget rather than buffered whole, every logged field is truncated, and
 * the response is always 204 so a hostile poster learns nothing about what was
 * accepted.
 */
const MAX_BODY_BYTES = 64 * 1024;
const MAX_FIELD_LENGTH = 512;
const MAX_REPORTS_PER_REQUEST = 16;

/**
 * A busy project can emit violations on every page view. Logging each one would
 * let a single misconfigured site drown the log stream, so each handler keeps a
 * ceiling per window and records how many it dropped.
 */
const LOG_WINDOW_MS = 60_000;
const MAX_LOGGED_PER_WINDOW = 100;

/** Control characters a poster could use to forge extra log records (CWE-117). */
// deno-lint-ignore no-control-regex -- intentionally matching control chars to strip them
const LOG_CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/g;

function readField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const stripped = value.replace(LOG_CONTROL_CHARS, "");
  if (stripped.length === 0) return undefined;
  return stripped.length > MAX_FIELD_LENGTH ? `${stripped.slice(0, MAX_FIELD_LENGTH)}…` : stripped;
}

/**
 * Same as {@link readField}, minus the query string. A violating URL carries
 * whatever the page was called with, which can include session identifiers and
 * personal data; the origin and path are what identify the violation.
 */
function readUri(value: unknown): string | undefined {
  const field = readField(value);
  if (field === undefined) return undefined;
  const cut = field.search(/[?#]/);
  return cut === -1 ? field : field.slice(0, cut);
}

export interface NormalizedViolation {
  documentUri?: string;
  effectiveDirective?: string;
  blockedUri?: string;
  disposition?: string;
  statusCode?: number;
}

function readStatusCode(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
export function normalizeReports(payload: unknown): NormalizedViolation[] {
  const fromBody = (body: Record<string, unknown>): NormalizedViolation => ({
    // Each field has a legacy hyphenated spelling and a Reporting API
    // camel-case one, and `violated-directive` is deprecated in favour of
    // `effective-directive`. Reading only one spelling silently loses the
    // directive and status, which is the data the rollout decision needs.
    documentUri: readUri(body["document-uri"] ?? body.documentURL),
    effectiveDirective: readField(
      body["effective-directive"] ?? body.effectiveDirective ?? body["violated-directive"],
    ),
    blockedUri: readUri(body["blocked-uri"] ?? body.blockedURL),
    disposition: readField(body.disposition),
    statusCode: readStatusCode(body["status-code"] ?? body.statusCode),
  });

  if (Array.isArray(payload)) {
    // Filter before taking the first N: a batch may carry other report types,
    // and slicing first would discard violations queued behind them.
    return payload
      .filter((entry) => readRecord(entry)?.type === "csp-violation")
      .slice(0, MAX_REPORTS_PER_REQUEST)
      .map((entry) => fromBody(readRecord(readRecord(entry)?.body) ?? {}));
  }

  const record = readRecord(payload);
  if (!record) return [];

  const legacy = readRecord(record["csp-report"]);
  return legacy ? [fromBody(legacy)] : [];
}

/**
 * Per-window budget for log records.
 *
 * Charged per record rather than per request: one admission covering a whole
 * batch would let a sender post {@link MAX_REPORTS_PER_REQUEST} violations at a
 * time and write 16x the ceiling. The endpoint is unauthenticated, so this bound
 * is the only thing protecting the log stream.
 *
 * Separate from the handler so the arithmetic can be tested as arithmetic,
 * rather than by intercepting log output.
 */
export function createLogWindow(
  maxPerWindow: number = MAX_LOGGED_PER_WINDOW,
  windowMs: number = LOG_WINDOW_MS,
): {
  /** @returns how many of `lines` may be written, and what the previous window swallowed */
  reserve: (now: number, lines: number) => { allowed: number; dropped: number };
} {
  let startedAt = 0;
  let logged = 0;
  let droppedInWindow = 0;

  return {
    reserve(now: number, lines: number) {
      let dropped = 0;

      if (now - startedAt >= windowMs) {
        dropped = droppedInWindow;
        startedAt = now;
        logged = 0;
        droppedInWindow = 0;
      }

      const allowed = Math.min(lines, Math.max(0, maxPerWindow - logged));
      logged += allowed;
      droppedInWindow += lines - allowed;

      return { allowed, dropped };
    },
  };
}

export class CspReportHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "CspReportHandler",
    priority: PRIORITY_HIGH as HandlerPriority,
    patterns: [{ pattern: CSP_REPORT_PATH, exact: true, method: "POST" }],
  };

  // Instance state rather than module state: one handler is built per registry,
  // so production behaviour is the same, and each test gets a fresh window
  // without the handler having to export a reset hook it does not otherwise need.
  #logWindow = createLogWindow();

  override async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return this.continue();
    if (req.method !== "POST") return this.continue();

    // Always 204, whatever the body turned out to be. A browser has nothing to
    // do with an error, and a hostile poster should learn nothing from one.
    const accepted = this.respond(new Response(null, { status: HTTP_NO_CONTENT }));

    let raw: string;
    try {
      // Shared reader: Content-Length is an early hint only, the streamed byte
      // count is authoritative, and tiny transport chunks are coalesced so
      // chunk metadata cannot grow independently of the limit.
      raw = await readBodyWithLimit(req, MAX_BODY_BYTES);
    } catch (error) {
      if (!isRequestBodyTooLargeError(error)) {
        logger.debug("Unreadable CSP report body", { projectSlug: ctx.projectSlug });
      }
      return accepted;
    }
    if (raw.length === 0) return accepted;

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return accepted;
    }

    const violations = normalizeReports(payload);
    if (violations.length === 0) return accepted;

    const { allowed, dropped } = this.#logWindow.reserve(Date.now(), violations.length);
    if (allowed === 0) return accepted;

    for (const violation of violations.slice(0, allowed)) {
      logger.warn("CSP violation reported", {
        projectSlug: ctx.projectSlug,
        ...violation,
        ...(dropped > 0 ? { droppedSincePreviousWindow: dropped } : {}),
      });
    }

    return accepted;
  }
}
