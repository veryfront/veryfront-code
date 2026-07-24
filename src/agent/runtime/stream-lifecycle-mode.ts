import { getHostEnv } from "#veryfront/platform/compat/process.ts";

export type StreamLifecycleMode = "legacy" | "shadow" | "active";

export function resolveStreamLifecycleMode(
  value: unknown,
  fallback: StreamLifecycleMode,
): StreamLifecycleMode {
  return value === "legacy" || value === "shadow" || value === "active" ? value : fallback;
}

export function resolveStreamLifecycleModeFromEnv(): StreamLifecycleMode {
  return resolveStreamLifecycleMode(
    getHostEnv("VF_STREAM_LIFECYCLE_MODE"),
    "legacy",
  );
}
