import * as dntShim from "../../../../../_dnt.shims.js";
import type { RuntimeAdapter, RuntimeCapabilities, ServeOptions, Server } from "../../base.js";
import { BunEnvironmentAdapter } from "./environment-adapter.js";
import { BunFileSystemAdapter } from "./filesystem-adapter.js";
import { createBunServer } from "./http-server.js";
import { BunServerAdapter } from "./websocket-adapter.js";
import { NodeBasedShellAdapter } from "../shared/node-based-shell-adapter.js";

export class BunAdapter implements RuntimeAdapter {
  readonly id = "bun" as const;
  readonly name = "bun";
  readonly fs = new BunFileSystemAdapter();
  readonly env = new BunEnvironmentAdapter();
  readonly server = new BunServerAdapter();
  readonly shell = new NodeBasedShellAdapter();

  readonly capabilities: RuntimeCapabilities = {
    typescript: true,
    jsx: true,
    http2: false,
    websocket: true,
    workers: true,
    fileWatching: true,
    shell: true,
    kvStore: false,
    writableFs: true,
  };

  private activeServer: Server | null = null;

  async serve(
    handler: (request: dntShim.Request) => Promise<dntShim.Response> | dntShim.Response,
    options: ServeOptions = {},
  ): Promise<Server> {
    const server = await createBunServer(handler, options);
    this.activeServer = server;
    return server;
  }

  async shutdown(): Promise<void> {
    const server = this.activeServer;
    if (!server) return;

    await server.stop();
    this.activeServer = null;
  }
}

export const bunAdapter = new BunAdapter();
