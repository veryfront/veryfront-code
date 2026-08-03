const ENCODED_HEADER_VALUE_PREFIX = "vf-utf8:";

function isByteString(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) > 0xff) return false;
  }
  return true;
}

export function encodeIdentityHeaderValue(value: string): string {
  if (isByteString(value) && !value.startsWith(ENCODED_HEADER_VALUE_PREFIX)) return value;
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
