/**
 * Import Transformer
 *
 * Functions for rewriting and transforming import specifiers in MDX compiled code.
 * Handles project aliases, React paths, JSX transforms, and import map resolution.
 *
 * @module build/transforms/mdx/esm-module-loader/import-transformer
 */

import { join } from "#veryfront/compat/path";
import {
  primordialArrayPush,
  primordialArrayValues,
} from "#veryfront/platform/compat/primordials/array.ts";
import { SERVER_ONLY_IN_CLIENT } from "#veryfront/errors";
import type { ImportMapConfig } from "#veryfront/modules/import-map/index.ts";
import { transformImportsWithMap } from "#veryfront/modules/import-map/index.ts";
import { Semaphore } from "#veryfront/modules/react-loader/ssr-module-loader/concurrency/semaphore.ts";
import {
  captureBoundedTextReader,
  copyFixedUint8ArrayWithinLimit,
  getFixedUint8ArrayByteLength,
} from "#veryfront/platform/adapters/bounded-text-reader.ts";
import { captureFileSystemCapabilities } from "#veryfront/platform/adapters/file-system-capabilities.ts";
import { unrefTimer } from "#veryfront/platform/compat/process.ts";
import { getLocalReactPaths, isReactSpecifier } from "#veryfront/platform/compat/react-paths.ts";
import { sanitizePathForDisplay } from "#veryfront/security/path-validation.ts";
import type { DependencyPinningSourceInput } from "#veryfront/transforms/esm/package-registry.ts";
import type { DependencyResolutionObservation } from "#veryfront/transforms/import-rewriter/dependency-resolution.ts";
import { assertNoConfiguredCommonJsBrowserImports } from "#veryfront/transforms/import-rewriter/commonjs-policy.ts";
import {
  bareStrategy,
  UnifiedImportRewriter,
} from "#veryfront/transforms/import-rewriter/index.ts";
import type { ImportRewriteStrategy } from "#veryfront/transforms/import-rewriter/index.ts";
import { isNodeBuiltinSpecifier } from "#veryfront/transforms/import-rewriter/node-builtins.ts";
import { appendSameOriginSSRDependencyPinningPathKey } from "#veryfront/transforms/import-rewriter/url-builder.ts";
import {
  describeServerExternalBrowserViolation,
  getConfiguredServerExternalPackage,
} from "#veryfront/transforms/shared/server-only-packages.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { parallelMap } from "#veryfront/utils/parallel.ts";
import {
  primordialPromiseAll,
  primordialPromiseCatch,
  primordialPromiseFinally,
  primordialPromiseResolve,
  primordialPromiseThen,
} from "#veryfront/platform/compat/primordials/promise.ts";
import { isWithinDirectory } from "#veryfront/utils/path-utils.ts";
import { parseImports, replaceSpecifiers } from "../../esm/lexer.ts";
import {
  ESBUILD_JSX_FACTORY,
  ESBUILD_JSX_FRAGMENT,
  FRAMEWORK_ROOT,
  isFrameworkSourceFile,
  LOG_PREFIX_MDX_LOADER,
} from "./constants.ts";
import { getLocalFs } from "./cache/index.ts";
import { buildMdxJsxCacheFileName } from "./cache-format.ts";
import { rewriteDntImports } from "./module-fetcher/index.ts";
import {
  assertMdxModuleImportCount,
  assertMdxModuleSourceSize,
  MAX_MDX_MODULE_CODE_BYTES,
  MAX_MDX_MODULE_TRANSFORM_CONCURRENCY,
  ModuleSourceLimitError,
  utf8ByteLength,
} from "./module-fetcher/limits.ts";
import {
  ensureCachedJsxModulePatched,
  ensureJsxCacheSweepArmed,
  JSX_CACHE_VARIANT_MIN_AGE_MS,
  JsxCacheCapacityError,
  markJsxArtifactServed,
  pruneSupersededJsxArtifacts,
  refreshJsxArtifactMtime,
  refreshJsxArtifactsBounded,
  withJsxArtifactLock,
  withJsxArtifactWriteCapacity,
} from "#veryfront/transforms/mdx/esm-module-loader/jsx-cache.ts";
import type { ESMLoaderContext } from "./types.ts";

