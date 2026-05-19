import { serverLogger } from "#veryfront/utils";

/** Convert a Web API request handler into a Node.js HTTP listener. */
export function toNodeHandler(
  handler: (req: Request) => Promise<Response> | Response,
): (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers[key] = value;
        else if (Array.isArray(value)) headers[key] = value[0] ?? "";
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
      res.writeHead(response.status, Object.fromEntries(response.headers));
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
