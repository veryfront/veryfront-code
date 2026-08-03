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
import { CloudflareServerAdapter } from "./server.ts";
import { CloudflareShellAdapter } from "./shell.ts";
import type { CloudflareEnv, KVNamespace } from "./types.ts";
import { NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";

export class CloudflareAdapter implements RuntimeAdapter {
  readonly id: RuntimeId = "cloudflare";
  readonly name = "cloudflare";
  readonly fs: FileSystemAdapter;
  readonly env: CloudflareEnvironmentAdapter;
  readonly server = new CloudflareServerAdapter();
  readonly shell = new CloudflareShellAdapter();

  readonly capabilities: RuntimeCapabilities;

  constructor(env: CloudflareEnv, kvNamespace?: KVNamespace) {
    this.env = new CloudflareEnvironmentAdapter(env);
    this.fs = new CloudflareFileSystemAdapter(kvNamespace);
    const hasKvNamespace = kvNamespace !== undefined;
    this.capabilities = Object.freeze({
      typescript: false,
      jsx: false,
      http2: true,
      websocket: true,
      workers: false,
      fileWatching: false,
      shell: false,
      kvStore: hasKvNamespace,
      writableFs: hasKvNamespace,
    });
  }

  async serve(
    _handler: (request: Request) => Promise<Response> | Response,
    _options: ServeOptions = {},
  ): Promise<Server> {
    throw NOT_SUPPORTED.create({
      detail:
        "Cloudflare Workers cannot open a listener; export a fetch handler with createWorker()",
      context: { platform: "cloudflare", operation: "serve" },
    });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

export function createCloudflareAdapter(
  env: CloudflareEnv,
  kvNamespace?: KVNamespace,
): CloudflareAdapter {
  return new CloudflareAdapter(env, kvNamespace);
}
