export interface DevOptions {
    port: number;
    projectDir: string;
    hmr?: boolean;
    /** Demo mode: don't exit process on shutdown, resolve done promise instead */
    demoMode?: boolean;
}
export type DevCommandOptions = DevOptions;
export interface DevCommandResult {
    ready: Promise<void>;
    done: Promise<void>;
    /** Stop the dev server programmatically (for demo mode) */
    stop: () => Promise<void>;
}
export declare function devCommand(options: DevOptions): Promise<DevCommandResult>;
//# sourceMappingURL=dev.d.ts.map