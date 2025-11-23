import type { RuntimeAdapter, RuntimeFeatures, ServeOptions, Server } from "../base.ts";
import { BunFileSystemAdapter } from "./filesystem-adapter.ts";
import { BunEnvironmentAdapter } from "./environment-adapter.ts";
import { BunServerAdapter } from "./websocket-adapter.ts";
import { createBunServer } from "./http-server.ts";

export class BunAdapter implements RuntimeAdapter {
  name = "bun";
  platform = "bun" as const;
  fs = new BunFileSystemAdapter();
  env = new BunEnvironmentAdapter();
  server = new BunServerAdapter();
  features: RuntimeFeatures = {
    websocket: true,
    http2: false,
    workers: true,
    jsx: true,
    typescript: true,
  };

  serve(
    handler: (request: Request) => Promise<Response> | Response,
    options: ServeOptions = {},
  ): Promise<Server> {
    return createBunServer(handler, options);
  }
}

export const bunAdapter = new BunAdapter();
