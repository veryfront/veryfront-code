export declare class SemaphoreTimeoutError extends Error {
    constructor(name: string, timeoutMs: number);
}
export declare class Semaphore {
    private permits;
    private readonly maxPermits;
    private readonly waiting;
    private readonly acquireTimeoutMs;
    private readonly semaphoreName;
    constructor(maxPermits: number, options?: {
        acquireTimeoutMs?: number;
        name?: string;
    });
    /** Acquire permit, execute operation, release automatically */
    acquire<T>(operation: () => Promise<T>): Promise<T>;
    private waitForPermit;
    private release;
    get active(): number;
    get waitingCount(): number;
}
export declare function getSemaphore(name: string, maxPermits: number, options?: {
    acquireTimeoutMs?: number;
}): Semaphore;
//# sourceMappingURL=semaphore.d.ts.map