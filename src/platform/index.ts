/**
 * Cross-runtime abstraction layer — adapter detection, process/env/signal
 * compat, filesystem and KV abstractions for Deno, Node.js, and Bun.
 *
 * @module platform
 */

// Adapters
export { getAdapter } from "./adapters/detect.ts";
export { getLocalAdapter, runtime } from "./adapters/registry.ts";
export { createMockAdapter } from "./adapters/mock.ts";
export type { RuntimeAdapter } from "./adapters/base.ts";

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
  getEnvNumber,
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
  isNotFoundError,
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
  readStdinLine,
  setRawMode,
  type StdinReader,
} from "./compat/stdin.ts";

// Compat: media types
export { lookup as lookupMimeType } from "./compat/media-types.ts";

// Compat: DNS
export { resolveHostAddresses, type ResolveHostAddressesOptions } from "./compat/dns.ts";

// Compat: KV store
export { createKVStore, MemoryKv } from "./compat/kv/index.ts";

// Compat: runtime detection
export { getDenoRuntime, isDeno } from "./compat/runtime.ts";

// Adapters: filesystem
export { createFSAdapter, VeryfrontFSAdapter } from "./adapters/fs/index.ts";
export { enhanceAdapterWithFS, isExtendedFSAdapter } from "./adapters/fs/index.ts";
export type {
  ContextualFSAdapter,
  StyleConfigBinding,
  StylePregenerationContext,
} from "./adapters/fs/index.ts";

// Cloudflare Workers require request-scoped bindings and therefore cannot use
// automatic runtime adapter construction.
export {
  CloudflareAdapter,
  createCloudflareAdapter,
  createWorker,
} from "./adapters/runtime/cloudflare/index.ts";
export type {
  CloudflareEnv,
  CloudflareRequestPipeline,
  ExecutionContext as CloudflareExecutionContext,
  KVNamespace as CloudflareKVNamespace,
} from "./adapters/runtime/cloudflare/index.ts";

// Adapters: API client
export {
  createStyleArtifactTuple,
  type ProjectStyleArtifactResolution,
  type StyleArtifactTuple,
  VeryfrontApiClient,
} from "./adapters/veryfront-api-client/index.ts";
