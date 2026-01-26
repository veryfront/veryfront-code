import * as dntShim from "../../../_dnt.shims.js";
import type { Context, OpenTelemetryAPI, Span, TextMapPropagator } from "./types.js";
export declare class ContextPropagation {
    private api;
    private propagator;
    constructor(api: OpenTelemetryAPI, propagator: TextMapPropagator);
    extractContext(headers: dntShim.Headers): Context | undefined;
    injectContext(context: Context, headers: dntShim.Headers): void;
    getActiveContext(): Context | undefined;
    withActiveSpan<T>(span: Span | null, fn: () => Promise<T>): Promise<T>;
    withSpan<T>(name: string, fn: (span: Span | null) => T, startSpan: (name: string) => Span | null, endSpan: (span: Span | null, error?: Error) => void): T;
    withSpanAsync<T>(name: string, fn: (span: Span | null) => Promise<T>, startSpan: (name: string) => Span | null, endSpan: (span: Span | null, error?: Error) => void): Promise<T>;
}
//# sourceMappingURL=context-propagation.d.ts.map