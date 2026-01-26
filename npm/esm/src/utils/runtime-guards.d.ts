export interface GlobalWithDeno {
    Deno?: {
        env: {
            get(key: string): string | undefined;
        };
    };
}
export interface GlobalWithProcess {
    process?: {
        env: Record<string, string | undefined>;
        version?: string;
        versions?: Record<string, string>;
    };
}
export interface GlobalWithBun {
    Bun?: {
        version: string;
    };
}
export declare function hasDenoRuntime(global: unknown): global is GlobalWithDeno;
export declare function hasNodeProcess(global: unknown): global is GlobalWithProcess;
export declare function hasBunRuntime(global: unknown): global is GlobalWithBun;
//# sourceMappingURL=runtime-guards.d.ts.map