import type { RuntimeAdapter } from "../base.js";
import type { FSAdapter, FSAdapterConfig } from "./veryfront/types.js";
/**
 * Minimal config interface for FS integration.
 * Defined locally to keep adapters module isolated from core/config.
 */
interface FSIntegrationConfig {
    fs?: FSAdapterConfig;
}
export declare function enhanceAdapterWithFS(adapter: RuntimeAdapter, config: FSIntegrationConfig, projectDir?: string): Promise<RuntimeAdapter>;
export declare function createFSAdapterFromConfig(config: FSIntegrationConfig): Promise<FSAdapter | null>;
export declare function isFSAdapterConfigured(config: FSIntegrationConfig): boolean;
export declare function getFSAdapterType(config: FSIntegrationConfig): string;
export {};
//# sourceMappingURL=integration.d.ts.map