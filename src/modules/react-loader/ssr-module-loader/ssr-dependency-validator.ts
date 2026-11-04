/**
 * SSR Dependency Validator
 *
 * Validates and processes local and cross-project dependencies for SSR modules.
 * Handles pre-flight checks, recursive dependency resolution, and missing dependency reporting.
 *
 * @module module-system/react-loader/ssr-module-loader/ssr-dependency-validator
 */

import type {
  CrossProjectImport,
  LocalImport,
  MissingImport,
} from "#veryfront/transforms/esm/import-parser.ts";
import { parseLocalImports } from "#veryfront/transforms/esm/import-parser.ts";
import { parseImports } from "#veryfront/transforms/esm/lexer.ts";
import { registerCSSImport } from "../css-import-collector.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { isAbsolute } from "#veryfront/platform/compat/path/index.ts";
import { BUILD_FAILED, createError, toError, VeryfrontError } from "#veryfront/errors";
import { rendererLogger, throwIfAborted } from "#veryfront/utils";
import { sanitizePathForDisplay } from "#veryfront/security";
import { fnv1aHash } from "#veryfront/utils/hash-utils.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  type CapturedSnapshotReader,
  captureSnapshotReadCapability,
} from "#veryfront/platform/adapters/file-system-capabilities.ts";
import { MAX_TRANSFORM_DEPTH, TRANSFORM_BATCH_SIZE } from "./constants.ts";
import type { ModuleCacheEntry } from "./types.ts";
import {
  createDependencyHashCache,
  type DependencyHashCache,
} from "#veryfront/cache/dependency-graph.ts";

const logger = rendererLogger.component("ssr-module-loader");

/** Ceiling for one dependency source admitted through the bound snapshot read. */
const MAX_LOCAL_IMPORT_SOURCE_BYTES = 16 * 1024 * 1024;

const reflectApply = Reflect.apply;
const promiseConstructor = Promise;
const promiseAllSettled = Promise.allSettled;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const symbolIterator: typeof Symbol.iterator = Symbol.iterator;
const universalObjectPrototype = Object.prototype;
const arrayJoin = Array.prototype.join;
const arrayPush = Array.prototype.push;
const mapConstructor = Map;
const mapForEach = Map.prototype.forEach;
const mapDelete = Map.prototype.delete;
const mapGet = Map.prototype.get;
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!;
const mapSet = Map.prototype.set;
const setConstructor = Set;
const setAdd = Set.prototype.add;
const setForEach = Set.prototype.forEach;
const setHas = Set.prototype.has;
const weakSetConstructor = WeakSet;
const weakSetAdd = WeakSet.prototype.add;
const weakSetHas = WeakSet.prototype.has;
const stringIndexOf = String.prototype.indexOf;
const stringSlice = String.prototype.slice;
const stringStartsWith = String.prototype.startsWith;
// Match ordinary adapter text reads: malformed UTF-8 is replaced rather than
// turning an otherwise present dependency into a missing import.
const utf8Decoder = new TextDecoder("utf-8");
const decodeUtf8 = TextDecoder.prototype.decode;

function decodeDependencySource(bytes: Uint8Array): string {
  return reflectApply(decodeUtf8, utf8Decoder, [bytes]) as string;
}

function sliceString(value: string, start: number, end?: number): string {
  return reflectApply(stringSlice, value, end === undefined ? [start] : [start, end]) as string;
}

function startsWithString(value: string, prefix: string): boolean {
  return reflectApply(stringStartsWith, value, [prefix]) as boolean;
}

function createStringMap(): Map<string, string> {
  return new mapConstructor<string, string>();
}

function setMapValue(map: Map<string, string>, key: string, value: string): void {
  reflectApply(mapSet, map, [key, value]);
}

function pushArrayValue<T>(values: T[], value: T): void {
  reflectApply(arrayPush, values, [value]);
}

function joinStringArray(values: readonly string[], separator: string): string {
  return reflectApply(arrayJoin, values, [separator]) as string;
}

