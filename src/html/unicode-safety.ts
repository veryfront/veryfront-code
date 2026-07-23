/** Return whether a string contains an unpaired UTF-16 surrogate code unit. */
export function hasUnpairedUtf16Surrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xdc00 && code <= 0xdfff) return true;
    if (code < 0xd800 || code > 0xdbff) continue;

    const next = value.charCodeAt(index + 1);
    if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
    index++;
  }
  return false;
}

/** Return whether text contains C1 or bidirectional formatting controls. */
export function hasUnsafeUnicodeFormatting(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      (code >= 127 && code <= 159) || code === 0x200e || code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
    ) return true;
  }
  return false;
}