const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z\d+.-]*:/;
const JSX_SOURCE_EXTENSION_PATTERN = /\.(tsx?|jsx?)$/;
const IntrinsicMap = Map;
const IntrinsicSet = Set;
const hostNow = Date.now;
const dateGetTime = Function.prototype.call.bind(Date.prototype.getTime);
const IntrinsicReflectApply = Reflect.apply;
const RegExpPrototypeExec = RegExp.prototype.exec;
const StringPrototypeEndsWith = String.prototype.endsWith;
const StringPrototypeIncludes = String.prototype.includes;
const StringPrototypeLastIndexOf = String.prototype.lastIndexOf;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeStartsWith = String.prototype.startsWith;
const TextDecoderPrototypeDecode = TextDecoder.prototype.decode;
const IntrinsicObjectCreate = Object.create;
const IntrinsicObjectDefineProperty = Object.defineProperty;
const IntrinsicObjectEntries = Object.entries;
const IntrinsicObjectKeys = Object.keys;
const MapPrototypeGet = Map.prototype.get;
const MapPrototypeSet = Map.prototype.set;
const MapSizeGetter = Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!;
const SetPrototypeAdd = Set.prototype.add;
const SetPrototypeDelete = Set.prototype.delete;
const SetPrototypeForEach = Set.prototype.forEach;
const hostClearInterval = globalThis.clearInterval.bind(globalThis);
const hostSetInterval = globalThis.setInterval.bind(globalThis);

function mapGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  return IntrinsicReflectApply(MapPrototypeGet, map, [key]) as V | undefined;
}

function mapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  IntrinsicReflectApply(MapPrototypeSet, map, [key, value]);
}

function mapSize<K, V>(map: Map<K, V>): number {
  return IntrinsicReflectApply(MapSizeGetter, map, []) as number;
}

function defineOwnDataProperty<T extends object>(
  target: T,
  key: PropertyKey,
  value: unknown,
): void {
  const descriptor = IntrinsicObjectCreate(null) as PropertyDescriptor;
  descriptor.configurable = true;
  descriptor.enumerable = true;
  descriptor.value = value;
  descriptor.writable = true;
  IntrinsicObjectDefineProperty(target, key, descriptor);
}

function stringStartsWith(value: string, search: string): boolean {
  return IntrinsicReflectApply(StringPrototypeStartsWith, value, [search]) as boolean;
}

function stringEndsWith(value: string, search: string): boolean {
  return IntrinsicReflectApply(StringPrototypeEndsWith, value, [search]) as boolean;
}

function stringIncludes(value: string, search: string): boolean {
  return IntrinsicReflectApply(StringPrototypeIncludes, value, [search]) as boolean;
}

function stringSlice(value: string, start: number, end?: number): string {
  return IntrinsicReflectApply(StringPrototypeSlice, value, [start, end]) as string;
}

function pathBaseName(value: string): string {
  const slash = IntrinsicReflectApply(StringPrototypeLastIndexOf, value, ["/"]) as number;
  const backslash = IntrinsicReflectApply(StringPrototypeLastIndexOf, value, ["\\"]) as number;
  return stringSlice(value, (slash > backslash ? slash : backslash) + 1);
}

function setAdd<T>(set: Set<T>, value: T): void {
  IntrinsicReflectApply(SetPrototypeAdd, set, [value]);
}

function setDelete<T>(set: Set<T>, value: T): boolean {
  return IntrinsicReflectApply(SetPrototypeDelete, set, [value]) as boolean;
}

function setValues<T>(set: Set<T>): T[] {
  const values: T[] = [];
  IntrinsicReflectApply(SetPrototypeForEach, set, [(value: T) => {
    primordialArrayPush(values, value);
  }]);
  return values;
}

