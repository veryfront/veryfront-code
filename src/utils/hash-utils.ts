import { FNV1A_PRIME_32 } from "./constants/crypto.ts";
import { HASH_SEED_FNV1A } from "./constants/hash.ts";

/** Number of hex characters kept by shortHash (8 hex chars = 32 bits) */
const SHORT_HASH_LENGTH = 8;

// Hashes participate in cache and request identities after project modules may
// have executed in the shared realm. Capture the small set of primordials used
// by that boundary before project code can replace their implementations.
const IntrinsicTextEncoder = TextEncoder;
const IntrinsicUint8Array = Uint8Array;
const NumberPrototypeToString = Number.prototype.toString;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ReflectApply = Reflect.apply;
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

function toHex(buffer: ArrayBuffer): string {
  const bytes = new IntrinsicUint8Array(buffer);
  let result = "";
  const length = typedArrayLength(bytes);
  for (let index = 0; index < length; index++) {
    const hex = ReflectApply(NumberPrototypeToString, bytes[index], [16]) as string;
    result += ReflectApply(StringPrototypePadStart, hex, [2, "0"]) as string;
  }
  return result;
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

/** Compute code hash. */
export function computeCodeHash(code: BundleCode): Promise<string> {
  // Length-prefix every field so field boundaries cannot collapse
  // (`{ code: "ab" }` must not hash as `{ code: "a", css: "b" }`).
  const css = code.css ?? "";
  const sourceMap = code.sourceMap ?? "";
  return computeHash(
    `${code.code.length}:${code.code}` +
      `${css.length}:${css}` +
      `${sourceMap.length}:${sourceMap}`,
  );
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

/** FNV-1a hash for strings - returns hex string */
export function fnv1aHash(input: string): string {
  let hash = HASH_SEED_FNV1A >>> 0;

  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, FNV1A_PRIME_32);
  }

  return (hash >>> 0).toString(16);
}
