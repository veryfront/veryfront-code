const DecodeURIComponent = decodeURIComponent;
const EncodeURIComponent = encodeURIComponent;
const NumberPrototypeToString = Number.prototype.toString;
const NumberParseInt = Number.parseInt;
const ReflectApply = Reflect.apply;
const StringFromCharCode = String.fromCharCode;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypePadStart = String.prototype.padStart;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeToUpperCase = String.prototype.toUpperCase;

function getStringCodeUnit(value: string, index: number): number {
  return ReflectApply(StringPrototypeCharCodeAt, value, [index]) as number;
}

function formatEscapedSurrogate(codeUnit: number): string {
  const hex = ReflectApply(NumberPrototypeToString, codeUnit, [16]) as string;
  const upperHex = ReflectApply(StringPrototypeToUpperCase, hex, []) as string;
  return `%u${ReflectApply(StringPrototypePadStart, upperHex, [4, "0"]) as string}`;
}

function isCanonicalEscapedCodeUnit(value: string): boolean {
  if (value.length !== 4) return false;
  for (let index = 0; index < value.length; index++) {
    const codeUnit = getStringCodeUnit(value, index);
    const isDigit = codeUnit >= 0x30 && codeUnit <= 0x39;
    const isUpperHex = codeUnit >= 0x41 && codeUnit <= 0x46;
    if (!isDigit && !isUpperHex) return false;
  }
  return true;
}

function isLowercaseHexCodeUnit(value: string): boolean {
  if (value.length !== 4) return false;
  for (let index = 0; index < value.length; index++) {
    const codeUnit = getStringCodeUnit(value, index);
    const isDigit = codeUnit >= 0x30 && codeUnit <= 0x39;
    const isLowerHex = codeUnit >= 0x61 && codeUnit <= 0x66;
    if (!isDigit && !isLowerHex) return false;
  }
  return true;
}

function isCacheLiteralCodeUnit(codeUnit: number): boolean {
  return (
    (codeUnit >= 0x30 && codeUnit <= 0x39) ||
    (codeUnit >= 0x41 && codeUnit <= 0x5a) ||
    (codeUnit >= 0x61 && codeUnit <= 0x7a) ||
    codeUnit === 0x2d ||
    codeUnit === 0x2e ||
    codeUnit === 0x2f
  );
}

/**
 * Encode an exact JavaScript string as one delimiter- and glob-safe segment.
 *
 * Common API-safe ASCII stays compact. Every other UTF-16 code unit uses a
 * lowercase `_xxxx` escape, so lone surrogates never collapse through UTF-8.
 * The leading `s` marker makes the empty string representable. A terminal `_`
 * sentinel prevents a literal `vf-sanitized` suffix from touching the following
 * `:` delimiter and aliasing the API sanitizer's reserved namespace.
 */
export function encodeCacheKeyLiteralSegment(value: string): string {
  let encoded = "s";
  for (let index = 0; index < value.length; index++) {
    const codeUnit = getStringCodeUnit(value, index);
    if (isCacheLiteralCodeUnit(codeUnit)) {
      encoded += ReflectApply(StringFromCharCode, String, [codeUnit]) as string;
      continue;
    }
    const hex = ReflectApply(NumberPrototypeToString, codeUnit, [16]) as string;
    encoded += `_${ReflectApply(StringPrototypePadStart, hex, [4, "0"]) as string}`;
  }
  return `${encoded}_`;
}

/** Decode only canonical values emitted by {@link encodeCacheKeyLiteralSegment}. */
export function decodeCacheKeyLiteralSegment(encoded: string): string | null {
  const terminalIndex = encoded.length - 1;
  if (
    terminalIndex < 1 ||
    getStringCodeUnit(encoded, 0) !== 0x73 ||
    getStringCodeUnit(encoded, terminalIndex) !== 0x5f
  ) return null;

  let decoded = "";
  for (let index = 1; index < terminalIndex; index++) {
    const codeUnit = getStringCodeUnit(encoded, index);
    if (isCacheLiteralCodeUnit(codeUnit)) {
      decoded += ReflectApply(StringFromCharCode, String, [codeUnit]) as string;
      continue;
    }
    if (codeUnit !== 0x5f || index + 4 >= terminalIndex) return null;

    const escaped = ReflectApply(StringPrototypeSlice, encoded, [index + 1, index + 5]) as string;
    if (!isLowercaseHexCodeUnit(escaped)) return null;
    const escapedCodeUnit = NumberParseInt(escaped, 16);
    if (isCacheLiteralCodeUnit(escapedCodeUnit)) return null;
    decoded += ReflectApply(StringFromCharCode, String, [escapedCodeUnit]) as string;
    index += 4;
  }

  return encodeCacheKeyLiteralSegment(decoded) === encoded ? decoded : null;
}

