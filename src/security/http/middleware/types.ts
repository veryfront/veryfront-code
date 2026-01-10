/**
 * Security middleware types
 *
 * Type definitions for security configuration used across middleware components.
 *
 * @module security/http/middleware/types
 */

/**
 * CORS Configuration Interface
 *
 * Defines CORS (Cross-Origin Resource Sharing) settings for cross-origin requests.
 */
export interface CORSConfig {
  /** Allowed origin(s) - can be string, array, or function */
  origin?: string | string[] | ((origin: string) => boolean | string);
  /** Allow credentials (cookies, authorization headers) */
  credentials?: boolean;
  /** Allowed HTTP headers */
  allowedHeaders?: string[];
  /** Exposed HTTP headers */
  exposedHeaders?: string[];
  /** Allowed HTTP methods */
  methods?: string[];
  /** Preflight cache duration in seconds */
  maxAge?: number;
}

/**
 * CSP Directives
 *
 * Content Security Policy directives as key-value pairs.
 * Keys are directive names, values can be strings or arrays.
 */
export type CSPDirectives = Partial<Record<string, string | string[]>>;

/**
 * Basic Authentication Configuration
 */
export interface BasicAuthConfig {
  /** Username for basic auth */
  username: string;
  /** Password for basic auth */
  password: string;
  /** Realm for WWW-Authenticate header */
  realm?: string;
}

/**
 * Bearer Authentication Configuration
 */
export interface BearerAuthConfig {
  /** Token to validate against */
  token: string;
}

/**
 * Authentication Configuration
 *
 * Configures authentication for the application.
 * Use either basic or bearer auth, not both.
 */
export interface AuthConfig {
  /** Basic authentication (username/password) */
  basic?: BasicAuthConfig;
  /** Bearer token authentication */
  bearer?: BearerAuthConfig;
}

/**
 * Security Configuration Interface
 *
 * Complete security configuration including CORS, CSP, and other security headers.
 */
export interface SecurityConfig {
  /** Authentication configuration - replaces env vars for clean test isolation */
  auth?: AuthConfig;
  /** CORS configuration - boolean for default CORS or detailed config object */
  cors?: boolean | CORSConfig;
  /** Content Security Policy directives */
  csp?: CSPDirectives;
  /** Cross-Origin-Opener-Policy header value */
  coop?: "same-origin" | "same-origin-allow-popups" | "unsafe-none";
  /** Cross-Origin-Resource-Policy header value */
  corp?: "same-origin" | "same-site" | "cross-origin";
  /** Cross-Origin-Embedder-Policy header value */
  coep?: "require-corp" | "unsafe-none";
  /** Allowed remote hosts for fetch operations */
  remoteHosts?: string[];
  /** Additional custom headers */
  headers?: Record<string, string>;
  /** Index signature for extensibility */
  [key: string]: unknown;
}
