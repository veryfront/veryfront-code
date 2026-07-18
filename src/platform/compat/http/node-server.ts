import type { Handler, HttpServer, ServeOptions } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import type {
  NodeHttpModule,
  NodeIncomingMessage,
  NodeServer,
  NodeServerResponse,
  NodeUrlModule,
} from "./node-types.ts";
import { convertNodeRequestToWebRequest } from "./request-adapter.ts";
import { LOCALHOST } from "../constants.ts";

export class NodeHttpServer implements HttpServer {
  private http: NodeHttpModule | null = null;
  private url: NodeUrlModule | null = null;
  private server: NodeServer | null = null;

  private async initNodeModules(): Promise<void> {
    try {
      this.http = (await import("node:http")) as NodeHttpModule;
      this.url = (await import("node:url")) as NodeUrlModule;
    } catch (_) {
      /* expected: node:http/node:url not available in non-Node runtimes */
      throw toError(
        createError({
          type: "not_supported",
          message: "Node.js http modules not available",
          feature: "Node.js",
        }),
      );
    }
  }

  async serve(handler: Handler, options: ServeOptions = {}): Promise<void> {
    if (!this.http || !this.url) {
      await this.initNodeModules();
    }

    const { port = 8000, hostname = LOCALHOST.IPV4 } = options;
    const http = this.http!;
    const urlModule = this.url!;

    this.server = http.createServer(
      async (req: NodeIncomingMessage, res: NodeServerResponse) => {
        try {
          const url = new urlModule.URL(
            req.url ?? "/",
            `http://${hostname}:${port}`,
          );

          const request = convertNodeRequestToWebRequest(req, url.toString());
          const response = await handler(request);

          res.statusCode = response.status;

          for (const [name, value] of response.headers) {
            res.setHeader(name, value);
          }

          if (response.body) {
            const reader = response.body.getReader();

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
          }

          res.end();
        } catch (_error) {
          /* Request handler error - respond with 500 */
          res.statusCode = 500;
          res.end("Internal Server Error");
        }
      },
    );

    const server = this.server;

    return new Promise((resolve, reject) => {
      server.listen(port, hostname, () => {
        options.onListen?.({ hostname, port });
        resolve();
      });

      server.on("error", reject);

      options.signal?.addEventListener("abort", () => {
        server.close();
      }, { once: true });
    });
  }

  close(): Promise<void> {
    const server = this.server;
    if (!server) return Promise.resolve();

    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  }
}
