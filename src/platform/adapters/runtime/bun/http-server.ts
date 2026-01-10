import type { ServeOptions, Server } from "../../base.ts";
import type { BunServer as BunServerType } from "./types.ts";
import { DEFAULT_PORT } from "@veryfront/config";
import { serverLogger } from "@veryfront/utils";

export class BunServer implements Server {
  constructor(
    private server: BunServerType,
    private hostname: string,
    private port: number,
  ) {}

  stop(): Promise<void> {
    this.server.stop();
    return Promise.resolve();
  }

  get addr() {
    return { hostname: this.hostname, port: this.port };
  }
}

export function createBunServer(
  handler: (request: Request) => Promise<Response> | Response,
  options: ServeOptions = {},
): Promise<Server> {
  const { port = DEFAULT_PORT, hostname = "localhost", onListen } = options;

  const server = Bun.serve({
    port,
    hostname,
    async fetch(request: Request) {
      try {
        return await handler(request);
      } catch (error) {
        serverLogger.error("Request handler error:", error);
        return new Response("Internal Server Error", { status: 500 });
      }
    },
  });

  onListen?.({ hostname, port });

  return Promise.resolve(new BunServer(server, hostname, port));
}
