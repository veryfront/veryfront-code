const apply = Reflect.apply;
const numberIsSafeInteger = Number.isSafeInteger;
const NativeRangeError = RangeError;
const NativeTypeError = TypeError;
const POSITIVE_INFINITY = Number.POSITIVE_INFINITY;
const stringCharCodeAt = String.prototype.charCodeAt;

/**
 * Count UTF-8 bytes without allocating an encoded copy of a potentially large
 * string. Lone surrogates match TextEncoder's U+FFFD replacement behavior.
 *
 * When `stopAfter` is provided, the function returns `stopAfter + 1` as soon
 * as the boundary is exceeded.
 */
export function utf8ByteLength(
  value: string,
  stopAfter = POSITIVE_INFINITY,
): number {
  if (typeof value !== "string") {
    throw new NativeTypeError("UTF-8 byte length input must be a string");
  }
  if (
    stopAfter !== POSITIVE_INFINITY &&
    (!numberIsSafeInteger(stopAfter) || stopAfter < 0)
  ) {
    throw new NativeRangeError(
      "UTF-8 byte length stopAfter must be a non-negative safe integer",
    );
  }

  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const codeUnit = apply(stringCharCodeAt, value, [index]) as number;
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
      const nextCodeUnit = apply(stringCharCodeAt, value, [index + 1]) as number;
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