const mdxRootBareDependencyStrategy: ImportRewriteStrategy = {
  name: "mdx-root-bare-dependency",
  priority: bareStrategy.priority,
  matches(specifier, ctx) {
    const hasNonNpmScheme = IntrinsicReflectApply(
          RegExpPrototypeExec,
          URI_SCHEME_PATTERN,
          [specifier],
        ) !== null &&
      !stringStartsWith(specifier, "npm:");
    return !hasNonNpmScheme &&
      !isNodeBuiltinSpecifier(specifier) &&
      bareStrategy.matches(specifier, ctx);
  },
  rewrite(info, ctx) {
    return bareStrategy.rewrite(info, ctx);
  },
};

const mdxRootDependencyRewriter = new UnifiedImportRewriter({
  strategies: [mdxRootBareDependencyStrategy],
});

/**
 * Rewrite @/ aliased imports to /_vf_modules/ paths.
 */
export async function rewriteProjectAliasImports(code: string): Promise<string> {
  return await replaceSpecifiers(code, (specifier) => {
    if (!stringStartsWith(specifier, "@/")) return null;
    const path = stringSlice(specifier, 2);
    const jsPath = stringEndsWith(path, ".js") ? path : `${path}.js`;
    return `/_vf_modules/${jsPath}`;
  });
}

/**
 * Transform bare React specifiers to local file:// paths for Bun/Node.
 * This ensures the same React instance as react-dom-server.
 * For Deno, getLocalReactPaths() returns an empty object, so this is a no-op.
 */
export async function transformReactToLocalPaths(code: string): Promise<string> {
  const localPaths = getLocalReactPaths();
  if (IntrinsicObjectKeys(localPaths).length === 0) return code;

  return await replaceSpecifiers(code, (specifier) => localPaths[specifier] || null);
}

function stripReactFromImportMap(importMap: ImportMapConfig): ImportMapConfig {
  const imports = importMap.imports ? { ...importMap.imports } : undefined;
  if (imports) {
    for (const key of primordialArrayValues(IntrinsicObjectKeys(imports))) {
      if (isReactSpecifier(key)) delete imports[key];
    }
  }

  let scopes: Record<string, Record<string, string>> | undefined;
  if (importMap.scopes) {
    scopes = {};
    for (const entry of primordialArrayValues(IntrinsicObjectEntries(importMap.scopes))) {
      const scope = entry[0];
      const filtered = { ...entry[1] };
      for (const key of primordialArrayValues(IntrinsicObjectKeys(filtered))) {
        if (isReactSpecifier(key)) delete filtered[key];
      }
      defineOwnDataProperty(scopes, scope, filtered);
    }
  }

  return { imports, scopes };
}

/**
 * Transform imports using project import maps.
 * React is intentionally left as a bare specifier for SSR consistency.
 */
export function transformImports(code: string, importMap: ImportMapConfig): string {
  return transformImportsWithMap(code, stripReactFromImportMap(importMap), undefined, {
    resolveBare: true,
  });
}

export interface MdxRootDependencyRewriteOptions {
  projectDir: string;
  projectId: string;
  reactVersion: string;
  dependencyPinningCacheKey?: string;
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  dependencyPinningSource?: DependencyPinningSourceInput;
  serverExternalPackages?: readonly string[];
  onDependencyResolutionObserved?: (
    observation: DependencyResolutionObservation,
  ) => void;
}

async function assertNoConfiguredServerExternalImports(
  code: string,
  options: MdxRootDependencyRewriteOptions,
): Promise<void> {
  if (options.serverExternalPackages === undefined) return;
  const sourceModule = `${options.projectDir}/__veryfront_mdx_root__.mjs`;

  for (const imported of primordialArrayValues(await parseImports(code))) {
    const specifier = imported.n;
    if (!specifier) continue;
    const configuredPackage = getConfiguredServerExternalPackage(
      specifier,
      options.serverExternalPackages,
    );
    if (configuredPackage === undefined) continue;

    const violation = describeServerExternalBrowserViolation(
      specifier,
      sourceModule,
      options.projectDir,
    );
    throw SERVER_ONLY_IN_CLIENT.create({
      message: violation.message,
      detail:
        `Declared server external package reached an MDX browser transform: ${configuredPackage}`,
      instance: violation.sourceIdentity,
      context: { packageName: configuredPackage },
    });
  }
}

