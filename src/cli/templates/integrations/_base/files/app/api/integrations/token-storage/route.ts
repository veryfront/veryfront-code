/**
 * Token Storage Status API
 *
 * Returns the current token storage mode and encryption status.
 * This endpoint is self-contained to work with any version of token-store.
 */

export async function GET() {
  // Detect storage mode from environment variables
  const env = process.env;
  let mode: "memory" | "database" | "kv" | "redis" = "memory";

  if (env.DATABASE_URL) {
    mode = "database";
  } else if (env.KV_REST_API_URL) {
    mode = "kv";
  } else if (env.REDIS_URL) {
    mode = "redis";
  }

  // Check if encryption is enabled
  const encryptionKey = env.TOKEN_ENCRYPTION_KEY;
  const encrypted = typeof encryptionKey === "string" && encryptionKey.length === 64;

  return Response.json({ mode, encrypted });
}
