/**
 * Token Storage Adapter
 *
 * Provides pluggable storage backends for OAuth tokens.
 *
 * @example Using with Veryfront Cloud
 * ```typescript
 * import { createTokenStorageAdapter } from "veryfront/platform";
 *
 * const adapter = await createTokenStorageAdapter({
 *   type: "veryfront-api",
 *   veryfront: {
 *     apiToken: process.env.VERYFRONT_API_TOKEN,
 *     projectSlug: "my-project",
 *   },
 * });
 *
 * // Store encrypted token
 * await adapter.set("user123:gmail", encryptedTokenBlob);
 *
 * // Retrieve token
 * const token = await adapter.get("user123:gmail");
 * ```
 *
 * @example Using in-memory (development)
 * ```typescript
 * const adapter = await createTokenStorageAdapter({
 *   type: "memory",
 * });
 * ```
 */

export { VeryfrontTokenAdapter } from "./adapter.ts";
export { MemoryTokenAdapter } from "./memory-adapter.ts";
export { TokenStorageAPIClient } from "./api-client.ts";
export {
  createTokenConfig,
  type TokenStorageAdapter,
  type TokenStorageAdapterConfig,
  TokenStorageError,
  type VeryfrontTokenConfig,
} from "./types.ts";
