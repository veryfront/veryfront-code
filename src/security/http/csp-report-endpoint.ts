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
