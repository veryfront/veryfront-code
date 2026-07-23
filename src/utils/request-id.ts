/**
 * Shared request ID generation.
 *
 * Uses `crypto.randomUUID()` consistently across all entry points
 * (dev server, production runtime handler) for uniform format.
 *
 * @module
 */

/**
 * Return the incoming request ID if present, otherwise generate a new UUID.
 */
export function generateRequestId(incomingId?: string | null): string {
  if (incomingId && incomingId.length <= 128 && /^[A-Za-z0-9._:/-]+$/.test(incomingId)) {
    return incomingId;
  }
  return crypto.randomUUID();
}
