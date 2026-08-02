import type { AutoInstrumentConfig, MetricsConfig, TracingConfig } from "./types.ts";

export const DEFAULT_CONFIG: Readonly<AutoInstrumentConfig> = Object.freeze({
  instrumentHttp: true,
  instrumentFetch: true,
  instrumentReact: true,
  captureErrors: true,
});

export function mergeConfig(config: AutoInstrumentConfig = {}): AutoInstrumentConfig {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError("Auto-instrumentation config must be an object");
  }

  const raw = config as Record<string, unknown>;
  const merged: AutoInstrumentConfig = {};
  for (
    const key of [
      "instrumentHttp",
      "instrumentFetch",
      "instrumentReact",
      "captureErrors",
    ] as const
  ) {
    const value = raw[key] === undefined ? DEFAULT_CONFIG[key] : raw[key];
    if (typeof value !== "boolean") {
      throw new TypeError(`Auto-instrumentation ${key} must be a boolean`);
    }
    merged[key] = value;
  }

  if (raw.tracing !== undefined) {
    merged.tracing = snapshotNestedConfig<TracingConfig>(
      raw.tracing,
      "tracing",
    );
  }
  if (raw.metrics !== undefined) {
    merged.metrics = snapshotNestedConfig<MetricsConfig>(
      raw.metrics,
      "metrics",
    );
  }
  return merged;
}

function snapshotNestedConfig<T extends object>(value: unknown, name: string): T {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Auto-instrumentation ${name} config must be an object`);
  }
  const snapshot = { ...value } as Record<string, unknown>;
  if (typeof snapshot.enabled !== "boolean") {
    throw new TypeError(
      `Auto-instrumentation ${name} enabled must be a boolean`,
    );
  }
  return snapshot as T;
}
