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
 * The native `Deno` namespace, accessed via `self` to bypass the dnt shim
 * transform.
 *
 * In npm packages, dnt rewrites both `Deno.*` and `globalThis.Deno` to use
 * `@deno/shim-deno`, which lacks native APIs such as `Deno.serve` and
 * `Deno.upgradeWebSocket`. `self` is not shimmed by dnt and equals
 * `globalThis` in Deno, so it yields the genuine native namespace.
 *
 * Returns `undefined` when no native `Deno` is present (e.g. Node without the
 * shim), allowing callers to guard. Callers that have already established the
 * Deno runtime can use a non-null assertion on the result.
 */
export function getNativeDeno(): typeof Deno | undefined {
  return (self as unknown as Record<string, typeof Deno | undefined>)["Deno"];
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
