import type { Counter, Histogram, Meter } from "@opentelemetry/api";
import type { MetricsConfig } from "../metrics/types.js";
export interface RscInstruments {
    rscRenderDuration: Histogram | null;
    rscStreamDuration: Histogram | null;
    rscManifestCounter: Counter | null;
    rscPageCounter: Counter | null;
    rscStreamCounter: Counter | null;
    rscActionCounter: Counter | null;
    rscErrorCounter: Counter | null;
}
export declare function createRscInstruments(meter: Meter, config: MetricsConfig): RscInstruments;
//# sourceMappingURL=rsc-instruments.d.ts.map