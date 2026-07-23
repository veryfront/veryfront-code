/**
 * Cross-runtime abstraction layer for adapter detection, process/env/signal
 * compat, filesystem and KV abstractions for Deno, Node.js, Bun, and
 * Cloudflare Workers.
 *
 * @module platform
 *
 * @example Detect and access the current runtime
 * ```ts
 * import { detectRuntimeEnvironment, runtime } from "veryfront/platform";
 *
 * const adapter = await runtime.get();
 * console.log(detectRuntimeEnvironment(), adapter.id);
 * ```
 */

// Adapters
export { getAdapter } from "./adapters/detect.ts";
export { getLocalAdapter, runtime } from "./adapters/registry.ts";
export { createMockAdapter } from "./adapters/mock.ts";
export type {
  RuntimeAdapter,
  RuntimeRequestHandler,
  RuntimeResponse,
  ServeOptions,
  Server,
} from "./adapters/base.ts";
export { createCloudflareAdapter, createWorker } from "./adapters/runtime/cloudflare/index.ts";
export type {
  CloudflareAdapterOptions,
  CloudflareEnv,
  CloudflarePipelineSource,
  CloudflareRequestPipeline,
  KVNamespace,
} from "./adapters/runtime/cloudflare/index.ts";
export type {
  CloudflareWorker,
  ExecutionContext as CloudflareExecutionContext,
} from "./adapters/runtime/cloudflare/index.ts";

// Compat: process
export {
  chdir,
  type CommandOptions,
  type CommandResult,
  cwd,
  deleteEnv,
  env,
  exit,
  getArgs,
  getEnv,
  getOsType,
  getRuntimeVersion,
  getStdout,
  getTerminalSize,
  isInteractive,
  isStdoutTTY,
  onGlobalError,
  onSignal,
  promptSync,
  readStdinByteSync,
  runCommand,
  setEnv,
  writeStdout,
  writeStdoutAsync,
} from "./compat/process.ts";

// Compat: filesystem
export {
  createFileSystem,
  exists,
  type FileSystem,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "./compat/fs.ts";

// Compat: stdin
export {
  createEscapeBuffer,
  getStdinReader,
  setRawMode,
  type StdinReader,
} from "./compat/stdin.ts";

// Compat: media types
export { lookup as lookupMimeType } from "./compat/media-types.ts";

// Compat: DNS
export {
  type DnsAddressRecordType,
  resolveHostAddresses,
  type ResolveHostAddressesOptions,
} from "./compat/dns.ts";

// Compat: KV store
export { createKVStore, KV_PORTABLE_LIMITS, MemoryKv, polyfillDenoKv } from "./compat/kv/index.ts";
export type {
  CreateKVStoreOptions,
  Kv,
  KvBackend,
  KvEntry,
  KvJsonValue,
  KvListOptions,
} from "./compat/kv/index.ts";

// Compat: runtime detection
export {
  type DetectedRuntime,
  detectRuntimeEnvironment,
  getDenoRuntime,
  isBun,
  isCloudflare,
  isDeno,
  isNode,
} from "./compat/runtime.ts";

// Adapters: filesystem
export { createFSAdapter, VeryfrontFSAdapter } from "./adapters/fs/index.ts";
export { enhanceAdapterWithFS, isExtendedFSAdapter } from "./adapters/fs/index.ts";

// Adapters: API client
export {
  DEFAULT_VERYFRONT_API_REQUEST_POLICY,
  type ListAllFilesOptions,
  RELEASE_ASSET_MAX_SIZE_BYTES,
  VeryfrontApiClient,
  type VeryfrontAPIConfig,
  type VeryfrontAPIRequestIdentity,
  type VeryfrontAPIRequestPolicy,
} from "./adapters/veryfront-api-client/index.ts";
