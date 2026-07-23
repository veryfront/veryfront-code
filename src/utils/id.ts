/** ID generation utilities (16-char alphanumeric with optional prefix) */

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MAX_ID_SIZE = 1_024;
const MAX_UNBIASED_BYTE = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

function randomString(length: number): string {
  let result = "";
  while (result.length < length) {
    const remaining = length - result.length;
    const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(remaining * 1.1) + 1));
    for (const byte of bytes) {
      if (byte >= MAX_UNBIASED_BYTE) continue;
      result += ALPHABET[byte % ALPHABET.length];
      if (result.length === length) break;
    }
  }
  return result;
}

function validateIdSize(size: number): void {
  if (!Number.isInteger(size) || size < 1 || size > MAX_ID_SIZE) {
    throw new RangeError(`ID size must be an integer between 1 and ${MAX_ID_SIZE}.`);
  }
}

interface CryptoUuidSource {
  randomUUID?: () => string;
  getRandomValues?: (bytes: Uint8Array) => Uint8Array;
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Generate a secure RFC 4122 version 4 UUID across browser Crypto implementations. */
export function generateUuid(
  cryptoImpl: CryptoUuidSource | null | undefined = typeof crypto !== "undefined"
    ? crypto
    : undefined,
): string {
  if (typeof cryptoImpl?.randomUUID === "function") {
    const uuid = cryptoImpl.randomUUID();
    if (UUID_V4_PATTERN.test(uuid)) return uuid;
  }
  if (typeof cryptoImpl?.getRandomValues !== "function") {
    throw new Error("Web Crypto with getRandomValues is required to generate a secure UUID.");
  }

  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 16) {
    throw new Error("Web Crypto getRandomValues returned an invalid UUID byte array.");
  }
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
  validateIdSize(size);

  return function generate(): string {
    const id = randomString(size);
    return prefix ? `${prefix}${separator}${id}` : id;
  };
}
