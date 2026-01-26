import type { ReactFeatures, ReactVersionInfo } from "./types.js";
export declare function getReactVersionInfo(): ReactVersionInfo;
export declare function getReactVersionInfoForProject(projectDir: string): Promise<ReactVersionInfo>;
export declare function clearProjectVersionCache(projectDir: string): void;
export declare function hasFeature(feature: keyof ReactFeatures): boolean;
export declare function __resetReactVersionCacheForTests(): void;
//# sourceMappingURL=version-cache.d.ts.map