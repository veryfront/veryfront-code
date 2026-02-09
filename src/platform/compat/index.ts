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
export { createKVStore, MemoryKv, openKv, polyfillDenoKv } from "./kv/index.ts";
export { SqliteKv } from "./kv/index.ts";
export type { Kv, KvEntry, KvListOptions, SqliteDatabase } from "./kv/index.ts";

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

// Compat: runtime detection
export {
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
