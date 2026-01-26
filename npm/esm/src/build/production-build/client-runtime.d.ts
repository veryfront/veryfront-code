import type { RuntimeAdapter } from "../../platform/adapters/base.js";
/**
 * Generate app.js module
 */
export declare function generateAppModule(): string;
/**
 * Generate client.js module for hydration
 * Uses pre-bundled version for npm builds, or bundles from source for Deno
 */
export declare function generateClientModule(): Promise<string>;
/**
 * Load and transform router script from source
 * Uses pre-bundled version for npm builds, or bundles from source for Deno
 */
export declare function generateRouterScript(_adapter: RuntimeAdapter): Promise<string>;
/**
 * Generate prefetch script
 * Uses pre-bundled version for npm builds, or bundles from source for Deno
 */
export declare function generatePrefetchScript(_adapter: RuntimeAdapter): Promise<string>;
/**
 * Generate import map for React dependencies
 *
 * Uses centralized React version configuration from cdn.ts
 */
export declare function generateImportMap(): Promise<string>;
//# sourceMappingURL=client-runtime.d.ts.map