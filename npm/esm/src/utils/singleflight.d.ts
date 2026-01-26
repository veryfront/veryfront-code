export declare class Singleflight<T> {
    private inflight;
    do(key: string, operation: () => Promise<T>): Promise<T>;
    has(key: string): boolean;
    get size(): number;
}
//# sourceMappingURL=singleflight.d.ts.map