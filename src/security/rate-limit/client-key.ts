/**
 * Resolve a stable client key from proxy headers.
 *
 * Forwarded headers are ignored unless proxy trust is explicit. When trusted,
 * use the rightmost X-Forwarded-For value, which is the address appended by the
 * nearest proxy, then fall back to X-Real-IP.
 */
export function resolveRateLimitClientKey(
  request: Request,
  trustProxy: boolean,
  fallback: string,
): string {
  if (!trustProxy) return fallback;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const addresses = forwarded.split(",").map((value) => value.trim()).filter(Boolean);
    const nearestAddress = addresses.at(-1);
    if (nearestAddress) return nearestAddress;
  }

  return request.headers.get("x-real-ip")?.trim() || fallback;
}
