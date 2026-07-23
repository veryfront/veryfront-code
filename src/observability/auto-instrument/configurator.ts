import type { AutoInstrumentConfig } from "./types.ts";

export const DEFAULT_CONFIG = {
  instrumentHttp: true,
  instrumentFetch: true,
  instrumentReact: true,
  captureErrors: true,
} satisfies AutoInstrumentConfig;

export function mergeConfig(config: AutoInstrumentConfig = {}): AutoInstrumentConfig {
  const source = config && typeof config === "object" ? config : {};
  const normalizeFlag = (
    value: unknown,
    fallback: boolean,
  ): boolean => typeof value === "boolean" ? value : fallback;

  return {
    instrumentHttp: normalizeFlag(source.instrumentHttp, DEFAULT_CONFIG.instrumentHttp),
    instrumentFetch: normalizeFlag(source.instrumentFetch, DEFAULT_CONFIG.instrumentFetch),
    instrumentReact: normalizeFlag(source.instrumentReact, DEFAULT_CONFIG.instrumentReact),
    captureErrors: normalizeFlag(source.captureErrors, DEFAULT_CONFIG.captureErrors),
    ...(source.tracing && typeof source.tracing === "object"
      ? { tracing: { ...source.tracing } }
      : {}),
    ...(source.metrics && typeof source.metrics === "object"
      ? { metrics: { ...source.metrics } }
      : {}),
  };
}
