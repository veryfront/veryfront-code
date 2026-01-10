import type {
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeFeatures,
  ServeOptions,
  Server,
} from "../base.ts";
import { BunFileSystemAdapter } from "./filesystem-adapter.ts";
import { BunEnvironmentAdapter } from "./environment-adapter.ts";
import { BunServerAdapter } from "./websocket-adapter.ts";
import { createBunServer } from "./http-server.ts";
import { NodeBasedShellAdapter } from "../shared/node-based-shell-adapter.ts";

export class BunAdapter implements RuntimeAdapter {
  readonly id = "bun" as const;
  readonly name = "bun";
  /** @deprecated Use `id` instead */
  readonly platform = "bun" as const;

  fs = new BunFileSystemAdapter();
  env = new BunEnvironmentAdapter();
  server = new BunServerAdapter();
  shell = new NodeBasedShellAdapter();

  readonly capabilities: RuntimeCapabilities = {
    typescript: true,
    jsx: true,
    http2: false, // Bun's HTTP/2 support is experimental
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
