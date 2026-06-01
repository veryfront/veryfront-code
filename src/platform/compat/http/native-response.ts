/**
 * Shared helpers for bridging polyfilled `Response` objects to native ones
 * required by `Deno.serve`.
 *
 * In npm packages, dnt replaces the global `Response` with undici's polyfill,
 * but `Deno.serve` requires native `Response` instances. These helpers access
 * the native constructor via `self` (which dnt does not shim) and re-wrap
 * polyfilled responses as needed.
 *
 * IMPORTANT: this module must remain importable without `--allow-env`. It must
 * NOT read environment variables or import a logger at module load time.
 *
 * @module platform/compat/http/native-response
 */

/**
 * The native `Response` constructor, accessed via `self` to bypass the dnt
 * shim transform (dnt rewrites bare `Response` to undici's polyfill).
 */
export function getNativeResponse(): typeof Response {
  return (self as unknown as { Response: typeof Response }).Response;
}

/**
 * Re-wrap a (possibly polyfilled) `Response` as a native `Response` so it can be
 * returned from `Deno.serve`.
 *
 * If `response` is already a native instance (compiled binary or WebSocket
 * upgrade), it is returned as-is. Otherwise its body/status/headers are copied
 * into a fresh native `Response`.
 */
export function toNativeResponse(
  response: Response,
  NativeResponse: typeof Response,
): Response {
  // If already native (compiled binary or WebSocket upgrade), return as-is.
  if (response instanceof NativeResponse) return response;
  // Re-wrap polyfilled Response as native Response.
  // At runtime, `response` may be an undici Response (from the dnt shim) that
  // fails Deno's native instanceof check. Cast to access its properties.
  const r = response as unknown as Response;
  return new NativeResponse(r.body, {
    status: r.status,
    statusText: r.statusText,
    headers: r.headers,
  });
}
