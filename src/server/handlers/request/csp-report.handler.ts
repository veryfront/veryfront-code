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

/**
 * Read at most `maxBytes` from the body.
 *
 * `req.text()` would buffer the whole body first and only then let us measure
 * it, which makes the cap advisory: a request with no `content-length`, or a
 * dishonest one, is already in memory by the time it is rejected. Counting
 * bytes off the stream is the only version of this limit that holds.
 *
 * @returns the decoded body, or undefined if it was empty, oversized or unreadable
 */
async function readBoundedBody(req: Request, maxBytes: number): Promise<string | undefined> {
  if (!req.body) return undefined;

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } catch {
    return undefined;
  }

  if (total === 0) return undefined;

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(joined);
  } catch {
    return undefined;
  }
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

export class CspReportHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "CspReportHandler",
    priority: PRIORITY_HIGH as HandlerPriority,
    patterns: [{ pattern: CSP_REPORT_PATH, exact: true, method: "POST" }],
  };

  // Instance state rather than module state: one handler is built per registry,
  // so production behaviour is the same, and each test gets a fresh window
  // without the handler having to export a reset hook it does not otherwise need.
  #windowStartedAt = 0;
  #loggedInWindow = 0;
  #droppedInWindow = 0;

  /** Whether this report may be logged, and what the previous window swallowed. */
  #admitToLog(now: number): { admitted: boolean; dropped: number } {
    let dropped = 0;

    if (now - this.#windowStartedAt >= LOG_WINDOW_MS) {
      dropped = this.#droppedInWindow;
      this.#windowStartedAt = now;
      this.#loggedInWindow = 0;
      this.#droppedInWindow = 0;
    }

    if (this.#loggedInWindow >= MAX_LOGGED_PER_WINDOW) {
      this.#droppedInWindow += 1;
      return { admitted: false, dropped: 0 };
    }

    this.#loggedInWindow += 1;
    return { admitted: true, dropped };
  }

  override async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return this.continue();
    if (req.method !== "POST") return this.continue();

    // Always 204, whatever the body turned out to be. A browser has nothing to
    // do with an error, and a hostile poster should learn nothing from one.
    const accepted = this.respond(new Response(null, { status: HTTP_NO_CONTENT }));

    // Cheap rejection when the sender declares an oversized body. The stream
    // read below is what actually enforces the limit.
    const declaredLength = Number(req.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return accepted;

    const raw = await readBoundedBody(req, MAX_BODY_BYTES);
    if (raw === undefined) return accepted;

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return accepted;
    }

    const violations = normalizeReports(payload);
    if (violations.length === 0) return accepted;

    const { admitted, dropped } = this.#admitToLog(Date.now());
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
