/**
 * Count UTF-8 bytes without allocating an encoded copy of a potentially large
 * string. Lone surrogates match TextEncoder's U+FFFD replacement behavior.
 *
 * When `stopAfter` is provided, the function returns `stopAfter + 1` as soon
 * as the boundary is exceeded.
 */
export function utf8ByteLength(
  value: string,
  stopAfter = Number.POSITIVE_INFINITY,
): number {
  if (typeof value !== "string") {
    throw new TypeError("UTF-8 byte length input must be a string");
  }
  if (
    stopAfter !== Number.POSITIVE_INFINITY &&
    (!Number.isSafeInteger(stopAfter) || stopAfter < 0)
  ) {
    throw new RangeError("UTF-8 byte length stopAfter must be a non-negative safe integer");
  }

  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    let width: number;
    if (codeUnit <= 0x7f) {
      width = 1;
    } else if (codeUnit <= 0x7ff) {
      width = 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length
    ) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        width = 4;
        index++;
      } else {
        width = 3;
      }
    } else {
      width = 3;
    }

    if (width > stopAfter - bytes) return stopAfter + 1;
    bytes += width;
  }
  return bytes;
}
