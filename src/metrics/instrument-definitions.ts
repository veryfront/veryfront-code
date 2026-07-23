import type { MetricInstrumentOptions } from "./index.ts";

export type MetricInstrumentKind = "counter" | "histogram" | "gauge";

const MAX_INSTRUMENTS_PER_KIND = 1_000;
const definitions: Record<MetricInstrumentKind, Set<string>> = {
  counter: new Set(),
  histogram: new Set(),
  gauge: new Set(),
};

export function instrumentIdentityKey(
  kind: MetricInstrumentKind,
  name: string,
  options: MetricInstrumentOptions,
): string {
  return JSON.stringify([
    kind,
    name.toLowerCase(),
    options.description ?? null,
    options.unit ?? null,
  ]);
}

export function registerMetricInstrument(
  kind: MetricInstrumentKind,
  name: string,
  options: MetricInstrumentOptions,
): void {
  const key = instrumentIdentityKey(kind, name, options);
  const kindDefinitions = definitions[kind];
  if (kindDefinitions.has(key)) return;
  if (kindDefinitions.size >= MAX_INSTRUMENTS_PER_KIND) {
    throw new RangeError(
      `Cannot create more than ${MAX_INSTRUMENTS_PER_KIND} ${kind} instruments in one process`,
    );
  }
  kindDefinitions.add(key);
}

export function resetMetricInstrumentDefinitionsForTests(): void {
  definitions.counter.clear();
  definitions.histogram.clear();
  definitions.gauge.clear();
}
