export interface SandboxOptions {
    timeoutMs?: number;
    memoryLimitMb?: number;
}
export declare function runInWorker<T = unknown>(code: string, options?: SandboxOptions): Promise<T>;
//# sourceMappingURL=deno-sandbox.d.ts.map