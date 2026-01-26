export declare class Semaphore {
    private permits;
    private waitQueue;
    constructor(permits: number);
    tryAcquire(timeoutMs?: number): Promise<boolean>;
    release(): void;
    get available(): number;
    get waiting(): number;
}
//# sourceMappingURL=semaphore.d.ts.map