/**
 * Apply the existing MDX import-map behavior first, then pin remaining bare
 * dependencies with the parser-backed import rewriter. Flag-off code keeps
 * its pre-pinning identity and React remains owned by the existing MDX path.
 */
export async function rewriteMdxRootDependencyImports(
  code: string,
  importMap: ImportMapConfig,
  options: MdxRootDependencyRewriteOptions,
): Promise<string> {
  await assertNoConfiguredServerExternalImports(code, options);

  const importMapped = transformImports(code, importMap);
  await assertNoConfiguredServerExternalImports(importMapped, options);
  await assertNoConfiguredCommonJsBrowserImports(importMapped, {
    filePath: `${options.projectDir}/__veryfront_mdx_root__.mjs`,
    projectDir: options.projectDir,
    serverExternalPackages: options.serverExternalPackages,
  });
  if (
    options.dependencyPinningCacheKey === undefined ||
    !stringStartsWith(options.dependencyPinningCacheKey, "on:")
  ) return importMapped;

  return await mdxRootDependencyRewriter.rewrite(importMapped, {
    filePath: `${options.projectDir}/__veryfront_mdx_root__.mjs`,
    projectDir: options.projectDir,
    projectId: options.projectId,
    target: "browser",
    dev: false,
    reactVersion: options.reactVersion,
    dependencyPinningCacheKey: options.dependencyPinningCacheKey,
    dependencyPinningDependencies: options.dependencyPinningDependencies,
    dependencyPinningSource: options.dependencyPinningSource,
    serverExternalPackages: options.serverExternalPackages,
    onDependencyResolutionObserved: options.onDependencyResolutionObserved,
  });
}

export async function pinSameOriginSSRModuleImports(
  code: string,
  dependencyPinningCacheKey?: string,
  moduleServerOrigin?: string,
): Promise<string> {
  if (
    dependencyPinningCacheKey === undefined ||
    !stringStartsWith(dependencyPinningCacheKey, "on:") ||
    !moduleServerOrigin
  ) return code;

  return await replaceSpecifiers(code, (specifier) => {
    const pinned = appendSameOriginSSRDependencyPinningPathKey(
      specifier,
      dependencyPinningCacheKey,
      moduleServerOrigin,
    );
    return pinned === specifier ? null : pinned;
  });
}

async function hasReactImport(code: string): Promise<boolean> {
  const imports = await parseImports(code);
  for (const importSpecifier of primordialArrayValues(imports)) {
    if (importSpecifier.n === "react") return true;
  }
  return false;
}

/**
 * Name a project source in an error without disclosing where it lives on disk.
 *
 * `filePath` is the absolute path lifted out of a `file://` import, and the
 * limit error it feeds reaches the loader's error log and the compile-error
 * collector. Project-relative identity is what a project author can act on;
 * the deployment layout above the project root is not theirs to see.
 */
function describeProjectSource(filePath: string, projectDir?: string): string {
  const relative = projectDir ? sanitizePathForDisplay(filePath, projectDir) : "";
  if (relative) return relative;
  return pathBaseName(filePath) || "project source";
}

/**
 * Whether `filePath` belongs to the project being rendered.
 *
 * Everything beneath the project root is tenant-controlled, the dependencies
 * under its `node_modules` included, so nothing inside it may be admitted
 * through a framework exception that skips the source-size limit.
 *
 * The configured root arrives unnormalized (`resolveProjectDir` passes env and
 * context values through as-is), and a trailing slash on it would make raw
 * prefixing reject every contained file, reclassifying a project beneath
 * `FRAMEWORK_ROOT` as framework source. Containment is therefore decided by
 * the boundary-aware helper, which normalizes both sides.
 */
function isProjectSourceFile(filePath: string, projectDir?: string): boolean {
  return projectDir !== undefined && isWithinDirectory(projectDir, filePath);
}

/** Label the shared capability capture reports its own failures under. */
const JSX_SOURCE_READER_LABEL = "MDX JSX source reader";

const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

