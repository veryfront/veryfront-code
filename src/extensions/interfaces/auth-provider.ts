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
 * The parsed, unverified header of a JWT.
 *
 * Returned by {@link AuthProvider.decode}. `alg` is the signing algorithm
 * advertised by the token (e.g. `"HS256"`, `"RS256"`); additional fields
 * such as `kid` or `typ` may be present.
 */
export interface TokenHeader {
  /** Signing algorithm advertised by the token header. */
  alg?: string;
  /** Additional header fields. */
  [key: string]: unknown;
}

/**
 * AuthProvider contract interface.
 *
 * Implementations sign, verify, and decode authentication tokens
 * (e.g. JWTs) for request authentication, and verify third-party tokens
 * against a remote JWKS.
 */
export interface AuthProvider {
  /** Sign a payload into a token string. */
  sign(payload: TokenPayload, options?: SignOptions): Promise<string>;
  /** Verify a token and return its decoded payload. Throws on invalid tokens. */
  verify(token: string, options?: VerifyOptions): Promise<TokenPayload>;
  /**
   * Verify a token against a remote JSON Web Key Set.
   *
   * Fetches (and caches) the JWKS at `jwksUrl`, then verifies the token's
   * signature and claims. Throws on invalid tokens, unreachable JWKS, or
   * `kid`/algorithm mismatch.
   */
  verifyWithJwks(
    token: string,
    jwksUrl: string,
    options?: VerifyOptions,
  ): Promise<TokenPayload>;
  /**
   * Decode a token's protected header without verifying its signature.
   *
   * Returns `undefined` on malformed input. Useful for inspecting `alg`
   * before choosing a verification strategy.
   */
  decode(token: string): TokenHeader | undefined;
}
