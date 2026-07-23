/**
 * Platform Compat
 *
 * @module platform/compat
 */

// Compat: filesystem
export {
  createFileSystem,
  exists,
  type FileSystem,
  isNotFoundError,
  makeTempDir,
  mkdir,
  readDir,
  readTextFile,
  remove,
  stat,
  symlink,
  writeFile,
  writeTextFile,
} from "./fs.ts";

// Compat: KV store
export { createKVStore, KV_PORTABLE_LIMITS, MemoryKv, openKv, polyfillDenoKv } from "./kv/index.ts";
export { SqliteKv } from "./kv/index.ts";
export type {
  CreateKVStoreOptions,
  Kv,
  KvBackend,
  KvEntry,
  KvJsonValue,
  KvListOptions,
  OpenKvOptions,
  SqliteDatabase,
} from "./kv/index.ts";

// Compat: process
export {
  chdir,
  cwd,
  deleteEnv,
  env,
  execPath,
  exit,
  getArgs,
  getEnv,
  getEnvBoolean,
  getEnvNumber,
  getEnvOverlayStorage,
  getEnvString,
  getOsType,
  getRuntimeVersion,
  getStdout,
  getTerminalSize,
  isInteractive,
  isStdoutTTY,
  memoryUsage,
  onGlobalError,
  onSignal,
  pid,
  promptSync,
  runCommand,
  setEnv,
  unrefTimer,
  uptime,
  writeStdout,
  writeStdoutAsync,
} from "./process.ts";
export type { CommandOptions, CommandResult, EnvBooleanOptions } from "./process.ts";

// Compat: DNS
export {
  type DnsAddressRecordType,
  resolveHostAddresses,
  type ResolveHostAddressesOptions,
} from "./dns.ts";

// Compat: media types
export { charset, contentType, extension, lookup as lookupMimeType } from "./media-types.ts";

// Compat: native Web Crypto
export { createCrypto, type CryptoCompat } from "./crypto.ts";

// Compat: runtime detection
export {
  type DetectedRuntime,
  detectRuntimeEnvironment,
  detectRuntimeFromHost,
  getDenoRuntime,
  isBrowserEnvironment,
  isBun,
  isCloudflare,
  isDeno,
  isDenoCompiled,
  isNode,
  isNodeRuntime,
  isServerEnvironment,
} from "./runtime.ts";

// Compat: stdin
export {
  createEscapeBuffer,
  type EscapeBuffer,
  getStdinReader,
  setRawMode,
  type StdinReader,
  waitForEnterOrExit,
  waitForKeypress,
} from "./stdin.ts";

// Compat: dynamic import helper (hides specifiers from static analysis / deno compile)
export { dynamicImport } from "./dynamic-import.ts";

// Compat: dynamic imports for optional deps (opaque) and platform-split deps (kreuzberg)
export { importClaudeAgentSDK, importKreuzberg, importTransformers } from "./opaque-deps.ts";

// Compat: path
export {
  basename,
  dirname,
  extname,
  fromFileUrl,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "./path/index.ts";
