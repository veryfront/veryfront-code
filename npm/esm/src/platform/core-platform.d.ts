export type Platform = "deno" | "node" | "bun" | "cloudflare-workers" | "unknown";
export interface PlatformCapabilities {
    canRunMCPServer: boolean;
    maxAgentSteps: number;
    cpuTimeLimit: number | null;
    memoryLimit: number | null;
    hasFileSystem: boolean;
    supportsLongRunning: boolean;
    streamingRecommended: boolean;
    displayName: string;
}
export declare function detectPlatform(): Platform;
export declare function getPlatformCapabilities(platform?: Platform): PlatformCapabilities;
export declare function supportsCapability(capability: keyof PlatformCapabilities): boolean;
export declare function getPlatformWarnings(): string[];
export interface CompatibilityConfig {
    maxSteps?: number;
    streaming?: boolean;
    requiresFileSystem?: boolean;
    requiresMCP?: boolean;
}
export declare function validatePlatformCompatibility(config: CompatibilityConfig, platform?: Platform): {
    compatible: boolean;
    errors: string[];
    warnings: string[];
};
//# sourceMappingURL=core-platform.d.ts.map