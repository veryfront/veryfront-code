import type { RuntimeAdapter, RuntimeCapabilities, ServeOptions, Server } from "../../base.ts";
import { NodeFileSystemAdapter } from "./filesystem-adapter.ts";
import { NodeEnvironmentAdapter } from "./environment-adapter.ts";
import { NodeServerAdapter } from "./websocket-adapter.ts";
import { createNodeServer } from "./http-server.ts";
import { NodeBasedShellAdapter } from "../shared/node-based-shell-adapter.ts";

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
    handler: (request: Request) => Promise<Response> | Response,
    options: ServeOptions = {},
  ): Promise<Server> {
    this.activeServer = await createNodeServer(handler, options);
    return this.activeServer;
  }

  async shutdown(): Promise<void> {
    if (this.activeServer) {
      await this.activeServer.stop();
      this.activeServer = null;
    }
  }
}

export const nodeAdapter = new NodeAdapter();
