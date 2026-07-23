/** ID generation utilities (16-char alphanumeric with optional prefix) */

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MAX_UNBIASED_BYTE = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

function randomString(length: number): string {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError("ID size must be a positive integer");
  }

  let result = "";
  while (result.length < length) {
    const remaining = length - result.length;
    const batchSize = Math.min(
      65_536,
      Math.max(32, Math.ceil((remaining * 256) / MAX_UNBIASED_BYTE)),
    );
    const bytes = crypto.getRandomValues(new Uint8Array(batchSize));

    for (const byte of bytes) {
      if (byte >= MAX_UNBIASED_BYTE) continue;
      result += ALPHABET[byte % ALPHABET.length];
      if (result.length === length) break;
    }
  }
  return result;
}

interface CryptoUuidSource {
  randomUUID?: () => string;
  getRandomValues?: (bytes: Uint8Array) => Uint8Array;
}

/** Generate a secure RFC 4122 version 4 UUID across browser Crypto implementations. */
export function generateUuid(
  cryptoImpl: CryptoUuidSource | null | undefined = typeof crypto !== "undefined"
    ? crypto
    : undefined,
): string {
  if (typeof cryptoImpl?.randomUUID === "function") {
    return cryptoImpl.randomUUID();
  }
  if (typeof cryptoImpl?.getRandomValues !== "function") {
    throw new Error("Web Crypto with getRandomValues is required to generate a secure UUID.");
  }

  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/** Generate a unique ID with optional prefix (e.g., "msg-a1B2c3D4e5F6g7H8") */
export function generateId(prefix?: string): string {
  const id = randomString(16);
  return prefix ? `${prefix}-${id}` : id;
}

/** Create an ID generator with fixed prefix and optional configuration */
export function createIdGenerator(options: {
  prefix?: string;
  separator?: string;
  size?: number;
}): () => string {
  const { prefix, separator = "-", size = 16 } = options;
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError("ID size must be a positive integer");
  }

  return function generate(): string {
    const id = randomString(size);
    return prefix ? `${prefix}${separator}${id}` : id;
  };
}
