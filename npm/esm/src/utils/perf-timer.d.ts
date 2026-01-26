/**
 * Performance Timer Utility
 *
 * Collects timing data for performance analysis.
 * Enable with VERYFRONT_PERF=1 environment variable.
 */
export declare function startRequest(requestId: string): void;
export declare function startTimer(label: string, parent?: string): () => void;
export declare function timeAsync<T>(label: string, fn: () => Promise<T>, parent?: string): Promise<T>;
export declare function endRequest(requestId: string): void;
export declare function isEnabled(): boolean;
//# sourceMappingURL=perf-timer.d.ts.map