/** Whether a string contains C0, DEL, or C1 control characters. */
export function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Whether every UTF-16 surrogate is part of a valid pair. */
export function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** Whether a well-formed string fits within a UTF-8 byte budget. */
export function isUtf8WithinByteLimit(value: string, maxBytes: number): boolean {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) return false;

  let byteLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      byteLength += 1;
    } else if (code <= 0x7ff) {
      byteLength += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      byteLength += 4;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    } else {
      byteLength += 3;
    }
    if (byteLength > maxBytes) return false;
  }
  return true;
}
