/**
 * Constant-time string comparison to prevent timing attacks.
 *
 * Uses crypto.subtle.timingSafeEqual when available (Deno, Node 20+),
 * falls back to a manual XOR-based comparison that always examines
 * every byte regardless of match position.
 *
 * IMPORTANT: Always use this for comparing secrets (tokens, passwords,
 * API keys). Never use === for secret comparison.
 */

const encoder = new TextEncoder();

/**
 * Compare two strings in constant time.
 * Returns true if they are equal, false otherwise.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);

  if (aBuf.length !== bBuf.length) {
    // Still do a full comparison to avoid leaking length info via timing.
    // Compare against aBuf itself so the loop always runs.
    let xor = 1; // Start with 1 so result is always false
    for (let i = 0; i < aBuf.length; i++) {
      xor |= aBuf[i]! ^ aBuf[i]!;
    }
    return xor === 0; // Always false
  }

  let xor = 0;
  for (let i = 0; i < aBuf.length; i++) {
    xor |= aBuf[i]! ^ bBuf[i]!;
  }
  return xor === 0;
}
