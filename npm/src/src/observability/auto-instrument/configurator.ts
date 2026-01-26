import type { AutoInstrumentConfig } from "./types.js";

export const DEFAULT_CONFIG: AutoInstrumentConfig = {
  instrumentHttp: true,
  instrumentFetch: true,
  instrumentReact: true,
  captureErrors: true,
};

export function mergeConfig(config: AutoInstrumentConfig = {}): AutoInstrumentConfig {
  return { ...DEFAULT_CONFIG, ...config };
}
