/**
 * Provider Registry
 *
 * Project-scoped registry for AI providers. Each project can have its own
 * provider configuration with different API keys.
 *
 * @module
 */
import type { Provider, ProvidersConfig } from "./types.js";
declare class ProviderRegistry {
    private registerProvider;
    private registerProviderShared;
    private autoInitializeFromEnv;
    initialize(config: ProvidersConfig): void;
    /**
     * Initialize shared providers from environment variables.
     * These will be available to all projects as fallback.
     */
    initializeSharedFromEnv(): void;
    getProvider(name: string): Provider;
    getProviderFromModel(modelString: string): {
        provider: Provider;
        model: string;
    };
    getDefaultProvider(): Provider;
    hasProvider(name: string): boolean;
    getAvailableProviders(): string[];
    clear(): void;
    /**
     * Clear everything (for testing).
     */
    clearAll(): void;
    getStats(): {
        projectCount: number;
        sharedCount: number;
        totalItems: number;
        currentProjectItems: number;
    };
}
export declare const providerRegistry: ProviderRegistry;
export declare function initializeProviders(config: ProvidersConfig): void;
export declare function getProvider(name: string): Provider;
export declare function getProviderFromModel(modelString: string): {
    provider: Provider;
    model: string;
};
export {};
//# sourceMappingURL=factory.d.ts.map