import { getHostEnv } from "#veryfront/platform/compat/process.ts";

const RESERVED_SHARED_RUNTIME_TELEMETRY_ENV_KEYS = new Set([
  "VERYFRONT_OTEL",
]);

/** Read a telemetry value from the process-owned host environment. */
export function getHostTelemetryEnv(key: string): string | undefined {
  return getHostEnv(key);
}

/** Check whether a host-owned telemetry key must be hidden from project overlays. */
export function isReservedSharedRuntimeTelemetryEnvKey(key: string): boolean {
  return key.startsWith("OTEL_") || RESERVED_SHARED_RUNTIME_TELEMETRY_ENV_KEYS.has(key);
}
