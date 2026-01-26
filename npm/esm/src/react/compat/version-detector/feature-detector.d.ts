import type { ReactFeatures, ReactVersionInfo } from "./types.js";
export declare function detectFeatures(major: number, minor: number, isReact19Flag: boolean): ReactFeatures;
export declare function detectReactVersion(): ReactVersionInfo;
export declare function detectReactVersionFromProject(projectDir: string): Promise<ReactVersionInfo>;
//# sourceMappingURL=feature-detector.d.ts.map