/** Files from the render root to the current module, in import order. */
export type ImportChain = readonly string[];

function extendImportChain(chain: ImportChain, path: string): string[] {
  const extended: string[] = [];
  for (let index = 0; index < chain.length; index++) extended[index] = chain[index]!;
  extended[chain.length] = path;
  return extended;
}

/** Project-relative so build errors never show machine paths. */
function formatImportChain(chain: ImportChain, projectDir: string): string {
  const displayed: string[] = [];
  for (let index = 0; index < chain.length; index++) {
    displayed[index] = sanitizePathForDisplay(chain[index]!, projectDir);
  }
  return joinStringArray(displayed, " -> ");
}

const circularImportErrors = new weakSetConstructor<object>();

function circularImportError(chain: ImportChain, projectDir: string): Error {
  const error = toError(
    createError({
      type: "build",
      message: `Circular import is not supported in SSR: ${formatImportChain(chain, projectDir)}`,
      context: { file: chain[chain.length - 1], phase: "dependency-resolution" },
    }),
  );
  reflectApply(weakSetAdd, circularImportErrors, [error]);
  return error;
}

function isCircularImportError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    reflectApply(weakSetHas, circularImportErrors, [error]) as boolean;
}

/** @internal exported for the loader */
export function importChainTooLongError(
  filePath: string,
  depth: number,
  chain: ImportChain,
  projectDir: string,
): Error {
  return toError(
    createError({
      type: "build",
      message: `Max transform depth exceeded (${MAX_TRANSFORM_DEPTH}, depth=${depth}) for ` +
        `${sanitizePathForDisplay(filePath, projectDir)}. ` +
        `Import chain: ${formatImportChain(chain, projectDir)}`,
      context: { file: filePath, phase: "transform" },
    }),
  );
}

/**
 * Imports whose dependency transform is still pending, as importer ->
 * dependency -> count, per import graph scope. Concurrent transforms of one
 * scope share in-progress work, so a cycle can span two transforms whose own
 * import chains each look acyclic: A waits on B's transform while B waits on
 * A's. An import that would close a loop in this graph is such a cycle.
 * Nodes are module versions, not paths: during a hot edit an old `A -> B`
 * transform and a new `B -> A` transform are separate work, not a cycle.
 */
const activeImportEdges = new mapConstructor<string, Map<string, Map<string, number>>>();

/**
 * One version of one module in the pending-import graph.
 *
 * @internal exported for the loader
 */
export function importGraphNode(path: string, source: string): string {
  return `${path}\0${source.length}:${fnv1aHash(source)}`;
}

function importGraphNodePath(node: string): string {
  const end = reflectApply(stringIndexOf, node, ["\0"]) as number;
  return end < 0 ? node : sliceString(node, 0, end);
}

function scopeEdges(scope: string): Map<string, Map<string, number>> {
  let edges = reflectApply(mapGet, activeImportEdges, [scope]) as
    | Map<string, Map<string, number>>
    | undefined;
  if (!edges) {
    edges = new mapConstructor<string, Map<string, number>>();
    reflectApply(mapSet, activeImportEdges, [scope, edges]);
  }
  return edges;
}

/** The pending import path from `from` to `to`, or undefined. */
function findActiveImportPath(scope: string, from: string, to: string): string[] | undefined {
  const edges = reflectApply(mapGet, activeImportEdges, [scope]) as
    | Map<string, Map<string, number>>
    | undefined;
  if (!edges) return undefined;
  const visited = new setConstructor<string>();
  const search = (node: string, path: string[]): string[] | undefined => {
    if (node === to) return path;
    if (reflectApply(setHas, visited, [node])) return undefined;
    reflectApply(setAdd, visited, [node]);
    const next = reflectApply(mapGet, edges, [node]) as Map<string, number> | undefined;
    if (!next) return undefined;
    let found: string[] | undefined;
    reflectApply(mapForEach, next, [(_count: number, dependency: string) => {
      if (!found) found = search(dependency, extendImportChain(path, dependency));
    }]);
    return found;
  };
  return search(from, [from]);
}

