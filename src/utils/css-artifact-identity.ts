/**
 * Canonical identities shared by CSS generation, cache, and control-plane boundaries.
 *
 * This module deliberately has no vendor dependencies. Cache identities may cross
 * process and service boundaries, so accepting two strings with the same encoded
 * representation—or an unbounded string—is unsafe even when TypeScript calls the
 * value a `string`.
 *
 * @module utils/css-artifact-identity
 */

/** Maximum UTF-16 code units accepted for one complete CSS pipeline identity. */
export const MAX_CSS_PIPELINE_IDENTITY_CODE_UNITS = 2_048;

/** Maximum encoded UTF-8 bytes accepted for one complete CSS pipeline identity. */
export const MAX_CSS_PIPELINE_IDENTITY_UTF8_BYTES = 2_048;

const CSS_STYLE_PROFILE_HASH_PATTERN = /^[a-f0-9]{64}$/;
const ReflectApply = Reflect.apply;
const RegExpPrototypeTest = RegExp.prototype.test;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypeNormalize = String.prototype.normalize;
const StringPrototypeTrim = String.prototype.trim;
const TextEncoderPrototypeEncode = TextEncoder.prototype.encode;
const cssIdentityTextEncoder = new TextEncoder();

function charCodeAt(value: string, index: number): number {
  return ReflectApply(StringPrototypeCharCodeAt, value, [index]) as number;
}

function hasOnlyWellFormedNonControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = charCodeAt(value, index);
    if (codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f)) {
      return false;
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const trailing = charCodeAt(value, index + 1);
      if (trailing < 0xdc00 || trailing > 0xdfff) return false;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
  }
  return true;
}

/** Whether a value is safe to compare, encode, and persist as a CSS pipeline identity. */
export function isCSSPipelineIdentity(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CSS_PIPELINE_IDENTITY_CODE_UNITS ||
    ReflectApply(StringPrototypeTrim, value, []) !== value ||
    ReflectApply(StringPrototypeNormalize, value, ["NFC"]) !== value ||
    !hasOnlyWellFormedNonControlCharacters(value)
  ) {
    return false;
  }

  const bytes = ReflectApply(
    TextEncoderPrototypeEncode,
    cssIdentityTextEncoder,
    [value],
  ) as Uint8Array;
  return bytes.byteLength <= MAX_CSS_PIPELINE_IDENTITY_UTF8_BYTES;
}

/** Validate and return an immutable string snapshot for cache or wire use. */
export function assertCSSPipelineIdentity(
  value: unknown,
  label = "CSS pipeline identity",
): string {
  if (!isCSSPipelineIdentity(value)) {
    throw new TypeError(
      `${label} must be a trimmed, NFC-normalized, well-formed string without control characters and no larger than ${MAX_CSS_PIPELINE_IDENTITY_CODE_UNITS} code units or ${MAX_CSS_PIPELINE_IDENTITY_UTF8_BYTES} UTF-8 bytes`,
    );
  }
  return value;
}

/** Whether a value is the canonical style-scope profile SHA-256 identity. */
export function isStyleProfileHash(value: unknown): value is string {
  return typeof value === "string" &&
    ReflectApply(RegExpPrototypeTest, CSS_STYLE_PROFILE_HASH_PATTERN, [value]) === true;
}

/** Validate and return the canonical style-scope profile SHA-256 identity. */
export function assertStyleProfileHash(
  value: unknown,
  label = "Style profile hash",
): string {
  if (!isStyleProfileHash(value)) {
    throw new TypeError(`${label} must be a full lowercase SHA-256 digest`);
  }
  return value;
}
