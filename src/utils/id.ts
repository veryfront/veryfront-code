/** ID generation utilities (AI SDK compatible: 16-char alphanumeric with optional prefix) */

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
