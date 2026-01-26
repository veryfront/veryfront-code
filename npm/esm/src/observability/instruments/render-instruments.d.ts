import type { Counter, Histogram, Meter } from "@opentelemetry/api";
import type { MetricsConfig } from "../metrics/types.js";
export interface RenderInstruments {
    renderDuration: Histogram | null;
    renderCounter: Counter | null;
    renderErrorCounter: Counter | null;
}
export declare function createRenderInstruments(meter: Meter, config: MetricsConfig): RenderInstruments;
//# sourceMappingURL=render-instruments.d.ts.map