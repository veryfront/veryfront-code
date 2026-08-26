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
const universalObjectPrototype = Object.prototype;
const mapConstructor = Map;
const mapSet = Map.prototype.set;
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

function allSettled<T>(
  values: readonly (T | PromiseLike<T>)[],
): Promise<PromiseSettledResult<Awaited<T>>[]> {
  return reflectApply(promiseAllSettled, promiseConstructor, [values]) as Promise<
    PromiseSettledResult<Awaited<T>>[]
  >;
}

type AdapterLstat = NonNullable<RuntimeAdapter["fs"]["lstat"]>;
type AdapterRealPath = NonNullable<RuntimeAdapter["fs"]["realPath"]>;

/** Capture an optional filesystem method without trusting accessors or global pollution. */
function captureAdapterFsMethod<T extends AdapterLstat | AdapterRealPath>(
  fs: RuntimeAdapter["fs"],
  key: "lstat" | "realPath",
): T | undefined {
  let owner: object | null = fs;
  const visited = new Set<object>();

  try {
    for (let depth = 0; owner !== null && depth < 64; depth++) {
      if (owner === universalObjectPrototype || visited.has(owner)) return undefined;
      visited.add(owner);
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
  const expectedPaths = new Set([
    ...dependencies.localImportPaths.values(),
    ...dependencies.crossProjectPaths.values(),
  ]);
  if (expectedPaths.size === 0) return true;

  const cachedSpecifiers = new Set(
    (await parseImports(code)).map((entry) => entry.n).filter((entry): entry is string => !!entry),
  );
  return [...expectedPaths].every((path) => cachedSpecifiers.has(`file://${path}`));
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
    ) => Promise<ModuleCacheEntry>,
    private transformCrossProjectImport: (
      crossProjectImport: CrossProjectImport,
      signal?: AbortSignal,
    ) => Promise<string>,
    private adapter: RuntimeAdapter,
    private projectDir: string,
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
    const missingList = this.missingDependencies
      .map((m) => `  - ${m.specifier} (from ${m.fromFile.slice(-40)}): ${m.reason}`)
      .join("\n");

    logger.error("Missing dependencies detected", {
      file: filePath.slice(-60),
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
  ): Promise<ResolvedCachedDependencies> {
    throwIfAborted(signal);
    if (depth > MAX_TRANSFORM_DEPTH) {
      return { localImportPaths: createStringMap(), crossProjectPaths: createStringMap() };
    }

    const parseResult = await parseLocalImports(
      code,
      filePath,
      this.projectDir,
      this.adapter,
    );

    // Register CSS imports from cached modules for HTML inclusion
    for (const cssImport of parseResult.cssImports) {
      this.registerContainedCSSImport(cssImport);
    }

    if (parseResult.missing.length > 0) {
      this.missingDependencies.push(...parseResult.missing);
    }

    const localFs = createFileSystem();
    const localImportPaths = await this.processLocalImports(
      parseResult.imports,
      filePath,
      depth,
      localFs,
      createDependencyHashCache(),
      signal,
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
            this.missingDependencies.push({
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
  ): Promise<Map<string, string>> {
    throwIfAborted(signal);
    const importPathMap = createStringMap();

    for (let i = 0; i < imports.length; i += TRANSFORM_BATCH_SIZE) {
      const results = await allSettled(
        mapBatch(imports, i, i + TRANSFORM_BATCH_SIZE, async (imp) => {
          try {
            const depSource = await this.readLocalImportSource(imp, localFs);

            const depEntry = await this.transformWithDependencies(
              imp.resolvedPath ?? imp.requestedPath ?? imp.absolutePath,
              depSource,
              depth + 1,
              dependencyHashCache,
              signal,
              options,
            );

            setMapValue(
              importPathMap,
              imp.rewriteSpecifier ?? imp.specifier,
              depEntry.tempPath,
            );
            setMapValue(importPathMap, imp.specifier, depEntry.tempPath);
            setMapValue(importPathMap, imp.absolutePath, depEntry.tempPath);
          } catch (error) {
            throwIfAborted(signal);
            if (isTerminalHttpModuleFetchFailure(error)) throw error;
            this.missingDependencies.push({
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
    throw new Error("Contained project imports require a bound snapshot reader");
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
      cssImport.requestedPath,
      () => this.readLocalImportSource(cssImport, localFs),
    );
  }

  private readLocalImportSource(
    imported: LocalImport,
    localFs: ReturnType<typeof createFileSystem>,
  ): Promise<string> {
    const path = imported.absolutePath;
    if (imported.projectContained) return this.readProjectImportSource(path);
    if (this.isProjectAbsolutePath(path)) {
      return this.readProjectImportSource(path);
    }
    if (!isAbsolute(path)) return this.adapter.fs.readFile(path);

    return localFs.readTextFile(path);
  }
}
