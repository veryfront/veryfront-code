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
 *
 * @example Pin project dependencies
 * ```ts
 * import { VeryfrontApiClient } from "veryfront/platform";
 *
 * const client = new VeryfrontApiClient({
 *   apiBaseUrl: "https://api.veryfront.com",
 *   apiToken: "<API_KEY>",
 *   projectSlug: "<PROJECT_SLUG>",
 * });
 *
 * const { pins, persisted, skipped } = await client.dependencies.resolve({
 *   specifiers: ["react@^19", "zod"],
 *   branch: "main",
 * });
 * console.log(pins, persisted, skipped);
 *
 * await client.initialize();
 * const history = await client.dependencies.getHistory({ branch: "main" });
 * console.log(history.entries.length);
 * ```
 *
 * @example Read the files an environment serves
 * ```ts
 * import { VeryfrontApiClient } from "veryfront/platform";
 *
 * const client = new VeryfrontApiClient({
 *   apiBaseUrl: "https://api.veryfront.com",
 *   apiToken: "<API_KEY>",
 *   projectSlug: "<PROJECT_SLUG>",
 * });
 *
 * const files = await client.listAllEnvironmentFiles("production");
 * console.log(files.map((file) => file.path));
 *
 * const page = await client.getEnvironmentFile("production", "app/page.tsx");
 * console.log(page.release_version);
 *
 * const lookup = await client.lookupProjectByDomain("www.example.com");
 * console.log(lookup?.project_slug, lookup?.environment?.name);
 * ```
 */

// Adapters
export { createMockAdapter } from "./adapters/mock.ts";
export type { RuntimeAdapter } from "./adapters/base.ts";
export type {
  DependencySnapshotRecord,
  DependencySnapshotStore,
  DependencySnapshotStoreHandle,
} from "./adapters/dependency-snapshot-store.ts";
export { createDependencySnapshotStoreHandle } from "./adapters/dependency-snapshot-store.ts";

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
export {
  type DependencyMetadataHistory,
  type DependencyMetadataHistoryEntry,
  type DependencyResolution,
  type DependencySkipReason,
  type GetDependencyHistoryInput,
  type GetStyleArtifactInput,
  type ResolveDependenciesInput,
  type StartStyleArtifactBuildInput,
  type StyleArtifact,
  type StyleArtifactSelector,
  type UpdateStyleArtifactInput,
  VeryfrontApiClient,
  type VeryfrontApiDependencies,
  type VeryfrontApiStyleArtifacts,
} from "./adapters/veryfront-api-client/index.ts";
