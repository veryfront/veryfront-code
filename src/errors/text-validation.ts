function isUnsafeControlCode(code: number): boolean {
  return code === 127 || (code >= 128 && code <= 159) || code === 0x200e || code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}

/** Return whether text contains an unsafe control or bidirectional formatting character. */
export function hasUnsafeControlCharacters(
  value: string,
  allowFormattingWhitespace = false,
): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (isUnsafeControlCode(code)) return true;
    if (code >= 32) continue;
    if (allowFormattingWhitespace && (code === 9 || code === 10 || code === 13)) continue;
    return true;
  }
  return false;
}

/** Remove unsafe control characters while preserving tabs and line breaks. */
export function stripUnsafeControlCharacters(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      isUnsafeControlCode(code) ||
      (code < 32 && code !== 9 && code !== 10 && code !== 13)
    ) continue;
    output += value[index];
  }
  return output;
}
