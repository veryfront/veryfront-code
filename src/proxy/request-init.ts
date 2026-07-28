export type ProxyRequestInit = RequestInit & { duplex?: "half" };

/**
 * Mark forwarded Web streams as half duplex for Node's fetch implementation.
 *
 * Deno and Bun accept the standard fetch extension, while Node requires it
 * whenever a ReadableStream is used as a request body. The body and every
 * other init value retain their existing identity and ownership.
 */
export function withProxyStreamingBodyDuplex(
  init: RequestInit,
): ProxyRequestInit {
  if (!(init.body instanceof ReadableStream)) return init;
  return { ...init, duplex: "half" };
}
