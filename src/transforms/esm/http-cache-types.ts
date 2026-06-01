/**
 * Branded types for HTTP bundle cache code.
 *
 * These types enforce compile-time safety for cache path handling:
 * - LocalModuleCode: Has local file:// paths, ready to execute
 * - PortableModuleCode: Has __VF_CACHE_DIR__ tokens, safe for Redis
 *
 * The type system prevents accidental mixing of tokenized/detokenized code.
 *
 * @module transforms/esm/http-cache-types
 */

import type { Brand } from "#veryfront/types/branded.ts";

/**
 * Module code with absolute local file:// paths.
 * Ready to be written to disk and executed.
 * NEVER store in distributed cache.
 */
export type LocalModuleCode = Brand<string, "LocalModuleCode">;

/**
 * Module code with portable __VF_CACHE_DIR__ tokens.
 * Safe to store in distributed cache.
 * NEVER execute directly - must detokenize first.
 */
export type PortableModuleCode = Brand<string, "PortableModuleCode">;

/**
 * Raw module code from network fetch or local disk read.
 * Has not been validated for tokenization state.
 * Must be explicitly converted to Local or Portable.
 */
type RawModuleCode = string;

/**
 * Hash identifier for a cached bundle (e.g., "974671618").
 */
export type BundleHash = Brand<string, "BundleHash">;

/**
 * Normalized URL used as cache key (e.g., "https://esm.sh/react@18.3.1?target=es2022").
 */
export type NormalizedUrl = Brand<string, "NormalizedUrl">;

/**
 * Apply a branded-type marker to a raw value.
 *
 * Centralizes the (otherwise unsafe) widening cast used to attach a
 * compile-time brand. Use this instead of scattering `as unknown as Branded`
 * across the codebase so the single point of unsoundness is auditable.
 *
 * The brand string is inferred from the requested branded type, so callers
 * write `brand<PortableModuleCode>(str)` and get full checking on the base.
 *
 * @param value - The underlying (unbranded) value
 * @returns The same value, typed as the requested branded type
 */
export function brand<TBranded extends Brand<string, string>>(
  value: string,
): TBranded {
  // Single, centralized unsound widening: attaching a phantom brand to a
  // runtime value. This is the only place this cast should occur.
  return value as unknown as TBranded;
}

/**
 * Strip the branded-type marker from a value, recovering the underlying type.
 *
 * Fully type-safe: it only forgets the brand. Accepts the raw underlying type
 * as well so callers can pass `Branded | Raw` unions (e.g. `BundleHash | string`).
 *
 * @param value - The branded (or already-raw) value
 * @returns The value typed as its underlying (unbranded) type
 */
export function unbrand<TBase>(value: Brand<TBase, string> | TBase): TBase {
  return value as TBase;
}

/**
 * Result of attempting to decode potentially gzip-compressed code.
 */
export interface DecodeResult {
  /** The decoded (or original) code */
  code: string;
  /** Whether gzip decompression was performed */
  wasGzipped: boolean;
  /** Whether decoding failed (code may still be gzip-prefixed) */
  decodeFailed: boolean;
}

/**
 * Bundle dependency reference extracted from code.
 */
interface BundleDep {
  /** Original path string from the import (may be absolute or relative) */
  path: string;
  /** Numeric hash extracted from the filename */
  hash: string;
}
