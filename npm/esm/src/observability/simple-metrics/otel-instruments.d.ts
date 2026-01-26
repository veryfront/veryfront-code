/**
 * OpenTelemetry instrumentation for metrics
 * @module
 */
import type { OtelInstruments } from "./types.js";
export declare function safeLogWarn(message: string, error?: unknown): void;
export declare function ensureOtelInstruments(): Promise<void>;
export declare function safeOtelOperation(operation: () => void | Promise<void>, errorContext: string): Promise<void>;
export declare function getOtelInstruments(): OtelInstruments;
export declare function resetOtelInstruments(): void;
//# sourceMappingURL=otel-instruments.d.ts.map