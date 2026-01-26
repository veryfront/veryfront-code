import type { Meter, ObservableGauge } from "@opentelemetry/api";
import type { MetricsConfig } from "../metrics/types.js";
export interface MemoryInstruments {
    memoryUsageGauge: ObservableGauge | null;
    heapUsageGauge: ObservableGauge | null;
    heapTotalGauge: ObservableGauge | null;
    heapPercentGauge: ObservableGauge | null;
}
export declare function createMemoryInstruments(meter: Meter, config: MetricsConfig): MemoryInstruments;
//# sourceMappingURL=memory-instruments.d.ts.map