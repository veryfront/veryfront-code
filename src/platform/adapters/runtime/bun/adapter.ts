import type { RuntimeAdapter, RuntimeCapabilities } from "../../base.ts";
import { BunEnvironmentAdapter } from "./environment-adapter.ts";
import { BunFileSystemAdapter } from "./filesystem-adapter.ts";
import { createBunServer } from "./http-server.ts";
import { BunServerAdapter } from "./websocket-adapter.ts";
import { NodeBasedShellAdapter } from "../shared/node-based-shell-adapter.ts";
import { createServerLifecycle } from "../shared/server-lifecycle.ts";

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
    http2: false,
    websocket: true,
    workers: true,
    fileWatching: true,
    shell: true,
    kvStore: false,
    writableFs: true,
  });

  private readonly serverLifecycle = createServerLifecycle(createBunServer);
  readonly serve = this.serverLifecycle.serve;

  shutdown(): Promise<void> {
    return this.serverLifecycle.shutdown();
  }
}

export const bunAdapter = new BunAdapter();