/**
 * Percent-encode a delimiter-separated cache-key segment without rejecting or
 * collapsing lone UTF-16 surrogates.
 *
 * Valid Unicode is byte-for-byte compatible with `encodeURIComponent`.
 * Unpaired surrogates use a `%uXXXX` sentinel. A literal percent sign is encoded
 * as `%25`, so caller text cannot alias a sentinel.
 */
export function encodeCacheKeyPercentSegment(value: string): string {
  try {
    return EncodeURIComponent(value);
  } catch {
    let encoded = "";
    let chunkStart = 0;
    for (let index = 0; index < value.length; index++) {
      const codeUnit = getStringCodeUnit(value, index);
      const isHighSurrogate = codeUnit >= 0xd800 && codeUnit <= 0xdbff;
      const isLowSurrogate = codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
      const nextCodeUnit = isHighSurrogate && index + 1 < value.length
        ? getStringCodeUnit(value, index + 1)
        : -1;

      if (isHighSurrogate && nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        index++;
        continue;
      }
      if (!isHighSurrogate && !isLowSurrogate) continue;

      encoded += EncodeURIComponent(
        ReflectApply(StringPrototypeSlice, value, [chunkStart, index]) as string,
      );
      encoded += formatEscapedSurrogate(codeUnit);
      chunkStart = index + 1;
    }
    return encoded +
      EncodeURIComponent(
        ReflectApply(StringPrototypeSlice, value, [chunkStart]) as string,
      );
  }
}

/**
 * Decode a segment emitted by {@link encodeCacheKeyPercentSegment}.
 *
 * Only surrogate-range `%uXXXX` sentinels are accepted, which keeps the decoder
 * injective with ordinary `encodeURIComponent` output.
 */
export function decodeCacheKeyPercentSegment(encoded: string): string | null {
  let decoded = "";
  let chunkStart = 0;

  for (let index = 0; index + 5 < encoded.length; index++) {
    if (encoded[index] !== "%" || encoded[index + 1] !== "u") continue;
    const escaped = ReflectApply(StringPrototypeSlice, encoded, [index + 2, index + 6]) as string;
    if (!isCanonicalEscapedCodeUnit(escaped)) continue;
    const codeUnit = NumberParseInt(escaped, 16);
    if (codeUnit < 0xd800 || codeUnit > 0xdfff) continue;

    try {
      decoded += DecodeURIComponent(
        ReflectApply(StringPrototypeSlice, encoded, [chunkStart, index]) as string,
      );
    } catch {
      return null;
    }
    decoded += ReflectApply(StringFromCharCode, String, [codeUnit]) as string;
    index += 5;
    chunkStart = index + 1;
  }

  try {
    const value = decoded +
      DecodeURIComponent(
        ReflectApply(StringPrototypeSlice, encoded, [chunkStart]) as string,
      );
    return encodeCacheKeyPercentSegment(value) === encoded ? value : null;
  } catch {
    return null;
  }
}

/** Encode arbitrary JavaScript strings into an injective cache-key-safe segment. */
export function encodeCacheKeySegment(value: string): string {
  // JSON preserves lone UTF-16 surrogates as escapes. Encoding the raw string
  // with TextEncoder would collapse them to U+FFFD and make distinct JS strings
  // alias the same cache identity.
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** Decode a segment emitted by {@link encodeCacheKeySegment}. */
export function decodeCacheKeySegment(encoded: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) return null;

  try {
    const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - encoded.length % 4) % 4);
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(decoded);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}
