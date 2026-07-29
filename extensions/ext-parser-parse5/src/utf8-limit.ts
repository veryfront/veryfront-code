/** Count an input's UTF-8 bytes without allocating an encoded copy. */
export function utf8LengthWithinLimit(
  input: string,
  limit: number,
): { ok: true; bytes: number } | { ok: false } {
  let bytes = 0;

  for (let index = 0; index < input.length; index++) {
    const codeUnit = input.charCodeAt(index);
    let width: number;

    if (codeUnit <= 0x7f) {
      width = 1;
    } else if (codeUnit <= 0x7ff) {
      width = 2;
    } else if (
      codeUnit >= 0xd800 && codeUnit <= 0xdbff &&
      index + 1 < input.length
    ) {
      const nextCodeUnit = input.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        width = 4;
        index++;
      } else {
        width = 3;
      }
    } else {
      width = 3;
    }

    if (bytes + width > limit) return { ok: false };
    bytes += width;
  }

  return { ok: true, bytes };
}
