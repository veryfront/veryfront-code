/** Shared cache-boundary validation helpers. */

const utf8Encoder = new TextEncoder();

/** Return true when a string contains a C0/C1 control character. */
export function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Return true when a string is not a well-formed sequence of Unicode scalars. */
export function containsUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return true;
      index++;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

/** Return true when a string is unsafe at a cache identity or storage boundary. */
export function containsUnsafeCacheStringCharacter(value: string): boolean {
  return containsControlCharacter(value) || containsUnpairedSurrogate(value);
}

/**
 * Encode a JavaScript string for hashing without normalizing malformed UTF-16.
 *
 * `TextEncoder` replaces every unpaired surrogate with the same replacement
 * scalar, which can make distinct cache identities hash to the same bytes. Keep
 * normal UTF-8 output byte-for-byte compatible, and use a reserved prefix plus
 * UTF-16 code units only for malformed strings. The prefix cannot begin valid
 * UTF-8, so the two encodings remain disjoint.
 */
export function encodeCacheHashInput(value: string): Uint8Array<ArrayBuffer> {
  if (!containsUnpairedSurrogate(value)) return utf8Encoder.encode(value);

  const bytes = new Uint8Array(2 + value.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    bytes[2 + index * 2] = codeUnit & 0xff;
    bytes[3 + index * 2] = codeUnit >>> 8;
  }
  return bytes;
}
