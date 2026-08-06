/****
 * Response Builder Types
 * Type definitions for response construction
 */

export type { CORSConfig, SyncCORSConfig } from "../cors/index.ts";

import type { SecurityConfig } from "#veryfront/types";
export type { SecurityConfig } from "#veryfront/types";

export type CacheStrategy =
  | "no-cache"
  | "no-store"
  | "short"
  | "medium"
  | "long"
  | "immutable"
  | "none"
  | {
    maxAge: number;
    public?: boolean;
    immutable?: boolean;
    mustRevalidate?: boolean;
    staleWhileRevalidate?: number;
  };

export interface ResponseBuilderConfig {
  securityConfig?: SecurityConfig | null;
  isDev?: boolean;
  adapter?: import("#veryfront/platform/adapters/base.ts").RuntimeAdapter;
  nonce?: string; // Optional pre-generated nonce for CSP consistency
  /** Select the explicit hosted-Studio `frame-ancestors` allowlist. */
  isVeryfrontDomain?: boolean;
}
