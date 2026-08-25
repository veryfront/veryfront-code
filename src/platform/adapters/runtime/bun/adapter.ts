import type { RuntimeAdapter, RuntimeCapabilities } from "../../base.ts";
import { BunEnvironmentAdapter } from "./environment-adapter.ts";
import { BunFileSystemAdapter } from "./filesystem-adapter.ts";
import { createBunServer } from "./http-server.ts";
import { BunServerAdapter } from "./websocket-adapter.ts";
import { NodeBasedShellAdapter } from "../shared/node-based-shell-adapter.ts";
import { createServeHandler, ManagedServerRegistry } from "../shared/server-lifecycle.ts";

export class BunAdapter implements RuntimeAdapter {
  readonly id = "bun" as const;
  readonly name = "bun";
  readonly fs = new BunFileSystemAdapter();
  readonly env = new BunEnvironmentAdapter();
  readonly server = new BunServerAdapter();
  readonly shell = new NodeBasedShellAdapter();

  readonly capabilities: RuntimeCapabilities = Object.freeze({
    typescript: true,
    jsx: true,
    // `serve` wraps Bun.serve, which terminates HTTP/1.1 only. Flip this to
    // true only alongside a named Bun version that serves HTTP/2.
    http2: false,
    websocket: true,
    workers: true,
    fileWatching: true,
    shell: true,
    kvStore: false,
    writableFs: true,
  });

  private readonly servers = new ManagedServerRegistry();
  readonly serve = createServeHandler(
    createBunServer,
    this.servers,
  );

  shutdown(): Promise<void> {
    return this.servers.shutdown();
  }
}

export const bunAdapter = new BunAdapter();
