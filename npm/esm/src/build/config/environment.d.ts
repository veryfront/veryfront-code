export type Environment = "development" | "production" | "test";
export declare function getEnvironment(): Environment;
export declare function isDevelopment(): boolean;
export declare function isProduction(): boolean;
export declare function isTest(): boolean;
export interface BuildEnvironmentConfig {
    environment: Environment;
    isDevelopment: boolean;
    isProduction: boolean;
    isTest: boolean;
    cacheMaxEntries: number;
    cacheTTLMs: number;
    minify: boolean;
    sourcemaps: boolean | "inline";
    treeShaking: boolean;
    target: string[];
}
export declare function getBuildConfig(): BuildEnvironmentConfig;
export declare function getDefineEnv(): string;
//# sourceMappingURL=environment.d.ts.map