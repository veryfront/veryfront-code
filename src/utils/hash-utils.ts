import { FNV1A_PRIME_32 } from "./constants/crypto.ts";
import { HASH_SEED_FNV1A } from "./constants/hash.ts";

/** Number of hex characters kept by shortHash (8 hex chars = 32 bits) */
const SHORT_HASH_LENGTH = 8;

/**
 * Maximum inline payload length kept losslessly by cacheNamespaceSegment.
 * This keeps every segment at 75 characters including its prefix, leaving room
 * for the cache root, runtime version, project segment, and module path under
 * the 260-character path limit used by hosts without long-path support.
 */
const MAX_INLINE_NAMESPACE_SEGMENT_LENGTH = 64;

/** Longest identifier cacheNamespaceSegment keeps verbatim (ASCII, 1 byte each). */
const MAX_VERBATIM_NAMESPACE_ID_LENGTH = 56;

/**
 * Upper bound on any cacheNamespaceSegment result: a three-character prefix
 * plus the longest inline encoding. Cached SSR module paths nest two of these
 * segments, so this is the budget callers must leave room for when they append
 * a base cache directory, a version segment, and a relative module path.
 */
export const MAX_CACHE_NAMESPACE_SEGMENT_LENGTH = 3 + MAX_INLINE_NAMESPACE_SEGMENT_LENGTH;

const FNV1A_OFFSET_BASIS_64 = 14695981039346656037n;
const FNV1A_PRIME_64 = 1099511628211n;
const FNV1A_MASK_64 = (1n << 64n) - 1n;

// Hashes participate in cache and request identities after project modules may
// have executed in the shared realm. Capture the small set of primordials used
// by that boundary before project code can replace their implementations.
const IntrinsicBigInt = BigInt;
const BigIntPrototypeToString = BigInt.prototype.toString;
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

function byteToHex(byte: number): string {
  const hex = ReflectApply(NumberPrototypeToString, byte, [16]) as string;
  return ReflectApply(StringPrototypePadStart, hex, [2, "0"]) as string;
}

function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  const length = typedArrayLength(bytes);
  for (let index = 0; index < length; index++) {
    result += byteToHex(bytes[index]!);
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
    const codeUnit = ReflectApply(StringPrototypeCharCodeAt, input, [index]) as number;
    hash ^= IntrinsicBigInt(codeUnit);
    hash = (hash * FNV1A_PRIME_64) & FNV1A_MASK_64;
  }

  return ReflectApply(BigIntPrototypeToString, hash, [36]) as string;
}

/**
 * Lowercase hex of a string's WTF-8 bytes.
 *
 * Identical to UTF-8 for well-formed strings, but an unpaired surrogate keeps
 * its own three-byte sequence instead of being folded to U+FFFD. `TextEncoder`
 * performs that replacement, which is lossy: `"\uD800"` and `"�"` both
 * encode to `efbfbd`, so two distinct identifiers would share one cache
 * namespace. Reads code units through the captured primordial so project code
 * that replaced `String.prototype.charCodeAt` cannot steer the encoding.
 */
function wtf8Hex(value: string): string {
  let result = "";
  const length = value.length;

  for (let index = 0; index < length; index++) {
    let codePoint = ReflectApply(StringPrototypeCharCodeAt, value, [index]) as number;

    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < length) {
      const trail = ReflectApply(StringPrototypeCharCodeAt, value, [index + 1]) as number;
      if (trail >= 0xdc00 && trail <= 0xdfff) {
        codePoint = (codePoint - 0xd800) * 0x400 + (trail - 0xdc00) + 0x10000;
        index++;
      }
    }

    if (codePoint < 0x80) {
      result += byteToHex(codePoint);
      continue;
    }

    if (codePoint < 0x800) {
      result += byteToHex(0xc0 | (codePoint >> 6));
      result += byteToHex(0x80 | (codePoint & 0x3f));
      continue;
    }

    if (codePoint < 0x10000) {
      result += byteToHex(0xe0 | (codePoint >> 12));
      result += byteToHex(0x80 | ((codePoint >> 6) & 0x3f));
      result += byteToHex(0x80 | (codePoint & 0x3f));
      continue;
    }

    result += byteToHex(0xf0 | (codePoint >> 18));
    result += byteToHex(0x80 | ((codePoint >> 12) & 0x3f));
    result += byteToHex(0x80 | ((codePoint >> 6) & 0x3f));
    result += byteToHex(0x80 | (codePoint & 0x3f));
  }

  return result;
}

