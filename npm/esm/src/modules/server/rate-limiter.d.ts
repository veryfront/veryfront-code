export declare class RateLimiter {
    private readonly maxMessages;
    private readonly messageCounts;
    private readonly windowMs;
    constructor(maxMessages: number);
    check(socket: WebSocket): boolean;
    cleanup(socket: WebSocket): void;
}
//# sourceMappingURL=rate-limiter.d.ts.map