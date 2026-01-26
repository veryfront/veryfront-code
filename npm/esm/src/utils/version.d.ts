export declare const VERSION: string;
export declare const SERVER_START_TIME: number;
export interface BuildVersion {
    framework: string;
    serverStart: number;
    projectUpdated?: string;
}
export declare function createBuildVersion(projectUpdatedAt?: string): BuildVersion;
//# sourceMappingURL=version.d.ts.map