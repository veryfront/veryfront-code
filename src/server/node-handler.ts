import { serverLogger } from "#veryfront/utils";

/** Convert a Web API request handler into a Node.js HTTP listener. */
export function toNodeHandler(
  handler: (req: Request) => Promise<Response> | Response,
): (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void {
  return async (req, res) => {
    try {
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

      const response = await handler(new Request(url.toString(), init));

      if (response.status === 101) return;
      const outHeaders: Record<string, string | string[]> = {};
      const setCookies: string[] = [];
      // Headers.prototype.getSetCookie landed in Node ~18.14, but our published
      // engines.node is ">=18.0.0". On early 18.x it is undefined, so calling it
      // unconditionally throws for every response and turns valid requests into
      // 500s. Feature-detect it and fall back to the header iterator.
      const getSetCookie = response.headers.getSetCookie;
      if (typeof getSetCookie === "function") {
        // Modern path: getSetCookie returns each Set-Cookie as a distinct value.
        setCookies.push(...getSetCookie.call(response.headers));
        for (const [key, value] of response.headers) {
          if (key.toLowerCase() === "set-cookie") continue;
          outHeaders[key] = value;
        }
      } else {
        // Fallback for runtimes without getSetCookie. The undici-based Headers
        // iterator yields each Set-Cookie as its own entry (it is the one header
        // that is NOT comma-joined during iteration), so iterating preserves
        // multiples where the platform allows it. If a runtime does collapse
        // them into a single comma-joined string we still pass that one value
        // through unchanged rather than throwing — degrade gracefully, never 500.
        for (const [key, value] of response.headers) {
          if (key.toLowerCase() === "set-cookie") {
            setCookies.push(value);
            continue;
          }
          outHeaders[key] = value;
        }
      }
      if (setCookies.length > 0) outHeaders["Set-Cookie"] = setCookies;
      res.writeHead(response.status, outHeaders);
      if (response.body) {
        const reader = response.body.getReader();
        res.on("close", () => reader.cancel().catch(() => undefined));
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
      res.end();
    } catch (error) {
      serverLogger.debug("toNodeHandler request failed", { error });
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  };
}
