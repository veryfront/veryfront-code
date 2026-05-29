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
      for (const [key, value] of response.headers) {
        if (key.toLowerCase() === "set-cookie") continue;
        outHeaders[key] = value;
      }
      const setCookies = response.headers.getSetCookie();
      if (setCookies.length > 0) outHeaders["Set-Cookie"] = setCookies;
      res.writeHead(response.status, outHeaders);
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
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
