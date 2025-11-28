import type { RuntimeAdapter, RuntimeCapabilities, RuntimeFeatures, ServeOptions, Server } from "../base.ts";
import { NodeFileSystemAdapter } from "./filesystem-adapter.ts";
import { NodeEnvironmentAdapter } from "./environment-adapter.ts";
import { NodeServerAdapter } from "./websocket-adapter.ts";
import { createNodeServer } from "./http-server.ts";

export class NodeAdapter implements RuntimeAdapter {
  readonly id = "node" as const;
  readonly name = "node";
  /** @deprecated Use `id` instead */
  readonly platform = "node" as const;

  fs = new NodeFileSystemAdapter();
  env = new NodeEnvironmentAdapter();
  server = new NodeServerAdapter();

  readonly capabilities: RuntimeCapabilities = {
    typescript: false, // Requires compilation
    jsx: false, // Requires compilation
    http2: true,
    websocket: true,
    workers: true,
    fileWatching: true,
    shell: true,
    kvStore: false,
    writableFs: true,
  };

  /** @deprecated Use `capabilities` instead */
  readonly features: RuntimeFeatures = {
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
