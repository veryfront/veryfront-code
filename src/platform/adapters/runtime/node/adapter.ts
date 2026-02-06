import type { RuntimeAdapter, RuntimeCapabilities, Server } from "../../base.ts";
import { NodeFileSystemAdapter } from "./filesystem-adapter.ts";
import { NodeEnvironmentAdapter } from "./environment-adapter.ts";
import { NodeServerAdapter } from "./websocket-adapter.ts";
import { createNodeServer } from "./http-server.ts";
import { NodeBasedShellAdapter } from "../shared/node-based-shell-adapter.ts";
import { createServeHandler, stopManagedServer } from "../shared/server-lifecycle.ts";

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
  readonly serve = createServeHandler(
    createNodeServer,
    (server) => {
      this.activeServer = server;
    },
  );

  async shutdown(): Promise<void> {
    this.activeServer = await stopManagedServer(this.activeServer);
  }
}

export const nodeAdapter = new NodeAdapter();