/**
 * Whether an identifier is already a safe, case-fold-stable path segment and
 * can be kept verbatim instead of doubling in length as hex.
 *
 * Cached SSR module paths nest two namespace segments before the relative
 * module path, so segment length is a real budget: hosts without long-path
 * support cap a path at 260 characters. Lowercase ASCII letters, digits, "-"
 * and "_" survive every supported filesystem unchanged, and an all-lowercase
 * segment cannot fold into a different one on a case-insensitive filesystem.
 *
 * The first character must be a letter or a digit so a segment never starts
 * with a separator-like character, and "." is excluded because Windows strips
 * trailing dots from directory names, which would fold "x." and "x" into one
 * namespace.
 */
function isVerbatimNamespaceId(id: string): boolean {
  const length = id.length;
  if (length === 0 || length > MAX_VERBATIM_NAMESPACE_ID_LENGTH) return false;

  for (let index = 0; index < length; index++) {
    const codeUnit = ReflectApply(StringPrototypeCharCodeAt, id, [index]) as number;
    if (codeUnit >= 0x30 && codeUnit <= 0x39) continue;
    if (codeUnit >= 0x61 && codeUnit <= 0x7a) continue;
    if (index > 0 && (codeUnit === 0x2d || codeUnit === 0x5f)) continue;
    return false;
  }

  return true;
}

/**
 * Filesystem-safe cache namespace segment for an identifier.
 *
 * These segments partition on-disk SSR caches by project and content source, so
 * a shared segment lets one content source serve another source's transformed
 * modules for the same file path.
 *
 * Path-safe ASCII identifiers up to 56 bytes are kept verbatim under "id-";
 * other identifiers up to 32 WTF-8 bytes use lowercase hex under "hx-". Both
 * encodings are injective, so distinct identifiers inside those bounds
 * provably never share a segment, including on case-insensitive filesystems,
 * where a case-sensitive encoding would fold distinct segments back together.
 * Hex of the WTF-8 bytes is used rather than UTF-8 encoding because
 * `TextEncoder` folds an unpaired surrogate to U+FFFD, which would merge two
 * namespaces.
 *
 * Longer identifiers cannot stay inline without unbounded path segments, so
 * they collapse under a third disjoint prefix, "h-", to their WTF-8 byte length
 * plus two domain-separated 64-bit FNV-1a digests. That is 128 bits of a
 * non-cryptographic hash, further restricted to identifiers of equal byte
 * length: collisions there are impractical rather than impossible, so the
 * "never share a segment" guarantee is scoped to the inline forms. Callers that
 * derive segments from untrusted identifiers must bound their length upstream
 * to stay on the lossless path.
 */
export function cacheNamespaceSegment(id: string): string {
  if (isVerbatimNamespaceId(id)) return `id-${id}`;

  const encoded = wtf8Hex(id);
  if (encoded.length <= MAX_INLINE_NAMESPACE_SEGMENT_LENGTH) return `hx-${encoded}`;

  const byteLength = ReflectApply(NumberPrototypeToString, encoded.length / 2, [36]) as string;
  const firstHash = fnv1a64Base36("cache-namespace:a:" + id);
  const secondHash = fnv1a64Base36("cache-namespace:b:" + id);
  return `h-${byteLength}-${firstHash}-${secondHash}`;
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
