import type { ExecutionContext as _ExecutionContext } from "@veryfront/middleware/core/types.ts";
import type {
  FileSystemAdapter,
  RuntimeAdapter,
  RuntimeFeatures,
  ServeOptions,
  Server,
} from "../base.ts";
import { CloudflareEnvironmentAdapter } from "./environment.ts";
import { CloudflareFileSystemAdapter } from "./filesystem.ts";
import { CloudflareServer, CloudflareServerAdapter } from "./server.ts";
import { CloudflareShellAdapter } from "./shell.ts";
import type { CloudflareEnv, KVNamespace } from "./types.ts";

export class CloudflareAdapter implements RuntimeAdapter {
  name = "cloudflare";

  platform = "cloudflare" as const;

  fs: FileSystemAdapter;

  env: CloudflareEnvironmentAdapter;

  server = new CloudflareServerAdapter();

  shell = new CloudflareShellAdapter();

  features: RuntimeFeatures = {
    websocket: true,
    http2: true,
    workers: false,
    jsx: false,
    typescript: false,
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
}
