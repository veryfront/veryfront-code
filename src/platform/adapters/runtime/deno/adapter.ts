import type { RuntimeAdapter, RuntimeCapabilities } from "../../base.ts";
import { DenoEnvironmentAdapter } from "./environment-adapter.ts";
import { DenoFileSystemAdapter } from "./filesystem-adapter.ts";
import { createDenoServer } from "./http-server.ts";
import { DenoShellAdapter } from "./shell-adapter.ts";
import { DenoServerAdapter } from "./websocket-adapter.ts";
import { createServeHandler, ManagedServerRegistry } from "../shared/server-lifecycle.ts";

export class DenoAdapter implements RuntimeAdapter {
  readonly id = "deno" as const;
  readonly name = "deno";
  readonly fs = new DenoFileSystemAdapter();
  readonly env = new DenoEnvironmentAdapter();
  readonly server = new DenoServerAdapter();
  readonly shell = new DenoShellAdapter();

  readonly capabilities: RuntimeCapabilities = Object.freeze({
    typescript: true,
    jsx: true,
    http2: true,
    websocket: true,
    workers: true,
    fileWatching: true,
    shell: true,
    kvStore: true,
    writableFs: true,
  });

  private readonly servers = new ManagedServerRegistry();
  readonly serve = createServeHandler(
    createDenoServer,
    this.servers,
  );

  shutdown(): Promise<void> {
    return this.servers.shutdown();
  }
}

export const denoAdapter = new DenoAdapter();
