const ENCODED_HEADER_VALUE_PREFIX = "vf-utf8:";

function isHeaderSafe(value: string): boolean {
  if (value.trim() !== value) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code > 0xff || code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
  }
  return true;
}

export function encodeIdentityHeaderValue(value: string): string {
  if (isHeaderSafe(value) && !value.startsWith(ENCODED_HEADER_VALUE_PREFIX)) return value;
  return `${ENCODED_HEADER_VALUE_PREFIX}${encodeURIComponent(value)}`;
}

export function decodeIdentityHeaderValue(value: string | null): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith(ENCODED_HEADER_VALUE_PREFIX)) return value;
  try {
    return decodeURIComponent(value.slice(ENCODED_HEADER_VALUE_PREFIX.length));
  } catch {
    return undefined;
  }
}
