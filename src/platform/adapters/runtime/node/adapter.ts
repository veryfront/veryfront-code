import type { RuntimeAdapter, RuntimeCapabilities } from "../../base.ts";
import { NodeFileSystemAdapter } from "./filesystem-adapter.ts";
import { NodeEnvironmentAdapter } from "./environment-adapter.ts";
import { NodeServerAdapter } from "./websocket-adapter.ts";
import { createNodeServer } from "./http-server.ts";
import { NodeBasedShellAdapter } from "../shared/node-based-shell-adapter.ts";
import { createServeHandler, ManagedServerRegistry } from "../shared/server-lifecycle.ts";

export class NodeAdapter implements RuntimeAdapter {
  readonly id = "node" as const;
  readonly name = "node";
  readonly fs = new NodeFileSystemAdapter();
  readonly env = new NodeEnvironmentAdapter();
  readonly server = new NodeServerAdapter();
  readonly shell = new NodeBasedShellAdapter();

  readonly capabilities: RuntimeCapabilities = Object.freeze({
    typescript: false,
    jsx: false,
    http2: true,
    websocket: true,
    workers: true,
    fileWatching: true,
    shell: true,
    kvStore: false,
    writableFs: true,
  });

  private readonly servers = new ManagedServerRegistry();
  readonly serve = createServeHandler(
    createNodeServer,
    this.servers,
  );

  shutdown(): Promise<void> {
    return this.servers.shutdown();
  }
}

export const nodeAdapter = new NodeAdapter();
