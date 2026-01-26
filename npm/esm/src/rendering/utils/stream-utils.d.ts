export declare class TimeoutError extends Error {
    constructor(label: string, timeoutMs: number);
}
export declare function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T | undefined>;
export declare function withTimeoutThrow<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T>;
export declare class StreamTimeoutError extends Error {
    readonly partialContent: string;
    constructor(timeoutMs: number, partialContent: string);
}
export declare function streamToString(stream: ReadableStream, timeoutMs?: number): Promise<string>;
//# sourceMappingURL=stream-utils.d.ts.map