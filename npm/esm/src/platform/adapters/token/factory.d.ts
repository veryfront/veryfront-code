/**
 * Token Storage Adapter Factory
 *
 * Creates the appropriate token storage adapter based on configuration.
 * For auto-detection from environment variables, use getTokenStorageAdapter()
 * from token/integration.ts instead.
 */
import type { TokenStorageAdapter, TokenStorageAdapterConfig } from "./veryfront/types.js";
export declare function createTokenStorageAdapter(config: TokenStorageAdapterConfig): Promise<TokenStorageAdapter>;
//# sourceMappingURL=factory.d.ts.map