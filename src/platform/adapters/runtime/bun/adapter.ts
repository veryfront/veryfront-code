import type { RuntimeAdapter, RuntimeCapabilities, Server } from "../../base.ts";
import { BunEnvironmentAdapter } from "./environment-adapter.ts";
import { BunFileSystemAdapter } from "./filesystem-adapter.ts";
import { createBunServer } from "./http-server.ts";
import { BunServerAdapter } from "./websocket-adapter.ts";
import { NodeBasedShellAdapter } from "../shared/node-based-shell-adapter.ts";
import { createServeHandler, stopManagedServer } from "../shared/server-lifecycle.ts";

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
  readonly serve = createServeHandler(
    createBunServer,
    (server) => {
      this.activeServer = server;
    },
  );

  async shutdown(): Promise<void> {
    this.activeServer = await stopManagedServer(this.activeServer);
  }
}

export const bunAdapter = new BunAdapter();
