import { createProxyContextHeaders, type ProxyContext } from "./handler.ts";
import { type ProxyRequestInit, withProxyStreamingBodyDuplex } from "./request-init.ts";
import { injectContext } from "./tracing.ts";

/**
 * Build the standalone proxy's renderer request from the canonical shared
 * context-header policy.
 *
 * Keeping the complete request-init boundary here prevents split mode from
 * drifting from combined mode when end-to-end or internal header policy
 * changes. Trace propagation is added only after untrusted hop-by-hop and
 * caller-supplied internal headers have been removed.
 */
export function createSplitForwardRequestInit(
  request: Request,
  context: ProxyContext,
  body: ReadableStream<Uint8Array> | null,
  signal: AbortSignal,
): ProxyRequestInit {
  const headers = createProxyContextHeaders(request, context);
  injectContext(headers);
  return withProxyStreamingBodyDuplex({
    method: request.method,
    headers,
    body,
    redirect: "manual",
    signal,
  });
}
