import { metricsRuntimeState } from "./runtime-state.ts";

/**
 * Reset process-wide metrics state between tests.
 *
 * This module is intentionally absent from the package exports map.
 */
export function resetMetricsForTests(): void {
  metricsRuntimeState.reset();
}
