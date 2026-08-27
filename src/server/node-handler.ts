import { serverLogger } from "#veryfront/utils";
import { recordNodeIncomingRequestPeer } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";

type NodeRequest = import("node:http").IncomingMessage;
type NodeResponse = import("node:http").ServerResponse;

/** Convert a Web API request handler into a Node.js HTTP listener. */
export function toNodeHandler(
  handler: (req: Request) => Promise<Response> | Response,
): (req: NodeRequest, res: NodeResponse) => void {
  // Node ignores a listener's return value, so serve the request from a
  // synchronous listener that fires the async work and does not await it.
  return (req, res) => {
    void handleNodeRequest(handler, req, res);
  };
}

/** Build the Web API request that mirrors an incoming Node request. */
function toWebRequest(req: NodeRequest): Request {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.append(key, value);
    else if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry);
    }
  }

  const method = req.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? null : req;
  const init: RequestInit & { duplex?: string } = {
    method,
    headers,
    body: body as BodyInit | null,
  };
  if (body) init.duplex = "half";

  return new Request(url.toString(), init);
}

/**
 * Flatten response headers into the shape `writeHead` expects.
 *
 * Set-Cookie is the one header that must survive as multiple values, so it is
 * collected separately from the rest.
 */
function toNodeHeaders(response: Response): Record<string, string | string[]> {
  const outHeaders: Record<string, string | string[]> = {};
  const setCookies: string[] = [];

  // Node provides getSetCookie, while compatible Web Headers adapters may
  // omit it. Feature-detect the method so an adapter mismatch cannot turn
  // every otherwise valid response into a 500.
  const getSetCookie = response.headers.getSetCookie;
  if (typeof getSetCookie === "function") {
    // Modern path: getSetCookie returns each Set-Cookie as a distinct value.
    setCookies.push(...getSetCookie.call(response.headers));
  }

  for (const [key, value] of response.headers) {
    if (key.toLowerCase() === "set-cookie") {
      // Compatibility path for adapters without getSetCookie. The undici-based Headers
      // iterator yields each Set-Cookie as its own entry (it is the one header
      // that is NOT comma-joined during iteration), so iterating preserves
      // multiples where the platform allows it. If a runtime does collapse
      // them into a single comma-joined string we still pass that one value
      // through unchanged rather than throwing — degrade gracefully, never 500.
      if (typeof getSetCookie !== "function") setCookies.push(value);
      continue;
    }
    outHeaders[key] = value;
  }

  if (setCookies.length > 0) outHeaders["Set-Cookie"] = setCookies;
  return outHeaders;
}

/** Stream a response body to the Node response, cancelling if the peer goes away. */
async function pumpResponseBody(
  body: ReadableStream<Uint8Array>,
  res: NodeResponse,
): Promise<void> {
  const reader = body.getReader();
  res.on("close", () => {
    void reader.cancel().catch(() => undefined);
  });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Serve one Node request through a Web API handler.
 *
 * The whole body is wrapped in try/catch, so the returned promise always
 * settles. `toNodeHandler` fires this without awaiting it, and a rejection
 * escaping here would surface as an unhandled rejection.
 */
async function handleNodeRequest(
  handler: (req: Request) => Promise<Response> | Response,
  req: NodeRequest,
  res: NodeResponse,
): Promise<void> {
  try {
    const request = toWebRequest(req);
    recordNodeIncomingRequestPeer(request, req);

    const response = await handler(request);
    if (response.status === 101) return;

    res.writeHead(response.status, toNodeHeaders(response));
    if (response.body) await pumpResponseBody(response.body, res);
    res.end();
  } catch (error) {
    serverLogger.debug("toNodeHandler request failed", { error });
    // Node ignores whatever a request listener returns, so a throw from this
    // handler surfaces as an unhandled rejection. Writing the head again
    // after it was already flushed is exactly that case, so only send the
    // error status while the head is still open.
    if (!res.headersSent) {
      res.writeHead(500);
      res.end("Internal Server Error");
    } else {
      // The status line is already on the wire, so the failure can no longer be
      // reported in it. Destroy rather than end(): ending would emit the final
      // chunk and the peer would read a truncated body as a complete 2xx.
      res.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
