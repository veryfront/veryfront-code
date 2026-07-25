import { getEnv, getHostEnv } from "#veryfront/platform/compat/process.ts";
import { isTruthyEnvValue } from "#veryfront/utils/constants/env.ts";

function metricsDebugEnabled(): boolean {
  try {
    return isTruthyEnvValue(getEnv("VERYFRONT_DEBUG")) ||
      isTruthyEnvValue(getHostEnv("VERYFRONT_DEBUG"));
  } catch {
    return false;
  }
}

export function logMetricFailure(message: string, error?: unknown): void {
  if (!metricsDebugEnabled()) return;
  try {
    console.warn(
      `[metrics] measurement dropped: ${message}`,
      ...(error === undefined ? [] : [error]),
    );
  } catch {
    // Telemetry diagnostics must never affect application execution.
  }
}

export function logDirectExportFailure(
  message: string,
  error?: unknown,
): void {
  if (!metricsDebugEnabled()) return;
  try {
    console.warn(
      `[metrics] direct OTLP export failed: ${message}`,
      ...(error === undefined ? [] : [error]),
    );
  } catch {
    // Telemetry diagnostics must never affect application execution.
  }
}