function addActiveImportEdge(scope: string, importer: string, dependency: string): () => void {
  const edges = scopeEdges(scope);
  let dependencies = reflectApply(mapGet, edges, [importer]) as Map<string, number> | undefined;
  if (!dependencies) {
    dependencies = new mapConstructor<string, number>();
    reflectApply(mapSet, edges, [importer, dependencies]);
  }
  const count = (reflectApply(mapGet, dependencies, [dependency]) as number | undefined) ?? 0;
  reflectApply(mapSet, dependencies, [dependency, count + 1]);
  const pending = dependencies;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (reflectApply(mapGet, pending, [dependency]) as number) - 1;
    if (remaining > 0) {
      reflectApply(mapSet, pending, [dependency, remaining]);
      return;
    }
    reflectApply(mapDelete, pending, [dependency]);
    if (reflectApply(mapSize, pending, []) === 0) reflectApply(mapDelete, edges, [importer]);
    if (reflectApply(mapSize, edges, []) === 0) {
      reflectApply(mapDelete, activeImportEdges, [scope]);
    }
  };
}

function mapBatch<T, U>(
  values: readonly T[],
  start: number,
  end: number,
  callback: (value: T, index: number) => U,
): U[] {
  const mapped: U[] = [];
  let limit = end;
  if (limit > values.length) limit = values.length;
  for (let index = start; index < limit; index++) {
    mapped[index - start] = callback(values[index]!, index);
  }
  return mapped;
}

function indexedIterable<T>(values: readonly T[]): Iterable<T> {
  return {
    [symbolIterator]() {
      let index = 0;
      return {
        next(): IteratorResult<T> {
          if (index >= values.length) return { done: true, value: undefined };
          const value = values[index]!;
          index++;
          return { done: false, value };
        },
      };
    },
  };
}

function allSettled<T>(
  values: readonly (T | PromiseLike<T>)[],
): Promise<PromiseSettledResult<Awaited<T>>[]> {
  return reflectApply(promiseAllSettled, promiseConstructor, [indexedIterable(values)]) as Promise<
    PromiseSettledResult<Awaited<T>>[]
  >;
}