/** Decode source bytes as strict UTF-8, matching the shared bounded reader. */
function decodeStrictUtf8(bytes: Uint8Array, sourceIdentity: string): string {
  try {
    return IntrinsicReflectApply(TextDecoderPrototypeDecode, strictUtf8Decoder, [bytes]) as string;
  } catch (cause) {
    throw new TypeError(`${sourceIdentity} must contain valid UTF-8`, { cause });
  }
}

/**
 * Read one project JSX/TSX source without materializing more than the
 * MDX module source limit.
 *
 * Project source is tenant-controlled, and every render of a page that imports
 * it pays a full read plus a content hash before the cache can be consulted.
 * Bounding the read here keeps an oversized file from turning that lookup into
 * unbounded memory, CPU and I/O, the same ceiling `fetchAndCacheModule`
 * already enforces on the modules it resolves.
 *
 * The strict reader is preferred over the prefix reader: adapters whose store
 * has a whole-object ceiling far above this limit (Cloudflare KV admits 25 MiB)
 * implement `readFileBytesWithinLimit` and not `readFileBytesBounded`, so
 * without this order those runtimes would fall through to `readFile` and
 * materialize the very payload the limit exists to refuse. Every production
 * adapter takes that branch, and it runs through the repo's shared bounded
 * reader: capabilities are captured without invoking accessors or Proxy traps,
 * the returned byte length is re-checked so a reader that hands back more than
 * it was asked for is still refused, and the bytes are decoded as strict UTF-8.
 */
async function readProjectJsxSourceWithinLimit(
  fs: NonNullable<ESMLoaderContext["adapter"]>["fs"],
  filePath: string,
  sourceIdentity: string,
): Promise<string> {
  const capabilities = captureFileSystemCapabilities(fs, JSX_SOURCE_READER_LABEL, "byte-read");
  const wholeFileReader = capabilities.wholeFileReader;
  const usesSharedBoundedReader = capabilities.readFileBytesWithinLimit !== undefined ||
    (wholeFileReader !== undefined && wholeFileReader.maximumBytes <= MAX_MDX_MODULE_CODE_BYTES);

  if (usesSharedBoundedReader) {
    try {
      const read = await captureBoundedTextReader(fs, JSX_SOURCE_READER_LABEL).readUtf8(
        filePath,
        MAX_MDX_MODULE_CODE_BYTES,
        sourceIdentity,
      );
      return read.content;
    } catch (error) {
      // The shared reader reports an overflow as a TypeError carrying the
      // RangeError the reader (or the fixed-copy admission behind it) raised;
      // a decode failure carries no RangeError and stays as it is. Refusing to
      // read past the ceiling is the point, so the size stays unknown.
      if (error instanceof TypeError && error.cause instanceof RangeError) {
        throw new ModuleSourceLimitError(sourceIdentity, undefined, MAX_MDX_MODULE_CODE_BYTES);
      }
      throw error;
    }
  }

  if (capabilities.readFileBytesBounded) {
    // One byte past the ceiling distinguishes an exactly-sized file from an
    // oversized one without reading the rest of an oversized file. The fixed
    // copy is what makes the length trustworthy: a prefix reader that returns
    // more than it was asked for overflows here instead of being admitted.
    let bytes: Uint8Array;
    try {
      bytes = copyFixedUint8ArrayWithinLimit(
        await capabilities.readFileBytesBounded(filePath, MAX_MDX_MODULE_CODE_BYTES + 1),
        MAX_MDX_MODULE_CODE_BYTES + 1,
        sourceIdentity,
      );
    } catch (error) {
      if (error instanceof RangeError) {
        throw new ModuleSourceLimitError(sourceIdentity, undefined, MAX_MDX_MODULE_CODE_BYTES);
      }
      throw error;
    }
    assertMdxModuleSourceSize(
      sourceIdentity,
      getFixedUint8ArrayByteLength(bytes, sourceIdentity),
    );
    return decodeStrictUtf8(bytes, sourceIdentity);
  }

  const raw = await fs.readFile(filePath);
  const sourceCode = typeof raw === "string" ? raw : decodeStrictUtf8(raw, sourceIdentity);
  assertMdxModuleSourceSize(sourceIdentity, utf8ByteLength(sourceCode));
  return sourceCode;
}

