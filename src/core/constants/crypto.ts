/**
 * Cryptographic algorithm and hash constants
 *
 * These constants define algorithm identifiers and related
 * cryptographic configuration values.
 */

/** SHA-256 algorithm identifier */
export const HASH_ALGORITHM_SHA256 = "SHA-256";

/** SHA-1 algorithm identifier (legacy, avoid for security) */
export const HASH_ALGORITHM_SHA1 = "SHA-1";

/** MD5 algorithm identifier (legacy, avoid for security) */
export const HASH_ALGORITHM_MD5 = "MD5";

/** Expected length of SHA-256 hex string (64 characters) */
export const SHA256_HEX_LENGTH = 64;

/** Expected length of SHA-1 hex string (40 characters) */
export const SHA1_HEX_LENGTH = 40;

/** Expected length of MD5 hex string (32 characters) */
export const MD5_HEX_LENGTH = 32;

/**
 * FNV-1a hash prime multiplier (32-bit)
 */
export const FNV1A_PRIME_32 = 16777619;

/**
 * Nonce length for CSP (Content Security Policy)
 * Typical length is 16-32 bytes (128-256 bits)
 */
export const CSP_NONCE_LENGTH_BYTES = 16;
