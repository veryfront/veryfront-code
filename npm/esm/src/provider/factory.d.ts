import type { Provider, ProvidersConfig } from "./types.js";
declare class ProviderRegistry {
    private providers;
    private config;
    private autoInitialized;
    private registerProvider;
    private autoInitializeFromEnv;
    initialize(config: ProvidersConfig): void;
    getProvider(name: string): Provider;
    getProviderFromModel(modelString: string): {
        provider: Provider;
        model: string;
    };
    getDefaultProvider(): Provider;
    hasProvider(name: string): boolean;
    getAvailableProviders(): string[];
    clear(): void;
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