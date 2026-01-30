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
/**
 * Compare two strings in constant time.
 * Returns true if they are equal, false otherwise.
 */
export declare function constantTimeEqual(a: string, b: string): boolean;
//# sourceMappingURL=constant-time.d.ts.map