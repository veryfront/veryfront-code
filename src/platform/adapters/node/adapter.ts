import type { RuntimeAdapter, RuntimeFeatures, ServeOptions, Server } from "../base.ts";
import { NodeFileSystemAdapter } from "./filesystem-adapter.ts";
import { NodeEnvironmentAdapter } from "./environment-adapter.ts";
import { NodeServerAdapter } from "./websocket-adapter.ts";
import { createNodeServer } from "./http-server.ts";

export class NodeAdapter implements RuntimeAdapter {
  name = "node";
  platform = "node" as const;
  fs = new NodeFileSystemAdapter();
  env = new NodeEnvironmentAdapter();
  server = new NodeServerAdapter();
  features: RuntimeFeatures = {
    websocket: true,
    http2: true,
    workers: true,
    jsx: false,
    typescript: false,
  };

  serve(
    handler: (request: Request) => Promise<Response> | Response,
    options: ServeOptions = {},
  ): Promise<Server> {
    return createNodeServer(handler, options);
  }
}

export const nodeAdapter = new NodeAdapter();
