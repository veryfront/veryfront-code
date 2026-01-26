import type { Counter, Histogram, Meter } from "@opentelemetry/api";
import type { MetricsConfig } from "../metrics/types.js";
export interface DataInstruments {
    dataFetchDuration: Histogram | null;
    dataFetchCounter: Counter | null;
    dataFetchErrorCounter: Counter | null;
}
export declare function createDataInstruments(meter: Meter, config: MetricsConfig): DataInstruments;
//# sourceMappingURL=data-instruments.d.ts.map