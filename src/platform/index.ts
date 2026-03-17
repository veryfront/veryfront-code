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
  cwd,
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

// Compat: KV store
export { createKVStore, MemoryKv } from "./compat/kv/index.ts";

// Compat: runtime detection
export { isDeno } from "./compat/runtime.ts";

// Adapters: filesystem
export { createFSAdapter, VeryfrontFSAdapter } from "./adapters/fs/index.ts";

// Adapters: API client
export { VeryfrontApiClient } from "./adapters/veryfront-api-client/index.ts";
