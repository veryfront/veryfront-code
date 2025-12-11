
import type { CORSConfig } from "../cors/index.ts";
export type { CORSConfig };

export interface HSTSConfig {
  maxAge: number;
  includeSubDomains?: boolean;
  preload?: boolean;
}

export interface SecurityConfig {
  cors?: boolean | CORSConfig;
  csp?: Partial<Record<string, string | string[]>>;
  coop?: "same-origin" | "same-origin-allow-popups" | "unsafe-none";
  corp?: "same-origin" | "same-site" | "cross-origin";
  coep?: "require-corp" | "unsafe-none";
  hsts?: HSTSConfig;
  headers?: Record<string, string>;
  remoteHosts?: string[];
  [key: string]: unknown;
}

export type CacheStrategy =
  | "no-cache"
  | "no-store"
  | "short"
  | "medium"
  | "long"
  | "immutable"
  | "none"
  | { maxAge: number; public?: boolean; immutable?: boolean; mustRevalidate?: boolean };

export interface ResponseBuilderConfig {
  securityConfig?: SecurityConfig | null;
  isDev?: boolean;
  cspUserHeader?: string | null;
  adapter?: import("@veryfront/platform/adapters/base.ts").RuntimeAdapter;
  nonce?: string;
}
