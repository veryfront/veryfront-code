export interface ProjectIsolationConfig {
    maxConcurrentPerProject: number;
    circuitBreakerThreshold: number;
    circuitResetTimeMs: number;
    failureWindowMs: number;
}
export interface IsolationCheckResult {
    allowed: boolean;
    reason?: "circuit_open" | "max_concurrent";
    waitTimeMs?: number;
}
export declare class ProjectIsolationManager {
    private projects;
    private config;
    private cleanupInterval;
    constructor(config?: Partial<ProjectIsolationConfig>);
    private startCleanup;
    private getOrCreateState;
    checkRequest(projectSlug: string | undefined): IsolationCheckResult;
    startRequest(projectSlug: string | undefined): void;
    completeRequest(projectSlug: string | undefined, timedOut: boolean): void;
    getStats(): Record<string, {
        inFlight: number;
        recentFailures: number;
        circuitOpen: boolean;
        totalRequests: number;
        totalTimeouts: number;
    }>;
    shutdown(): void;
}
export declare const projectIsolation: ProjectIsolationManager;
//# sourceMappingURL=project-isolation.d.ts.map