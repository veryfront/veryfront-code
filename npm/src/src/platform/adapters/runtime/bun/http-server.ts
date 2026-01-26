import * as dntShim from "../../../../../_dnt.shims.js";
import type { ServeOptions, Server } from "../../base.js";
import type { BunServer as BunServerType } from "./types.js";
import { DEFAULT_PORT } from "../../../../config/index.js";
import { serverLogger } from "../../../../utils/index.js";

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

  get addr(): { hostname: string; port: number } {
    return { hostname: this.hostname, port: this.port };
  }
}

export function createBunServer(
  handler: (request: dntShim.Request) => Promise<dntShim.Response> | dntShim.Response,
  options: ServeOptions = {},
): Promise<Server> {
  const { port = DEFAULT_PORT, hostname = "localhost", onListen } = options;

  const server = Bun.serve({
    port,
    hostname,
    fetch: async (request: dntShim.Request) => {
      try {
        return await handler(request);
      } catch (error) {
        serverLogger.error("Request handler error:", error);
        return new dntShim.Response("Internal Server Error", { status: 500 });
      }
    },
  });

  onListen?.({ hostname, port });

  return Promise.resolve(new BunServer(server, hostname, port));
}
