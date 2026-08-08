/**
 * Where the platform CSP asks browsers to send violation reports.
 *
 * The policy is built in the security module and the reports are received by a
 * server handler, so the path and the group name live here, on the side both
 * can depend on. They have to agree: a `report-to` directive naming a group the
 * `Reporting-Endpoints` header does not define makes the browser send nothing,
 * and it fails silently.
 */

/** Path serving {@link CSP_REPORT_ENDPOINT_NAME}, on the project's own origin. */
export const CSP_REPORT_PATH = "/_vf/csp-report";

/** Reporting group tying the CSP `report-to` directive to `Reporting-Endpoints`. */
export const CSP_REPORT_ENDPOINT_NAME = "veryfront-csp";

/**
 * Whether a request is the platform's own CSP report submission.
 *
 * The auth and CSRF gates both run ahead of the handler and both refuse a
 * browser-generated report: it carries no credentials and no CSRF token,
 * because a violation report is not a user action. Left alone, any project
 * enabling either feature advertises a reporting endpoint that silently
 * collects nothing.
 *
 * Exempting it is safe on the terms those gates exist for. The endpoint reads
 * no credentials, changes no state, and answers 204 regardless of the body, so
 * it discloses nothing about a protected project; what it writes is a bounded,
 * sanitized, rate-limited log line.
 */
export function isCspReportRequest(method: string, pathname: string): boolean {
  return method.toUpperCase() === "POST" && pathname === CSP_REPORT_PATH;
}
