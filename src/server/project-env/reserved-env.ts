import { isReservedSharedRuntimeTelemetryEnvKey } from "#veryfront/observability";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";

export function filterSharedRuntimeProjectEnv(
  vars: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(vars).filter(([key]) => !isReservedSharedRuntimeTelemetryEnvKey(key)),
  );
}

function isDedicatedRuntime(): boolean {
  return Boolean(getHostEnv("SERVER_ID") && getHostEnv("ENVIRONMENT_IDS"));
}

export function filterRuntimeProjectEnv(
  vars: Record<string, string>,
): Record<string, string> {
  if (isDedicatedRuntime()) return { ...vars };
  return filterSharedRuntimeProjectEnv(vars);
}
