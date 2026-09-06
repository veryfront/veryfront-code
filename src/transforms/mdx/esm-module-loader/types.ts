import type { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { Logger } from "#veryfront/utils";
import type { MDXModule } from "../types.ts";
import type { DependencyPinningSourceInput } from "#veryfront/transforms/esm/package-registry.ts";
import type { DeferredImportErrorDescriptor } from "./utils/stub-module.ts";
import type { ModuleSourceCapture } from "#veryfront/transforms/esm/module-source-capture.ts";

export interface ESMLoaderContext {
  esmCacheDir?: string;
  moduleCache: LRUCache<string, MDXModule>;
  adapter?: RuntimeAdapter;
  projectId?: string;
  projectDir?: string;
  projectSlug?: string;
  contentSourceId?: string;
  /** Server-trusted local-project identity for dev-only module-server fallback. */
  isLocalProject?: boolean;
  /**
   * Compile mode for the `/_vf_modules/*` imports of this entry. It decides
   * minification, tree shaking and inline sourcemaps, and it is part of every
   * module cache identity. Absent means production, so a caller that cannot
   * name a render mode gets production output.
   */
  mode?: "development" | "production";
  /** React version for transforms (from project config) */
  reactVersion?: string;
  /** Bare npm package roots that the runtime resolves without bundling. */
  serverExternalPackages?: readonly string[];
  /** Absolute request origin used to identify same-origin module URLs. */
  moduleServerOrigin?: string;
  /** Request-scoped dependency-pinning state used to isolate module caches. */
  dependencyPinningCacheKey?: string;
  /** Immutable package map paired with dependencyPinningCacheKey. */
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  /** Exact package source namespace used to prove write-back authority. */
  dependencyPinningSource?: DependencyPinningSourceInput;
  /**
   * If true, missing modules fail fast instead of being stubbed.
   * Defaults to true when not specified.
   */
  strictMissingModules?: boolean;
}

/** Compilation inputs without a host-owned cache of evaluated modules. */
export type MdxPreparationContext = Omit<ESMLoaderContext, "moduleCache">;

export interface FSAdapter {
  readFile(path: string): Promise<string | Uint8Array>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  stat(path: string): Promise<{ isFile?: boolean } | null>;
  makeTempDir(prefix: string): Promise<string>;
}

interface ImportMatch {
  original: string;
  path: string;
  start: number;
  end: number;
}

interface ModuleFetchResult {
  original: string;
  filePath: string | null;
  path: string;
}

export interface NestedImportResult {
  original: string;
  start: number;
  end: number;
  isDynamic?: boolean;
  isSideEffect?: boolean;
  suffix?: string;
  nestedFilePath: string | null;
  deferredError?: DeferredImportErrorDescriptor;
  nestedPath?: string;
  relativePath?: string;
}

export interface ModuleFetcherContext {
  /** Borrowed capture for generation preparation; returned paths identify captured sources. */
  sourceCapture?: ModuleSourceCapture;
  /** Completed source bindings retained only for this capture's lifetime. */
  capturedModules?: Map<string, string>;
  esmCacheDir: string;
  adapter: RuntimeAdapter;
  projectDir: string;
  projectId: string;
  contentSourceId?: string;
  projectSlug?: string;
  isLocalProject?: boolean;
  /**
   * Tracks modules currently being processed to detect circular imports.
   * Key: normalized module path, Value: promise resolving to cached path.
   * This prevents infinite recursion when A imports B which imports A.
   */
  inFlightModules?: Map<string, Promise<string | null>>;
  /** Unique normalized modules admitted to this request-scoped graph. */
  moduleGraph?: Set<string>;
  /**
   * Compile fetched modules in development mode. Defaults to false so a caller
   * that cannot name a render mode gets production output, and it is part of
   * every module cache identity because it changes the emitted code.
   */
  dev?: boolean;
  /** React version for transforms (from project config) */
  reactVersion?: string;
  /** Bare npm package roots that the runtime resolves without bundling. */
  serverExternalPackages?: readonly string[];
  /** Absolute request origin used to identify same-origin module URLs. */
  moduleServerOrigin?: string;
  /** Request-scoped dependency-pinning state used to isolate module caches. */
  dependencyPinningCacheKey?: string;
  /** Immutable package map paired with dependencyPinningCacheKey. */
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  /** Exact package source namespace used to prove write-back authority. */
  dependencyPinningSource?: DependencyPinningSourceInput;
  /** Logger with request-scoped context (project_id, project_slug, requestId, etc.) */
  logger?: Logger;
  /**
   * If true, missing modules fail fast instead of being stubbed.
   * Defaults to true when not specified.
   */
  strictMissingModules?: boolean;
  /**
   * Deadline timestamp (Date.now() + timeout) for the entire transform tree.
   * If not set, defaults to TRANSFORM_TREE_TIMEOUT_MS from the first fetchAndCacheModule call.
   * Prevents infinite recursion from causing pod hangs.
   */
  transformDeadline?: number;
}

interface JSXTransform {
  original: string;
  transformed: string;
}
