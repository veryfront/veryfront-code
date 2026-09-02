import { FNV1A_PRIME_32 } from "./constants/crypto.ts";
import { HASH_SEED_FNV1A } from "./constants/hash.ts";

/** Number of hex characters kept by shortHash (8 hex chars = 32 bits) */
const SHORT_HASH_LENGTH = 8;

/**
 * Maximum encoded identifier length kept losslessly by cacheNamespaceSegment.
 * 200 hex characters cover identifiers up to 100 UTF-8 bytes while keeping the
 * resulting path segment far below the 255-byte filename limit.
 */
const MAX_INLINE_NAMESPACE_SEGMENT_LENGTH = 200;

const FNV1A_OFFSET_BASIS_64 = 14695981039346656037n;
const FNV1A_PRIME_64 = 1099511628211n;
const FNV1A_MASK_64 = (1n << 64n) - 1n;

// Hashes participate in cache and request identities after project modules may
// have executed in the shared realm. Capture the small set of primordials used
// by that boundary before project code can replace their implementations.
const IntrinsicTextEncoder = TextEncoder;
const IntrinsicUint8Array = Uint8Array;
const NumberPrototypeToString = Number.prototype.toString;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ReflectApply = Reflect.apply;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypePadStart = String.prototype.padStart;
const SubtleCryptoDigest = crypto.subtle.digest;
const TextEncoderPrototypeEncode = TextEncoder.prototype.encode;
const cryptoSubtle = crypto.subtle;
const hashTextEncoder = new IntrinsicTextEncoder();
const TypedArrayPrototype = ObjectGetPrototypeOf(IntrinsicUint8Array.prototype);
const TypedArrayLengthGetter = ObjectGetOwnPropertyDescriptor(
  TypedArrayPrototype,
  "length",
)!.get!;

function typedArrayLength(value: Uint8Array): number {
  return ReflectApply(TypedArrayLengthGetter, value, []) as number;
}

function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  const length = typedArrayLength(bytes);
  for (let index = 0; index < length; index++) {
    const hex = ReflectApply(NumberPrototypeToString, bytes[index], [16]) as string;
    result += ReflectApply(StringPrototypePadStart, hex, [2, "0"]) as string;
  }
  return result;
}

function toHex(buffer: ArrayBuffer): string {
  return bytesToHex(new IntrinsicUint8Array(buffer));
}

/** Compute the lowercase hex SHA-256 digest of a UTF-8 string. */
export async function computeHash(content: string): Promise<string> {
  const data = ReflectApply(
    TextEncoderPrototypeEncode,
    hashTextEncoder,
    [content],
  ) as Uint8Array;
  return toHex(
    await ReflectApply(
      SubtleCryptoDigest,
      cryptoSubtle,
      ["SHA-256", data],
    ) as ArrayBuffer,
  );
}

/** Compute the lowercase hex SHA-256 digest of raw bytes. */
export async function computeHashBytes(bytes: BufferSource): Promise<string> {
  return toHex(
    await ReflectApply(
      SubtleCryptoDigest,
      cryptoSubtle,
      ["SHA-256", bytes],
    ) as ArrayBuffer,
  );
}
/** Source bundle content used for hash computation. */
export interface BundleCode {
  code: string;
  css?: string;
  sourceMap?: string;
}

function appendUtf16Field(bytes: Uint8Array, offset: number, value: string): number {
  const length = value.length;
  bytes[offset++] = length >>> 24;
  bytes[offset++] = length >>> 16;
  bytes[offset++] = length >>> 8;
  bytes[offset++] = length;

  for (let index = 0; index < length; index++) {
    const codeUnit = ReflectApply(StringPrototypeCharCodeAt, value, [index]) as number;
    bytes[offset++] = codeUnit >>> 8;
    bytes[offset++] = codeUnit;
  }
  return offset;
}

/** Compute a bundle hash from fixed-field raw UTF-16 code-unit framing. */
export function computeCodeHash(code: BundleCode): Promise<string> {
  const css = code.css ?? "";
  const sourceMap = code.sourceMap ?? "";
  const bytes = new IntrinsicUint8Array(
    12 + (code.code.length + css.length + sourceMap.length) * 2,
  );
  let offset = appendUtf16Field(bytes, 0, code.code);
  offset = appendUtf16Field(bytes, offset, css);
  appendUtf16Field(bytes, offset, sourceMap);
  return computeHashBytes(bytes);
}

/** Create simple hash. */
export function simpleHash(str: string): number {
  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash &= hash;
  }

  return Math.abs(hash);
}

/** Hash string to hex (base 16) - used for module filenames */
export function hashCodeHex(str: string): string {
  return simpleHash(str).toString(16);
}

/** Create short hash. */
export async function shortHash(content: string): Promise<string> {
  const fullHash = await computeHash(content);
  return fullHash.slice(0, SHORT_HASH_LENGTH);
}

function fnv1a64Base36(input: string): string {
  let hash = FNV1A_OFFSET_BASIS_64;

  for (let index = 0; index < input.length; index++) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * FNV1A_PRIME_64) & FNV1A_MASK_64;
  }

  return hash.toString(36);
}

/**
 * Filesystem-safe cache namespace segment for an identifier.
 *
 * These segments partition on-disk SSR caches by project and content source,
 * so two distinct identifiers must never share a segment: a collision lets one
 * content source serve another source's transformed modules for the same file
 * path. Identifiers of normal length are encoded losslessly (lowercase hex of
 * their UTF-8 bytes), which makes collisions impossible — including on
 * case-insensitive filesystems, where a case-sensitive encoding would fold
 * distinct segments back together. Oversized identifiers collapse to two
 * domain-separated 64-bit FNV-1a hashes so path segments stay bounded without
 * returning to the collision-prone 32-bit hashCodeHex digest used here
 * previously. The two forms carry disjoint prefixes so they can never collide
 * with each other.
 */
export function cacheNamespaceSegment(id: string): string {
  const bytes = ReflectApply(
    TextEncoderPrototypeEncode,
    hashTextEncoder,
    [id],
  ) as Uint8Array;
  const encoded = bytesToHex(bytes);
  if (encoded.length <= MAX_INLINE_NAMESPACE_SEGMENT_LENGTH) return `id-${encoded}`;

  return `h-${fnv1a64Base36(`cache-namespace:a:${id}`)}-${
    fnv1a64Base36(`cache-namespace:b:${id}`)
  }`;
}

/** FNV-1a hash for strings - returns hex string */
export function fnv1aHash(input: string): string {
  let hash = HASH_SEED_FNV1A >>> 0;

  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, FNV1A_PRIME_32);
  }

  return (hash >>> 0).toString(16);
}
