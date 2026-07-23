import { flushDirectMetricsForTests, resetDirectMetricsForTests } from "./direct-exporter.ts";
import { resetMetricInstrumentDefinitionsForTests } from "./instrument-definitions.ts";
import { resetSdkMetricInstrumentsForTests } from "./instrument-registry.ts";

export async function flushMetricsForTests(): Promise<void> {
  await flushDirectMetricsForTests();
}

export function resetMetricsForTests(): void {
  resetDirectMetricsForTests();
  resetMetricInstrumentDefinitionsForTests();
  resetSdkMetricInstrumentsForTests();
}
