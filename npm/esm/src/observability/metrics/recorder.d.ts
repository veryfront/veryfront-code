import type { MetricsInstruments, RuntimeState } from "./types.js";
export declare class MetricsRecorder {
    private _instruments;
    private runtimeState;
    constructor(_instruments: MetricsInstruments, runtimeState: RuntimeState);
    /** Update instruments after late initialization */
    set instruments(instruments: MetricsInstruments);
    get instruments(): MetricsInstruments;
    recordHttpRequest(attributes?: Record<string, string>): void;
    recordHttpRequestComplete(durationMs: number, attributes?: Record<string, string>): void;
    recordCacheGet(hit: boolean, attributes?: Record<string, string>): void;
    recordCacheSet(attributes?: Record<string, string>): void;
    recordCacheInvalidate(count: number, attributes?: Record<string, string>): void;
    setCacheSize(size: number): void;
    recordRender(durationMs: number, attributes?: Record<string, string>): void;
    recordRenderError(attributes?: Record<string, string>): void;
    recordRSCRender(durationMs: number, attributes?: Record<string, string>): void;
    recordRSCStream(durationMs: number, attributes?: Record<string, string>): void;
    recordRSCRequest(type: "manifest" | "page" | "stream" | "action", attributes?: Record<string, string>): void;
    recordRSCError(attributes?: Record<string, string>): void;
    recordBuild(durationMs: number, attributes?: Record<string, string>): void;
    recordBundle(sizeKb: number, attributes?: Record<string, string>): void;
    recordDataFetch(durationMs: number, attributes?: Record<string, string>): void;
    recordDataFetchError(attributes?: Record<string, string>): void;
    recordCorsRejection(attributes?: Record<string, string>): void;
    recordSecurityHeaders(attributes?: Record<string, string>): void;
}
//# sourceMappingURL=recorder.d.ts.map