/**
 * Shared request ID generation.
 *
 * Uses `crypto.randomUUID()` consistently across all entry points
 * (dev server, production runtime handler) for uniform format.
 *
 * @module
 */

const MAX_INCOMING_REQUEST_ID_LENGTH = 255;

function isSafeIncomingRequestId(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > MAX_INCOMING_REQUEST_ID_LENGTH ||
    value.trim().length === 0
  ) {
    return false;
  }

  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (
      codeUnit < 0x20 ||
      codeUnit === 0x7f ||
      codeUnit === 0x2028 ||
      codeUnit === 0x2029
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Return a bounded, log-safe incoming request ID when present; otherwise
 * generate a new UUID.
 */
export function generateRequestId(incomingId?: string | null): string {
  if (incomingId && isSafeIncomingRequestId(incomingId)) return incomingId;
  return crypto.randomUUID();
}
