import type {
  FileSystemAdapter,
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeId,
  ServeOptions,
  Server,
} from "../../base.ts";
import { CloudflareEnvironmentAdapter } from "./environment.ts";
import { CloudflareFileSystemAdapter } from "./filesystem.ts";
import { CloudflareServer, CloudflareServerAdapter } from "./server.ts";
import { CloudflareShellAdapter } from "./shell.ts";
import type { CloudflareEnv, KVNamespace } from "./types.ts";

export class CloudflareAdapter implements RuntimeAdapter {
  readonly id: RuntimeId = "cloudflare";
  readonly name = "cloudflare";
  readonly fs: FileSystemAdapter;
  readonly env: CloudflareEnvironmentAdapter;
  readonly server = new CloudflareServerAdapter();
  readonly shell = new CloudflareShellAdapter();

  readonly capabilities: RuntimeCapabilities = {
    typescript: false,
    jsx: false,
    http2: true,
    websocket: true,
    workers: false,
    fileWatching: false,
    shell: false,
    kvStore: true,
    writableFs: false,
  };

  constructor(env: CloudflareEnv, kvNamespace?: KVNamespace) {
    this.env = new CloudflareEnvironmentAdapter(env);
    this.fs = new CloudflareFileSystemAdapter(kvNamespace);
  }

  serve(
    _handler: (request: Request) => Promise<Response> | Response,
    _options: ServeOptions = {},
  ): Promise<Server> {
    return Promise.resolve(new CloudflareServer());
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