async function readJsxImportSource(
  filePath: string,
  adapter: ESMLoaderContext["adapter"],
  projectDir?: string,
): Promise<string | undefined> {
  // Project identity is decided before the framework exception: a project can
  // live beneath FRAMEWORK_ROOT, and its sources must stay on the bounded
  // adapter even when their absolute paths begin with the framework root.
  const isFrameworkFile = !isProjectSourceFile(filePath, projectDir) &&
    (isFrameworkSourceFile(filePath) ||
      (stringStartsWith(filePath, FRAMEWORK_ROOT) &&
        stringIncludes(filePath, "/node_modules/")));
  if (isFrameworkFile) return await getLocalFs().readTextFile(filePath);
  if (adapter) {
    return await readProjectJsxSourceWithinLimit(
      adapter.fs,
      filePath,
      describeProjectSource(filePath, projectDir),
    );
  }
  logger.warn(`${LOG_PREFIX_MDX_LOADER} No adapter available to read JSX file: ${filePath}`);
  return undefined;
}

/**
 * Run every transform callback under `parallelMap`, guaranteeing `cleanup`
 * runs when the map itself fails.
 *
 * The map's semaphore rejects an acquisition that waits too long, and that
 * rejection settles the underlying `Promise.all` outside any callback's own
 * `try` while the callbacks already holding permits keep running and writing
 * artifacts. Without this wrapper, repeated failing renders of changing
 * sources would leave those writes with no prune pass to follow — unbounded
 * growth again. The failure path waits for the started callbacks to settle so
 * their writes are covered by the cleanup, and refuses to start a callback
 * after the failure so no write can land behind the cleanup's back.
 */
async function mapJsxTransformsWithCleanup<T, R>(
  items: T[],
  transformOne: (item: T) => Promise<R | null>,
  cleanup: () => Promise<void>,
  options: { semaphore: Semaphore; timeoutMs?: number },
): Promise<Array<R | null>> {
  const inFlightTransforms = new IntrinsicSet<Promise<void>>();
  let mapFailed = false;

  try {
    return await parallelMap(
      items,
      (item) => {
        if (mapFailed) return primordialPromiseResolve(null);
        const run = transformOne(item);
        const settled = primordialPromiseThen(run, () => undefined, () => undefined);
        setAdd(inFlightTransforms, settled);
        void primordialPromiseThen(settled, () => setDelete(inFlightTransforms, settled));
        return run;
      },
      options,
    );
  } catch (error) {
    mapFailed = true;
    await primordialPromiseAll(setValues(inFlightTransforms));
    await cleanup();
    throw error;
  }
}

/**
 * Reachable for the source-admission tests, which need to drive the source
 * classification, the redacted identity and the map's failure path directly
 * rather than through a full JSX transform.
 */
export const __importTransformerInternals = {
  describeProjectSource,
  isFrameworkSourceFile,
  isProjectSourceFile,
  mapJsxTransformsWithCleanup,
  readJsxImportSource,
};

/**
 * Transform JSX/TSX imports using esbuild.
 * Optimized to process all imports in parallel batches for better performance.
 */
