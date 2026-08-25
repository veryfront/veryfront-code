const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;

export function encodeAuthBase64Url(bytes: Uint8Array): string {
  let output = "";
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      output += BASE64URL_ALPHABET[(buffer >> bits) & 63];
    }
  }

  if (bits > 0) {
    output += BASE64URL_ALPHABET[(buffer << (6 - bits)) & 63];
  }

  return output;
}

export function decodeAuthBase64Url(value: string): Uint8Array {
  if (
    value.length % 4 === 1 ||
    value.includes("=") ||
    !BASE64URL_PATTERN.test(value)
  ) {
    throw new TypeError("Auth cookie value must use strict unpadded base64url");
  }

  const bytes = new Uint8Array(Math.floor(value.length * 3 / 4));
  let outputIndex = 0;
  let buffer = 0;
  let bits = 0;

  for (const character of value) {
    const decoded = BASE64URL_ALPHABET.indexOf(character);
    if (decoded < 0) {
      throw new TypeError("Auth cookie value must use strict unpadded base64url");
    }
    buffer = (buffer << 6) | decoded;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[outputIndex] = (buffer >> bits) & 255;
      outputIndex += 1;
      buffer &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }

  if (bits > 0 && buffer !== 0) {
    throw new TypeError("Auth cookie value has non-canonical base64url trailing bits");
  }

  return bytes.subarray(0, outputIndex);
}
