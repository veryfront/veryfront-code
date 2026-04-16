/**
 * Contract interface for authentication token providers.
 *
 * Default implementation: `@veryfront/ext-jwt`
 *
 * @module extensions/interfaces/auth-provider
 */

/** Payload data stored within a signed token. */
export interface TokenPayload {
  /** Subject identifier (typically a user ID). */
  sub: string;
  /** Expiration time as a Unix timestamp (seconds). */
  exp?: number;
  /** Issued-at time as a Unix timestamp (seconds). */
  iat?: number;
  /** Additional claims. */
  [key: string]: unknown;
}

/** Options for signing a token. */
export interface SignOptions {
  /** Token lifetime (e.g. `"1h"`, `"7d"`, or seconds as a number). */
  expiresIn?: string | number;
  /** Signing algorithm (e.g. `"HS256"`, `"RS256"`). */
  algorithm?: string;
  /** Additional implementation-specific options. */
  [key: string]: unknown;
}

/** Options for verifying a token. */
export interface VerifyOptions {
  /** Expected algorithms to accept. */
  algorithms?: string[];
  /** Additional implementation-specific options. */
  [key: string]: unknown;
}

/**
 * AuthProvider contract interface.
 *
 * Implementations sign, verify, and decode authentication tokens
 * (e.g. JWTs) for request authentication.
 */
export interface AuthProvider {
  /** Sign a payload into a token string. */
  sign(payload: TokenPayload, options?: SignOptions): Promise<string>;
  /** Verify a token and return its decoded payload. Throws on invalid tokens. */
  verify(token: string, options?: VerifyOptions): Promise<TokenPayload>;
  /** Decode a token without verifying its signature. */
  decode(token: string): TokenPayload | undefined;
}
