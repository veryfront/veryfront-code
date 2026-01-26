import type { Meter } from "@opentelemetry/api";
import type { MetricsConfig, MetricsInstruments, RuntimeState } from "../metrics/types.js";
export declare function initializeInstruments(meter: Meter, config: MetricsConfig, runtimeState: RuntimeState): Promise<MetricsInstruments>;
//# sourceMappingURL=instruments-factory.d.ts.map