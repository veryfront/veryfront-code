import {
  MAX_OPAQUE_ID_CODE_UNITS,
  MAX_PROJECT_SLUG_CODE_UNITS,
} from "./constants/project-identity.ts";

const ReflectApply = Reflect.apply;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypeTrim = String.prototype.trim;

function charCodeAt(value: string, index: number): number {
  return ReflectApply(StringPrototypeCharCodeAt, value, [index]);
}

function isAsciiLetterOrDigit(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a)
  );
}

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = charCodeAt(value, index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const low = charCodeAt(value, index + 1);
      if (low < 0xdc00 || low > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** Whether a string contains a Unicode Cc control code point. */
export function hasProjectIdentityControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = charCodeAt(value, index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

/** Normalize optional whitespace surrounding an upstream project slug. */
export function normalizeProjectSlug(value: string): string {
  return ReflectApply(StringPrototypeTrim, value, []);
}

/** Whether a value is a bounded, exact opaque identifier. */
export function isCanonicalOpaqueProjectIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_OPAQUE_ID_CODE_UNITS &&
    isWellFormedUtf16(value) &&
    value === normalizeProjectSlug(value) &&
    !hasProjectIdentityControlCharacters(value)
  );
}

/** Whether a normalized value is a canonical hosted project slug. */
export function isCanonicalProjectSlug(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > MAX_PROJECT_SLUG_CODE_UNITS ||
    !isAsciiLetterOrDigit(charCodeAt(value, 0)) ||
    !isAsciiLetterOrDigit(charCodeAt(value, value.length - 1))
  ) {
    return false;
  }

  for (let index = 1; index < value.length - 1; index += 1) {
    const code = charCodeAt(value, index);
    if (!isAsciiLetterOrDigit(code) && code !== 0x2d) {
      return false;
    }
  }
  return true;
}

export { MAX_OPAQUE_ID_CODE_UNITS, MAX_PROJECT_SLUG_CODE_UNITS };
