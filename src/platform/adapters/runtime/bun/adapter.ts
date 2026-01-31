import type { RuntimeAdapter, RuntimeCapabilities, ServeOptions, Server } from "../../base.ts";
import { BunEnvironmentAdapter } from "./environment-adapter.ts";
import { BunFileSystemAdapter } from "./filesystem-adapter.ts";
import { createBunServer } from "./http-server.ts";
import { BunServerAdapter } from "./websocket-adapter.ts";
import { NodeBasedShellAdapter } from "../shared/node-based-shell-adapter.ts";

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
    handler: (request: Request) => Promise<Response> | Response,
    options: ServeOptions = {},
  ): Promise<Server> {
    const server = await createBunServer(handler, options);
    this.activeServer = server;
    return server;
  }

  async shutdown(): Promise<void> {
    if (!this.activeServer) return;

    await this.activeServer.stop();
    this.activeServer = null;
  }
}

export const bunAdapter = new BunAdapter();
