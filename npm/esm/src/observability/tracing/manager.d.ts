import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { TracingConfig, TracingState } from "./types.js";
import { SpanOperations } from "./span-operations.js";
import { ContextPropagation } from "./context-propagation.js";
/**
 * Tracing manager class
 * Exported for testing - use tracingManager singleton for production
 */
export declare class TracingManager {
    private state;
    private spanOps;
    private contextProp;
    initialize(config?: Partial<TracingConfig>, adapter?: RuntimeAdapter): Promise<void>;
    private initializeTracer;
    isEnabled(): boolean;
    isDegraded(): boolean;
    getSpanOperations(): SpanOperations | null;
    getContextPropagation(): ContextPropagation | null;
    getState(): TracingState;
    shutdown(): void;
}
export declare const tracingManager: TracingManager;
//# sourceMappingURL=manager.d.ts.map