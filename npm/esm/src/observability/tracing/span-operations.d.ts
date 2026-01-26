import type { OpenTelemetryAPI, Span, SpanOptions, Tracer } from "./types.js";
export declare class SpanOperations {
    private api;
    private tracer;
    constructor(api: OpenTelemetryAPI, tracer: Tracer);
    startSpan(name: string, options?: SpanOptions): Span | null;
    endSpan(span: Span | null, error?: Error): void;
    setAttributes(span: Span | null, attributes: Record<string, string | number | boolean>): void;
    addEvent(span: Span | null, name: string, attributes?: Record<string, string | number | boolean>): void;
    createChildSpan(parentSpan: Span | null, name: string, options?: SpanOptions): Span | null;
    private mapSpanKind;
}
//# sourceMappingURL=span-operations.d.ts.map