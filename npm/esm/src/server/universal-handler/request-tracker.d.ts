/**
 * In-flight request tracker for debugging stuck requests.
 *
 * Tracks active requests and logs warnings when requests exceed thresholds.
 * Helps identify when the event loop is blocked or requests are hanging.
 */
import * as dntShim from "../../../_dnt.shims.js";
export interface TrackedRequest {
    requestId: string;
    projectSlug: string | undefined;
    path: string;
    method: string;
    startTime: number;
    env?: string;
    releaseId?: string;
    slowTimer?: ReturnType<typeof dntShim.setTimeout>;
}
declare class RequestTracker {
    private inFlight;
    private statusInterval;
    private totalRequests;
    private totalCompleted;
    private totalTimedOut;
    constructor();
    private startStatusLogging;
    start(requestId: string, projectSlug: string | undefined, path: string, method: string, env?: string, releaseId?: string): void;
    complete(requestId: string, statusCode: number, timedOut?: boolean): void;
    getInFlightCount(): number;
    getInFlightRequests(): TrackedRequest[];
    getStats(): {
        inFlight: number;
        total: number;
        completed: number;
        timedOut: number;
    };
    waitForDrain(timeoutMs: number, pollIntervalMs?: number): Promise<boolean>;
    shutdown(): void;
}
export declare const requestTracker: RequestTracker;
export {};
//# sourceMappingURL=request-tracker.d.ts.map