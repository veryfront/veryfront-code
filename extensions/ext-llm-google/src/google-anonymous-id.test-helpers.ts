/** Nonce produced while {@link withFixedGoogleAnonymousIdNonce} is active. */
export const FIXED_GOOGLE_ANONYMOUS_ID_NONCE = "abababababababab";

/** The id an id-less Gemini function call at `partIndex` gets under the fixed nonce. */
export function fixedAnonymousToolCallId(partIndex: number): string {
  return `tool-${partIndex}-${FIXED_GOOGLE_ANONYMOUS_ID_NONCE}`;
}

/**
 * Runs `fn` with `crypto.getRandomValues` filling every byte with 0xab, so the
 * per-response anonymous tool call id nonce is deterministic.
 */
export async function withFixedGoogleAnonymousIdNonce<T>(
  fn: () => T | Promise<T>,
): Promise<T> {
  const hadOwn = Object.hasOwn(crypto, "getRandomValues");
  const original = crypto.getRandomValues;
  Object.defineProperty(crypto, "getRandomValues", {
    configurable: true,
    writable: true,
    value: <T extends ArrayBufferView | null>(array: T): T => {
      if (array !== null) {
        new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(0xab);
      }
      return array;
    },
  });
  try {
    return await fn();
  } finally {
    if (hadOwn) {
      Object.defineProperty(crypto, "getRandomValues", {
        configurable: true,
        writable: true,
        value: original,
      });
    } else {
      delete (crypto as { getRandomValues?: unknown }).getRandomValues;
    }
  }
}