export async function transformJsxImports(
  code: string,
  adapter: ESMLoaderContext["adapter"],
  esmCacheDir: string,
  projectDir?: string,
): Promise<string> {
  const { transform } = await import("veryfront/extensions/bundler");

  const importsToProcess: Array<{
    specifier: string;
    filePath: string;
    ext: string;
  }> = [];

  const imports = await parseImports(code);
  for (const importSpecifier of primordialArrayValues(imports)) {
    const specifier = importSpecifier.n;
    if (!specifier || !stringStartsWith(specifier, "file://")) continue;

    const filePath = stringSlice(specifier, "file://".length);
    const ext = (IntrinsicReflectApply(
      RegExpPrototypeExec,
      JSX_SOURCE_EXTENSION_PATTERN,
      [filePath],
    ) as RegExpExecArray | null)?.[1];
    if (!ext) continue;

    primordialArrayPush(importsToProcess, { specifier, filePath, ext });
  }

  if (importsToProcess.length === 0) return code;
  assertMdxModuleImportCount("compiled MDX JSX imports", importsToProcess.length);
  // The directory is in use: make sure this process has an age-based sweep
  // armed even if this render — and every later one — is served entirely from
  // cache and never writes an artifact of its own.
  ensureJsxCacheSweepArmed(esmCacheDir);

  const transformStart = performance.now();
  logger.debug(
    `${LOG_PREFIX_MDX_LOADER} Transforming ${importsToProcess.length} JSX imports in parallel`,
  );

  /** Source path to the artifact name this pass wrote, for one prune pass. */
  const writtenArtifacts = new IntrinsicMap<string, string>();
  const selectedArtifacts = new IntrinsicSet<string>();
  let selectedArtifactRefreshInFlight: Promise<void> | undefined;
  const refreshSelectedArtifacts = (): Promise<void> => {
    if (selectedArtifactRefreshInFlight) return selectedArtifactRefreshInFlight;
    const run = refreshJsxArtifactsBounded(setValues(selectedArtifacts), true);
    selectedArtifactRefreshInFlight = primordialPromiseFinally(run, () => {
      selectedArtifactRefreshInFlight = undefined;
    });
    return selectedArtifactRefreshInFlight;
  };
  const selectedArtifactHeartbeat = hostSetInterval(
    () => void primordialPromiseCatch(refreshSelectedArtifacts(), () => undefined),
    JSX_CACHE_VARIANT_MIN_AGE_MS / 4,
  );
  unrefTimer(selectedArtifactHeartbeat);
  /**
   * An oversized source rejects the whole transform, but `parallelMap` runs on
   * `Promise.all`, which does not cancel siblings. Throwing out of the callback
   * would return the error while those siblings kept writing artifacts that no
   * prune pass ever followed, so the failure is carried out instead and rethrown
   * once every callback has settled and the cleanup has run.
   */
  let admissionFailure: ModuleSourceLimitError | JsxCacheCapacityError | undefined;

  type JsxImportTransformResult = {
    specifier: string;
    replacement: string;
    cached: boolean;
  } | null;

  const transformOne = async (
    { specifier, filePath, ext }: { specifier: string; filePath: string; ext: string },
  ): Promise<JsxImportTransformResult> => {
    try {
      const sourceCode = await readJsxImportSource(filePath, adapter, projectDir);
      if (sourceCode === undefined) return null;

      const transformedFileName = buildMdxJsxCacheFileName(filePath, sourceCode);
      const transformedPath = join(esmCacheDir, transformedFileName);

      // Verification and the served mark run under the artifact's lock — the
      // same lock the prune pass removes under — so a prune either sees the
      // mark and keeps the file, or finishes removing before the check here
      // reports a miss and the transform below regenerates it.
      const serveCached = await withJsxArtifactLock(transformedPath, async (assertLeaseOwned) => {
        try {
          const stat = await getLocalFs().stat(transformedPath);
          if (!stat?.isFile) return false;
          if (!(await ensureCachedJsxModulePatched(transformedPath, filePath, assertLeaseOwned))) {
            return false;
          }
          // A cache hit is an active reference: record it so a concurrent
          // prune cannot retire the artifact this render is about to import,
          // and refresh the on-disk mtime so prune passes in other processes
          // see the use too.
          await assertLeaseOwned();
          markJsxArtifactServed(transformedPath);
          await refreshJsxArtifactMtime(
            transformedPath,
            stat.mtime == null ? 0 : dateGetTime(stat.mtime),
            hostNow(),
            true,
          );
          return true;
        } catch (_) {
          /* expected: cached JSX module may not exist yet */
          return false;
        }
      });
      if (serveCached) {
        setAdd(selectedArtifacts, transformedPath);
        return {
          specifier,
          replacement: `file://${transformedPath}`,
          cached: true,
        };
      }

      const loaderMap: Record<string, "js" | "jsx" | "ts" | "tsx"> = {
        tsx: "tsx",
        ts: "ts",
        jsx: "jsx",
        js: "js",
      };
      const loader = loaderMap[ext] ?? "tsx";

      const result = await transform(sourceCode, {
        loader,
        jsx: "transform",
        jsxFactory: ESBUILD_JSX_FACTORY,
        jsxFragment: ESBUILD_JSX_FRAGMENT,
        format: "esm",
      });

      let transformed = result.code;
      if (!(await hasReactImport(transformed))) {
        transformed = `import React from 'react';\n${transformed}`;
      }

      // Rewrite _dnt.polyfills.js / _dnt.shims.js relative imports to absolute file:// paths.
      // Framework files from the npm package contain relative dnt imports that resolve
      // incorrectly when cached to a different directory.
      transformed = await rewriteDntImports(transformed, filePath);

      await withJsxArtifactWriteCapacity(
        esmCacheDir,
        transformedPath,
        (assertCapacityLeaseOwned) =>
          withJsxArtifactLock(transformedPath, async (assertArtifactLeaseOwned) => {
            await assertCapacityLeaseOwned();
            await assertArtifactLeaseOwned();
            await getLocalFs().writeTextFile(transformedPath, transformed);
            markJsxArtifactServed(transformedPath);
          }),
      );
      mapSet(writtenArtifacts, filePath, transformedFileName);
      setAdd(selectedArtifacts, transformedPath);

      return {
        specifier,
        replacement: `file://${transformedPath}`,
        cached: false,
      };
    } catch (error) {
      // An oversized source is an admission failure, not a transform that can
      // be skipped: surface it the way the other MDX module limits do instead
      // of leaving an untransformed file:// specifier behind.
      if (error instanceof ModuleSourceLimitError || error instanceof JsxCacheCapacityError) {
        admissionFailure ??= error;
        return null;
      }
      logger.warn(
        `${LOG_PREFIX_MDX_LOADER} Failed to transform JSX import: ${
          describeProjectSource(filePath, projectDir)
        }`,
        error,
      );
      return null;
    }
  };

  let transformResults: Array<JsxImportTransformResult>;
  try {
    transformResults = await mapJsxTransformsWithCleanup(
      importsToProcess,
      transformOne,
      () => pruneSupersededJsxArtifacts(esmCacheDir, writtenArtifacts),
      { semaphore: new Semaphore(MAX_MDX_MODULE_TRANSFORM_CONCURRENCY) },
    );

    // Runs before the rethrow so the artifacts written by the siblings that kept
    // going after the admission failure are still covered by a cleanup pass.
    try {
      await pruneSupersededJsxArtifacts(esmCacheDir, writtenArtifacts);
    } catch {
      ensureJsxCacheSweepArmed(esmCacheDir);
      logger.debug(`${LOG_PREFIX_MDX_LOADER} Deferred JSX cache maintenance prune`);
    }
    await refreshSelectedArtifacts();
    if (admissionFailure) throw admissionFailure;
  } finally {
    hostClearInterval(selectedArtifactHeartbeat);
    // The initial sweep can finish while source reads or transforms are pending.
    ensureJsxCacheSweepArmed(esmCacheDir);
  }

  let successfulTransforms = 0;
  let cachedTransforms = 0;
  for (const result of primordialArrayValues(transformResults)) {
    if (!result) continue;
    successfulTransforms++;
    if (result.cached) cachedTransforms++;
  }
  logger.debug(`${LOG_PREFIX_MDX_LOADER} JSX transform phase completed`, {
    total: importsToProcess.length,
    success: successfulTransforms,
    cached: cachedTransforms,
    durationMs: (performance.now() - transformStart).toFixed(1),
  });

  const replacements = new IntrinsicMap<string, string>();
  for (const t of primordialArrayValues(transformResults)) {
    if (t) mapSet(replacements, t.specifier, t.replacement);
  }

  if (mapSize(replacements) === 0) return code;
  return await replaceSpecifiers(code, (specifier) => mapGet(replacements, specifier) ?? null);
}
