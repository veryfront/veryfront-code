import * as dntShim from "../../../../../_dnt.shims.js";
import type { RuntimeAdapter, RuntimeCapabilities, ServeOptions, Server } from "../../base.js";
import { NodeFileSystemAdapter } from "./filesystem-adapter.js";
import { NodeEnvironmentAdapter } from "./environment-adapter.js";
import { NodeServerAdapter } from "./websocket-adapter.js";
import { createNodeServer } from "./http-server.js";
import { NodeBasedShellAdapter } from "../shared/node-based-shell-adapter.js";

export class NodeAdapter implements RuntimeAdapter {
  readonly id = "node" as const;
  readonly name = "node";
  readonly fs = new NodeFileSystemAdapter();
  readonly env = new NodeEnvironmentAdapter();
  readonly server = new NodeServerAdapter();
  readonly shell = new NodeBasedShellAdapter();

  readonly capabilities: RuntimeCapabilities = {
    typescript: false,
    jsx: false,
    http2: true,
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
    const server = await createNodeServer(handler, options);
    this.activeServer = server;
    return server;
  }

  async shutdown(): Promise<void> {
    const server = this.activeServer;
    if (!server) return;

    this.activeServer = null;
    await server.stop();
  }
}

export const nodeAdapter = new NodeAdapter();
