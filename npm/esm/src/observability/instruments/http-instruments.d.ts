import type { Counter, Histogram, Meter, UpDownCounter } from "@opentelemetry/api";
import type { MetricsConfig } from "../metrics/types.js";
export interface HttpInstruments {
    httpRequestCounter: Counter | null;
    httpRequestDuration: Histogram | null;
    httpActiveRequests: UpDownCounter | null;
}
export declare function createHttpInstruments(meter: Meter, config: MetricsConfig): HttpInstruments;
//# sourceMappingURL=http-instruments.d.ts.map