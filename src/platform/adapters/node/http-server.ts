import type { ServeOptions, Server } from "../base.ts";
import type { NodeHttpServer } from "./types.ts";
import { DEFAULT_DEV_PORT } from "@veryfront/config";

export class NodeServer implements Server {
  constructor(
    private server: NodeHttpServer,
    private hostname: string,
    private port: number,
  ) {}

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  get addr() {
    return { hostname: this.hostname, port: this.port };
  }
}

export async function createNodeServer(
  handler: (request: Request) => Promise<Response> | Response,
  options: ServeOptions = {},
): Promise<Server> {
  const { port = DEFAULT_DEV_PORT, hostname = "localhost", onListen } = options;
  const { createServer } = await import("node:http");

  const server = createServer(async (_req, _res) => {
    try {
      const url = new URL(_req.url || "/", `http://${_req.headers.host || hostname}`);
      const body = _req.method === "GET" || _req.method === "HEAD" ? null : _req;

      const headersRecord: Record<string, string> = {};
      for (const [key, value] of Object.entries(_req.headers)) {
        if (typeof value === "string") {
          headersRecord[key] = value;
        } else if (Array.isArray(value)) {
          headersRecord[key] = value[0] || "";
        }
      }

      const request = new Request(url.toString(), {
        method: _req.method,
        headers: headersRecord,
        body: body as BodyInit | null,
      });

      const response = await handler(request);

      _res.statusCode = response.status;
      _res.statusMessage = response.statusText;

      response.headers.forEach((value, key) => {
        _res.setHeader(key, value);
      });

      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          _res.write(value);
        }
      }

      _res.end();
    } catch (_error) {
      const { serverLogger } = await import("@veryfront/utils");
      serverLogger.error("Request handler error:", _error);
      _res.statusCode = 500;
      _res.end("Internal Server Error");
    }
  });

  if (options.signal) {
    options.signal.addEventListener("abort", () => {
      server.close();
    });
  }

  return new Promise((resolve) => {
    server.listen(port, hostname, () => {
      onListen?.({ hostname, port });
      resolve(new NodeServer(server as unknown as NodeHttpServer, hostname, port));
    });
  });
}
