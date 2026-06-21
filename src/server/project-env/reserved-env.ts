import { isReservedSharedRuntimeTelemetryEnvKey } from "#veryfront/observability/tracing/telemetry-env.ts";

export function filterSharedRuntimeProjectEnv(
  vars: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(vars).filter(([key]) => !isReservedSharedRuntimeTelemetryEnvKey(key)),
  );
}
