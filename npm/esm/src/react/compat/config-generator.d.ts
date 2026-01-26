export type ReactVersion = "17" | "18" | "19";
export interface ReactVersionConfig {
    version: ReactVersion;
    exact: string;
    imports: Record<string, string>;
}
export interface ReactVersionSwitcher {
    switchTo(version: ReactVersion): Promise<void>;
    getCurrentVersion(): Promise<ReactVersion | null>;
    getAvailableVersions(): ReactVersion[];
}
export declare const REACT_CONFIGS: Record<ReactVersion, ReactVersionConfig>;
export declare function generateReactVersionConfig(projectDir: string, targetVersion: ReactVersion, options?: {
    extends?: string;
    additional?: Record<string, unknown>;
}): Promise<void>;
export declare function generateAllReactConfigs(projectDir: string): Promise<void>;
export declare function getReactImports(version: ReactVersion): Record<string, string>;
export declare function detectReactVersionFromConfig(projectDir: string): Promise<ReactVersion | null>;
export declare function createReactVersionSwitcher(projectDir: string): ReactVersionSwitcher;
//# sourceMappingURL=config-generator.d.ts.map