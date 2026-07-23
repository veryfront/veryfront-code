import { NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";
import type {
  FileSystemAdapter,
  KVStoreAdapter,
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeId,
  RuntimeRequestHandler,
  ServeOptions,
  Server,
} from "../../base.ts";
import { CloudflareEnvironmentAdapter } from "./environment.ts";
import { CloudflareFileSystemAdapter } from "./filesystem.ts";
import { CloudflareKVStoreAdapter } from "./kv.ts";
import { CloudflareServerAdapter } from "./server.ts";
import type { CloudflareEnv, KVNamespace } from "./types.ts";

export interface CloudflareAdapterOptions {
  fileSystemNamespace?: KVNamespace;
  kvNamespace?: KVNamespace;
}

export class CloudflareAdapter<Env extends object = CloudflareEnv> implements RuntimeAdapter {
  readonly id: RuntimeId = "cloudflare";
  readonly name = "cloudflare";
  readonly fs: FileSystemAdapter;
  readonly env: CloudflareEnvironmentAdapter<Env>;
  readonly server = new CloudflareServerAdapter();
  readonly kv?: KVStoreAdapter;

  readonly capabilities: RuntimeCapabilities;

  constructor(
    env: Env,
    fileSystemNamespace?: KVNamespace,
    kvNamespace?: KVNamespace,
  ) {
    this.env = new CloudflareEnvironmentAdapter(env);
    this.fs = new CloudflareFileSystemAdapter(fileSystemNamespace);
    this.kv = kvNamespace ? new CloudflareKVStoreAdapter(kvNamespace) : undefined;
    this.capabilities = Object.freeze({
      typescript: false,
      jsx: false,
      http2: false,
      websocket: true,
      workers: false,
      fileWatching: false,
      shell: false,
      kvStore: this.kv !== undefined,
      // KV provides point writes but cannot safely implement coordinated
      // directory mutation, so it is not a complete writable filesystem.
      writableFs: false,
    });
  }

  async serve(
    _handler: RuntimeRequestHandler,
    _options: ServeOptions = {},
  ): Promise<Server> {
    throw NOT_SUPPORTED.create({
      message: "Cloudflare Workers receive requests through fetch handlers. Use createWorker().",
      context: { platform: "cloudflare", operation: "serve" },
    });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

export function createCloudflareAdapter<Env extends object>(
  env: Env,
  options: CloudflareAdapterOptions = {},
): CloudflareAdapter<Env> {
  return new CloudflareAdapter(env, options.fileSystemNamespace, options.kvNamespace);
}
