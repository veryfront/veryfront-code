/** ID generation utilities (16-char alphanumeric with optional prefix) */

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function randomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  let result = "";
  for (let i = 0; i < length; i++) {
    result += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
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

  return function generate(): string {
    const id = randomString(size);
    return prefix ? `${prefix}${separator}${id}` : id;
  };
}
