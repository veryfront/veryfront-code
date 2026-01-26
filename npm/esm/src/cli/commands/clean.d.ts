interface CleanOptions {
    projectDir: string;
    cache?: boolean;
    build?: boolean;
    all?: boolean;
    force?: boolean;
}
export declare function cleanCommand(options: CleanOptions): Promise<void>;
export {};
//# sourceMappingURL=clean.d.ts.map