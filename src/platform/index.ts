/**
 * Cross-runtime abstraction layer — adapter detection, process/env/signal
 * compat, filesystem and KV abstractions for Deno, Node.js, and Bun.
 *
 * @module platform
 *
 * @example Inspect the current runtime
 * ```ts
 * import { getOsType, getRuntimeVersion } from "veryfront/platform";
 *
 * console.log(`${getOsType()} ${getRuntimeVersion()}`);
 * ```
 */

// Adapters
export { createMockAdapter } from "./adapters/mock.ts";
export type { RuntimeAdapter } from "./adapters/base.ts";

// Compat: process
export {
  type CommandResult,
  cwd,
  execPath,
  getArgs,
  getEnv,
  getOsType,
  getRuntimeVersion,
  getStdout,
  getTerminalSize,
  isInteractive,
  isStdoutTTY,
  promptSync,
  readStdinByteSync,
  writeStdout,
  writeStdoutAsync,
} from "./compat/process.ts";

// Compat: host runtime seam (live in production, in-memory in tests)
export {
  createInMemoryHostRuntime,
  HostExit,
  type HostRuntime,
  type HostRuntimeEnv,
  type HostSignal,
  type InMemoryHostRuntime,
  type InMemoryHostRuntimeInit,
  isHostExit,
} from "./compat/process/host-runtime.ts";

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
export { isDeno } from "./compat/runtime.ts";

// Adapters: filesystem
export { createFSAdapter, VeryfrontFSAdapter } from "./adapters/fs/index.ts";
export { enhanceAdapterWithFS, isExtendedFSAdapter } from "./adapters/fs/index.ts";

// Adapters: API client
export { VeryfrontApiClient } from "./adapters/veryfront-api-client/index.ts";
