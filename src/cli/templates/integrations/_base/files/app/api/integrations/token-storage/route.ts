/**
 * Token Storage Status API
 *
 * Returns the current token storage mode and encryption status.
 */

import { getStorageMode, isEncryptionEnabled } from "../../../../lib/token-store";

export async function GET() {
  return Response.json({
    mode: getStorageMode(),
    encrypted: isEncryptionEnabled(),
  });
}
