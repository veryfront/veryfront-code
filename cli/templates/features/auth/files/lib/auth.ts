const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const HASH_LENGTH = 256; // bits

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    HASH_LENGTH,
  );
}

/**
 * Hash a password using PBKDF2-SHA256 with a random salt.
 * Returns a string in the format "hex(salt):hex(hash)".
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const hashBuffer = await deriveKey(password, salt);
  return `${toHex(salt)}:${toHex(hashBuffer)}`;
}

/**
 * Verify a password against a stored PBKDF2-SHA256 hash.
 * Uses constant-time comparison to prevent timing attacks.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const separatorIndex = storedHash.indexOf(":");
  if (separatorIndex === -1) {
    return false;
  }

  const salt = fromHex(storedHash.substring(0, separatorIndex));
  const expectedHash = fromHex(storedHash.substring(separatorIndex + 1));
  const computedHashBuffer = await deriveKey(password, salt);
  const computedHash = new Uint8Array(computedHashBuffer);

  // Constant-time comparison to prevent timing attacks
  if (expectedHash.length !== computedHash.length) {
    return false;
  }

  return timingSafeEqual(expectedHash, computedHash);
}

/**
 * Constant-time byte array comparison.
 * Compares all bytes regardless of where a mismatch occurs,
 * preventing timing side-channel attacks.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }

  return result === 0;
}
