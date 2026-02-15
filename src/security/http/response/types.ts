/****
 * Response Builder Types
 * Type definitions for response construction
 */

export type { CORSConfig } from "../cors/index.ts";

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
  };

export interface ResponseBuilderConfig {
  securityConfig?: SecurityConfig | null;
  isDev?: boolean;
  cspUserHeader?: string | null;
  adapter?: import("#veryfront/platform/adapters/base.ts").RuntimeAdapter;
  nonce?: string; // Optional pre-generated nonce for CSP consistency
  isVeryfrontDomain?: boolean; // When true, skips X-Frame-Options to allow iframe embedding
}
