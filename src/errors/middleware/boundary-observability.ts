import { recordErrorCount } from "#veryfront/observability/metrics/index.ts";
import { trace } from "#veryfront/observability/tracing/api-shim.ts";
import { snapshotErrorForBoundary } from "../safe-diagnostics.ts";
import { attachErrorToActiveSpan } from "../tracing.ts";
import type { VeryfrontError } from "../types.ts";

/**
 * Report a boundary error without allowing optional observability backends to
 * replace the boundary's intended response, output, or exit behavior.
 */
export function observeBoundaryErrorBestEffort(error: VeryfrontError): void {
  try {
    const snapshot = snapshotErrorForBoundary(error);
    recordErrorCount({
      slug: snapshot.slug,
      category: snapshot.category,
      status: String(snapshot.status),
    });
  } catch {
    // Metrics are diagnostic only; the boundary must continue handling the error.
  }

  try {
    attachErrorToActiveSpan(error, trace);
  } catch {
    // Tracing is diagnostic only; the boundary must continue handling the error.
  }
}