function ownDataValue(value: unknown, key: PropertyKey): unknown {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) return undefined;
  try {
    const descriptor = objectGetOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function ownStringValue(value: unknown, key: PropertyKey): string | undefined {
  const ownValue = ownDataValue(value, key);
  return typeof ownValue === "string" ? ownValue : undefined;
}

type AdapterLstat = NonNullable<RuntimeAdapter["fs"]["lstat"]>;
type AdapterRealPath = NonNullable<RuntimeAdapter["fs"]["realPath"]>;

/** Capture an optional filesystem method without trusting accessors or global pollution. */
function captureAdapterFsMethod<T extends AdapterLstat | AdapterRealPath>(
  fs: RuntimeAdapter["fs"],
  key: "lstat" | "realPath",
): T | undefined {
  let owner: object | null = fs;
  const visited: object[] = [];

  try {
    for (let depth = 0; owner !== null && depth < 64; depth++) {
      if (owner === universalObjectPrototype) return undefined;
      for (let index = 0; index < visited.length; index++) {
        if (visited[index] === owner) return undefined;
      }
      visited[visited.length] = owner;
      const descriptor = objectGetOwnPropertyDescriptor(owner, key);
      if (descriptor !== undefined) {
        return "value" in descriptor && typeof descriptor.value === "function"
          ? descriptor.value as T
          : undefined;
      }
      owner = objectGetPrototypeOf(owner);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export interface ResolvedCachedDependencies {
  localImportPaths: Map<string, string>;
  crossProjectPaths: Map<string, string>;
}

export interface DependencyTransformCacheOptions {
  skipDistributedCache?: boolean;
  skipMdxPathCache?: boolean;
}

/**
 * Whether cached transformed code points at every dependency output produced
 * from the current source tree.
 *
 * Dependency module paths include their transformed-content hash. A parent
 * whose source is unchanged can therefore retain an old child path across a
 * dev-server restart even though that old file still exists. Validate actual
 * import specifiers, not arbitrary strings or file existence, before reusing
 * the parent.
 */
export async function cachedCodeUsesResolvedDependencies(
  code: string,
  dependencies: ResolvedCachedDependencies,
): Promise<boolean> {
  const expectedPaths = new setConstructor<string>();
  let expectedPathCount = 0;
  const recordExpectedPath = (path: string): void => {
    if (reflectApply(setHas, expectedPaths, [path]) as boolean) return;
    reflectApply(setAdd, expectedPaths, [path]);
    expectedPathCount++;
  };
  reflectApply(mapForEach, dependencies.localImportPaths, [recordExpectedPath]);
  reflectApply(mapForEach, dependencies.crossProjectPaths, [recordExpectedPath]);
  if (expectedPathCount === 0) return true;

  const cachedSpecifiers = new setConstructor<string>();
  const parsedImports = await parseImports(code);
  for (let index = 0; index < parsedImports.length; index++) {
    const specifier = ownStringValue(parsedImports[index]!, "n");
    if (specifier) reflectApply(setAdd, cachedSpecifiers, [specifier]);
  }
  let complete = true;
  reflectApply(setForEach, expectedPaths, [
    (path: string) => {
      if (!(reflectApply(setHas, cachedSpecifiers, [`file://${path}`]) as boolean)) {
        complete = false;
      }
    },
  ]);
  return complete;
}

function isTerminalHttpModuleFetchFailure(error: unknown): error is VeryfrontError {
  if (!(error instanceof VeryfrontError) || error.slug !== BUILD_FAILED.slug) return false;
  const context = error.context;
  return typeof context === "object" && context !== null &&
    (context as { phase?: unknown }).phase === "http-module-fetch";
}

/**
 * Pick the rejection a settled dependency batch should propagate.
 *
 * Both batch loops catch everything except a terminal HTTP module fetch
 * failure, so today every rejection is that failure. Select on the predicate
 * rather than on "first rejection" so a throw added outside either try block
 * later cannot be mistaken for the terminal failure — and fall back to the
 * first rejection so such a throw is still propagated rather than dropped.
 */
function selectPropagatedFailure(
  results: PromiseSettledResult<unknown>[],
): PromiseRejectedResult | undefined {
  let firstRejection: PromiseRejectedResult | undefined;
  let index = 0;
  while (index < results.length) {
    const result = results[index]!;
    index++;
    if (result.status !== "rejected") continue;
    firstRejection ??= result;
    if (isTerminalHttpModuleFetchFailure(result.reason)) return result;
  }
  return firstRejection;
}

/**
 * Manages dependency validation for SSR module loading:
 * - Pre-flight checks for local file existence
 * - Recursive dependency resolution
 * - Missing dependency collection and error reporting
 */
export class SSRDependencyValidator {
  /** Accumulated missing dependencies across the transform tree. */
  missingDependencies: MissingImport[] = [];

  /** Bound, no-follow snapshot read capability captured from the adapter. */
  private readonly projectSnapshotReader?: CapturedSnapshotReader;
  /** The adapter's own contract that its paths cannot traverse symlinks. */
  private readonly symlinkFreeFs: boolean;
  /** Authenticated optional methods used to canonicalize stable in-project links. */
  private readonly projectLstat?: AdapterLstat;
  private readonly projectRealPath?: AdapterRealPath;

  constructor(
    private transformWithDependencies: (
      filePath: string,
      source: string | undefined,
      depth: number,
      dependencyHashCache: DependencyHashCache,
      signal?: AbortSignal,
      options?: DependencyTransformCacheOptions,
      importChain?: ImportChain,
    ) => Promise<ModuleCacheEntry>,
    private transformCrossProjectImport: (
      crossProjectImport: CrossProjectImport,
      signal?: AbortSignal,
    ) => Promise<string>,
    private adapter: RuntimeAdapter,
    private projectDir: string,
    /** Modules that share in-progress transforms share a scope. */
    private importGraphScope: string = projectDir,
  ) {
    // Symlink-free semantics are authority, so only an own data property
    // counts, exactly as FSAdapterWrapper captures it: an inherited value
    // must not bypass the bound snapshot read below.
    const semantics = objectGetOwnPropertyDescriptor(adapter.fs, "symlinkSemantics");
    this.symlinkFreeFs = semantics !== undefined && "value" in semantics &&
      semantics.value === "none";
    this.projectSnapshotReader = captureSnapshotReadCapability(
      adapter.fs,
      "SSR dependency filesystem",
      // FSAdapterWrapper publishes absent optional capabilities as frozen
      // `undefined` own properties; treat that as unsupported, not malformed.
      true,
    );
    this.projectLstat = captureAdapterFsMethod<AdapterLstat>(adapter.fs, "lstat");
    this.projectRealPath = captureAdapterFsMethod<AdapterRealPath>(adapter.fs, "realPath");
  }

  /** Reset missing dependencies for a new load cycle. */
  reset(): void {
    this.missingDependencies = [];
  }

  /**
   * Throw a structured error with all accumulated missing dependencies.
   */
  throwMissingDependencies(filePath: string): never {
    const missingLines: string[] = [];
    for (let index = 0; index < this.missingDependencies.length; index++) {
      const missing = this.missingDependencies[index]!;
      pushArrayValue(
        missingLines,
        `  - ${missing.specifier} (from ${sliceString(missing.fromFile, -40)}): ${missing.reason}`,
      );
    }
    const missingList = joinStringArray(missingLines, "\n");

    logger.error("Missing dependencies detected", {
      file: sliceString(filePath, -60),
      missing: this.missingDependencies.length,
      details: this.missingDependencies,
    });

    throw toError(
      createError({
        type: "build",
        message: `Component has missing dependencies:\n${missingList}`,
        context: {
          file: filePath,
          phase: "dependency-resolution",
          missing: this.missingDependencies,
        },
      }),
    );
  }

  /**
   * Ensure all dependencies of a cached module exist by recursively
   * processing local imports and cross-project imports.
   */
  async ensureDependenciesExist(
    code: string,
    filePath: string,
    depth: number = 0,
    signal?: AbortSignal,
    importChain: ImportChain = [filePath],
    importerNode: string = importGraphNode(filePath, code),
  ): Promise<ResolvedCachedDependencies> {
    throwIfAborted(signal);
    // Returning no dependencies here would let a cached module pass
    // validation with an unchecked import tree.
    if (depth > MAX_TRANSFORM_DEPTH) {
      throw importChainTooLongError(filePath, depth, importChain, this.projectDir);
    }

    const parseResult = await parseLocalImports(
      code,
      filePath,
      this.projectDir,
      this.adapter,
    );

    // Register CSS imports from cached modules for HTML inclusion
    for (let index = 0; index < parseResult.cssImports.length; index++) {
      this.registerContainedCSSImport(parseResult.cssImports[index]!);
    }

    if (parseResult.missing.length > 0) {
      for (let index = 0; index < parseResult.missing.length; index++) {
        pushArrayValue(this.missingDependencies, parseResult.missing[index]!);
      }
    }

    const localFs = createFileSystem();
    const localImportPaths = await this.processLocalImports(
      parseResult.imports,
      filePath,
      depth,
      localFs,
      createDependencyHashCache(),
      signal,
      undefined,
      importChain,
      importerNode,
    );

    const crossProjectPaths = await this.processCrossProjectImports(
      parseResult.crossProjectImports,
      filePath,
      signal,
    );
    throwIfAborted(signal);
    return { localImportPaths, crossProjectPaths };
  }

  /**
   * Process cross-project imports in batches, building a map of
   * specifier -> temp file path.
   *
   * Non-terminal failures are aggregated into {@link missingDependencies} so the
   * caller can report every unresolved specifier at once. A terminal HTTP module
   * fetch failure is rethrown untouched instead: it means the source could not be
   * retrieved at all, so reporting it as a missing dependency would mislabel a
   * transient network failure as a broken component.
   */
  async processCrossProjectImports(
    crossProjectImports: CrossProjectImport[],
    filePath: string,
    signal?: AbortSignal,
  ): Promise<Map<string, string>> {
    throwIfAborted(signal);
    const crossProjectPaths = createStringMap();

    for (let i = 0; i < crossProjectImports.length; i += TRANSFORM_BATCH_SIZE) {
      const results = await allSettled(
        mapBatch(crossProjectImports, i, i + TRANSFORM_BATCH_SIZE, async (crossImport) => {
          try {
            const tempPath = await this.transformCrossProjectImport(crossImport, signal);
            setMapValue(crossProjectPaths, crossImport.specifier, tempPath);
          } catch (error) {
            throwIfAborted(signal);
            if (isTerminalHttpModuleFetchFailure(error)) throw error;
            pushArrayValue(this.missingDependencies, {
              specifier: crossImport.specifier,
              fromFile: filePath,
              reason: `Failed to fetch cross-project import: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
          }
        }),
      );
      const failure = selectPropagatedFailure(results);
      if (failure) throw failure.reason;
      throwIfAborted(signal);
    }

    return crossProjectPaths;
  }

  /**
   * Process local imports in batches, recursively transforming dependencies
   * and building a map of specifier -> temp file path.
   */
  async processLocalImports(
    imports: LocalImport[],
    fromFilePath: string,
    depth: number,
    localFs: ReturnType<typeof createFileSystem>,
    dependencyHashCache: DependencyHashCache,
    signal?: AbortSignal,
    options?: DependencyTransformCacheOptions,
    importChain: ImportChain = [fromFilePath],
    importerNode: string = fromFilePath,
  ): Promise<Map<string, string>> {
    throwIfAborted(signal);
    const importPathMap = createStringMap();

    for (let i = 0; i < imports.length; i += TRANSFORM_BATCH_SIZE) {
      const results = await allSettled(
        mapBatch(imports, i, i + TRANSFORM_BATCH_SIZE, async (imp) => {
          try {
            const resolvedPath = ownStringValue(imp, "resolvedPath");
            const requestedPath = ownStringValue(imp, "requestedPath");
            const depPath = resolvedPath ?? requestedPath ?? imp.absolutePath;
            const depChain = extendImportChain(importChain, depPath);
            const depSource = await this.readLocalImportSource(imp, localFs);
            const depNode = importGraphNode(depPath, depSource);
            // A module's output path is derived from its dependencies' output
            // paths, so a module that reaches its importer through pending
            // imports would wait on itself. Pending imports include every
            // ancestor's edge, so this also covers the module's own chain.
            // Check and register in one synchronous step, so two transforms
            // closing the same loop cannot both pass the check.
            const pendingLoop = findActiveImportPath(this.importGraphScope, depNode, importerNode);
            if (pendingLoop) {
              let cycle: string[] = [];
              for (let index = 0; index < pendingLoop.length; index++) {
                cycle = extendImportChain(cycle, importGraphNodePath(pendingLoop[index]!));
              }
              throw circularImportError(extendImportChain(cycle, depPath), this.projectDir);
            }
            const releaseImportEdge = addActiveImportEdge(
              this.importGraphScope,
              importerNode,
              depNode,
            );

            let depEntry: ModuleCacheEntry;
            try {
              depEntry = await this.transformWithDependencies(
                depPath,
                depSource,
                depth + 1,
                dependencyHashCache,
                signal,
                options,
                depChain,
              );
            } finally {
              releaseImportEdge();
            }

            setMapValue(
              importPathMap,
              ownStringValue(imp, "rewriteSpecifier") ?? imp.specifier,
              depEntry.tempPath,
            );
            setMapValue(importPathMap, imp.specifier, depEntry.tempPath);
            setMapValue(importPathMap, imp.absolutePath, depEntry.tempPath);
          } catch (error) {
            throwIfAborted(signal);
            if (isTerminalHttpModuleFetchFailure(error)) throw error;
            // A cycle must reject the shared transform for every waiter, not
            // only for the loader that happened to detect it.
            if (isCircularImportError(error)) throw error;
            pushArrayValue(this.missingDependencies, {
              specifier: imp.specifier,
              fromFile: fromFilePath,
              reason: `Failed to load dependency: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
          }
        }),
      );
      const failure = selectPropagatedFailure(results);
      if (failure) throw failure.reason;
      throwIfAborted(signal);
    }

    return importPathMap;
  }

  private isProjectAbsolutePath(path: string): boolean {
    let projectDirEnd = this.projectDir.length;
    while (projectDirEnd > 0 && this.projectDir[projectDirEnd - 1] === "/") projectDirEnd--;
    const projectDir = sliceString(this.projectDir, 0, projectDirEnd);
    if (!projectDir || projectDir === "/") return false;
    return path === projectDir || startsWithString(path, `${projectDir}/`);
  }

  /**
   * Read an approved in-project dependency without trusting the path twice.
   *
   * Import containment approves a canonical pathname, but on a native
   * filesystem the file or one of its parents can be replaced with a symlink
   * between that approval and this read. The captured snapshot capability
   * binds the two: it re-verifies no-follow containment beneath the project
   * root atomically with the read, so a link retargeted outside the project
   * is refused instead of followed. A filesystem whose own contract rules out
   * symlink traversal cannot be retargeted, so its plain read is already
   * bound; adapters providing neither authority keep the direct read they
   * always had.
   */
  private async readProjectImportSource(path: string): Promise<string> {
    if (this.symlinkFreeFs) return await this.adapter.fs.readFile(path);
    if (this.projectSnapshotReader) {
      const bytes = await this.projectSnapshotReader.read(
        await this.canonicalizeProjectImportPath(path),
        this.projectDir,
        MAX_LOCAL_IMPORT_SOURCE_BYTES,
      );
      return decodeDependencySource(bytes);
    }
    return await this.adapter.fs.readFile(path);
  }

  /**
   * Resolve a stable in-project symlink to its canonical target before the
   * no-follow snapshot read, which refuses any terminal symbolic link.
   * Containment stays enforced by the snapshot read itself: it re-verifies
   * the handed path beneath the project root, so a link whose target escapes
   * the project is still refused rather than followed. Anything uncertain --
   * an adapter without lstat or realPath authority, a vanished path, a broken
   * link -- keeps the original path so the bound read stays the sole arbiter.
   */
  private async canonicalizeProjectImportPath(path: string): Promise<string> {
    if (!this.projectLstat || !this.projectRealPath) return path;
    try {
      const info = await (reflectApply(this.projectLstat, this.adapter.fs, [path]) as ReturnType<
        AdapterLstat
      >);
      if (!info.isSymlink) return path;
      return await (reflectApply(this.projectRealPath, this.adapter.fs, [path]) as ReturnType<
        AdapterRealPath
      >);
    } catch {
      return path;
    }
  }

  /** Register CSS with a read that revalidates containment at consumption. */
  registerContainedCSSImport(cssImport: LocalImport): void {
    const localFs = createFileSystem();
    registerCSSImport(
      cssImport.absolutePath,
      ownStringValue(cssImport, "requestedPath"),
      () => this.readLocalImportSource(cssImport, localFs),
    );
  }

  private readLocalImportSource(
    imported: LocalImport,
    localFs: ReturnType<typeof createFileSystem>,
  ): Promise<string> {
    const path = imported.absolutePath;
    if (ownDataValue(imported, "projectContained") === true) {
      return this.readProjectImportSource(path);
    }
    if (this.isProjectAbsolutePath(path)) {
      return this.readProjectImportSource(path);
    }
    if (!isAbsolute(path)) return this.adapter.fs.readFile(path);

    return localFs.readTextFile(path);
  }
}
