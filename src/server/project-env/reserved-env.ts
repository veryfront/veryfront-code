import { isReservedSharedRuntimeTelemetryEnvKey } from "#veryfront/observability";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { createProjectEnvSnapshot, type ProjectEnvSnapshot } from "./snapshot.ts";

export function filterSharedRuntimeProjectEnv(
  vars: Readonly<Record<string, string>>,
): ProjectEnvSnapshot {
  const source = createProjectEnvSnapshot(vars);
  const filtered = Object.create(null) as Record<string, string>;
  for (const key of Reflect.ownKeys(source)) {
    if (typeof key !== "string" || isReservedSharedRuntimeTelemetryEnvKey(key)) continue;
    Object.defineProperty(filtered, key, {
      value: source[key],
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return createProjectEnvSnapshot(filtered);
}

function isDedicatedRuntime(): boolean {
  return Boolean(getHostEnv("SERVER_ID") && getHostEnv("ENVIRONMENT_IDS"));
}

export function filterRuntimeProjectEnv(
  vars: Readonly<Record<string, string>>,
): ProjectEnvSnapshot {
  if (isDedicatedRuntime()) return createProjectEnvSnapshot(vars);
  return filterSharedRuntimeProjectEnv(vars);
}
