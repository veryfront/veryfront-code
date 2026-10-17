// Project modules share the process; preserve the identity codec's host intrinsics.
const apply = Reflect.apply;
const StringTrim = String.prototype.trim;
const StringCharCodeAt = String.prototype.charCodeAt;
const StringStartsWith = String.prototype.startsWith;
const StringSlice = String.prototype.slice;
const EncodeURIComponent = encodeURIComponent;
const DecodeURIComponent = decodeURIComponent;

const ENCODED_HEADER_VALUE_PREFIX = "vf-utf8:";

function isHeaderSafe(value: string): boolean {
  if (apply(StringTrim, value, []) !== value) return false;
  for (let index = 0; index < value.length; index++) {
    const code = apply(StringCharCodeAt, value, [index]);
    if (code > 0xff || code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
  }
  return true;
}

export function encodeIdentityHeaderValue(value: string): string {
  if (isHeaderSafe(value) && !apply(StringStartsWith, value, [ENCODED_HEADER_VALUE_PREFIX])) {
    return value;
  }
  return `${ENCODED_HEADER_VALUE_PREFIX}${EncodeURIComponent(value)}`;
}

export function decodeIdentityHeaderValue(value: string | null): string | undefined {
  if (!value) return undefined;
  if (!apply(StringStartsWith, value, [ENCODED_HEADER_VALUE_PREFIX])) return value;
  try {
    return DecodeURIComponent(apply(StringSlice, value, [ENCODED_HEADER_VALUE_PREFIX.length]));
  } catch {
    return undefined;
  }
}
