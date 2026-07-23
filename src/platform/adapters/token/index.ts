/**
 * Adapters - Token
 *
 * @module platform/adapters/token
 */

export {
  MemoryTokenAdapter,
  TOKEN_STORAGE_ERROR,
  type TokenStorageAdapter,
  type TokenStorageAdapterConfig,
  TokenStorageApiClient,
  type TokenStorageApiClientDependencies,
  type TokenStorageRequestOptions,
  VeryfrontTokenAdapter,
  type VeryfrontTokenConfig,
} from "./veryfront/index.ts";
export { createTokenStorageAdapter } from "./factory.ts";
export {
  getTokenStorageAdapter,
  getTokenStorageType,
  isTokenStorageConfigured,
  resetTokenStorageAdapter,
} from "./integration.ts";
