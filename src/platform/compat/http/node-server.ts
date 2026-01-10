import type { Handler, HttpServer, ServeOptions } from "./types.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";
import type {
  NodeHttpModule,
  NodeIncomingMessage,
  NodeServer,
  NodeServerResponse,
  NodeUrlModule,
} from "./node-types.ts";
import { convertNodeRequestToWebRequest } from "./request-adapter.ts";
import { LOCALHOST } from "@veryfront/config";

export class NodeHttpServer implements HttpServer {
  private http: NodeHttpModule | null = null;
  private url: NodeUrlModule | null = null;
  private server: NodeServer | null = null;

  private async initNodeModules(): Promise<void> {
    try {
      this.http = (await import("node:http")) as NodeHttpModule;
      this.url = (await import("node:url")) as NodeUrlModule;
    } catch (_error) {
      throw toError(createError({
        type: "not_supported",
        message: "Node.js http modules not available",
        feature: "Node.js",
      }));
    }
  }

  async serve(
    handler: Handler,
    options: ServeOptions = {},
  ): Promise<void> {
    if (!this.http) await this.initNodeModules();

    const { port = 8000, hostname = LOCALHOST.IPV4 } = options;

    this.server = this.http!.createServer(
      async (req: NodeIncomingMessage, res: NodeServerResponse) => {
        try {
          const url = new this.url!.URL(
            req.url || "/",
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
          res.statusCode = 500;
          res.end("Internal Server Error");
        }
      },
    );

    return new Promise((resolve, reject) => {
      this.server!.listen(port, hostname, () => {
        options.onListen?.({ hostname, port });
        resolve();
      });

      this.server!.on("error", reject);

      if (options.signal) {
        options.signal.addEventListener("abort", () => {
          this.server!.close();
        });
      }
    });
  }

  close(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          resolve();
        });
      });
    }
    return Promise.resolve();
  }
}
