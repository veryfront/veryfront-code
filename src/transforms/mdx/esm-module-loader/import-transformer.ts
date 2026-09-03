/**
 * Import Transformer
 *
 * Functions for rewriting and transforming import specifiers in MDX compiled code.
 * Handles project aliases, React paths, JSX transforms, and import map resolution.
 *
 * @module build/transforms/mdx/esm-module-loader/import-transformer
 */

import { join } from "#veryfront/compat/path";
import { SERVER_ONLY_IN_CLIENT } from "#veryfront/errors";
import type { ImportMapConfig } from "#veryfront/modules/import-map/index.ts";
import { transformImportsWithMap } from "#veryfront/modules/import-map/index.ts";
import { Semaphore } from "#veryfront/modules/react-loader/ssr-module-loader/concurrency/semaphore.ts";
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
import {
  buildMdxJsxCacheFileName,
  buildMdxJsxCacheFileNamePrefix,
  MDX_JSX_CACHE_FILE_NAME_PREFIX_LENGTH,
  MDX_JSX_CACHE_NAMESPACE_PREFIX,
  MDX_JSX_CACHE_ROOT_PREFIX,
} from "./cache-format.ts";
import { rewriteDntImports } from "./module-fetcher/index.ts";
import {
  assertMdxModuleImportCount,
  assertMdxModuleSourceSize,
  MAX_MDX_MODULE_CODE_BYTES,
  MAX_MDX_MODULE_TRANSFORM_CONCURRENCY,
  ModuleSourceLimitError,
  utf8ByteLength,
} from "./module-fetcher/limits.ts";
import { ensureCachedJsxModulePatched } from "./jsx-cache.ts";
import type { ESMLoaderContext } from "./types.ts";

const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z\d+.-]*:/;

const mdxRootBareDependencyStrategy: ImportRewriteStrategy = {
  name: "mdx-root-bare-dependency",
  priority: bareStrategy.priority,
  matches(specifier, ctx) {
    const hasNonNpmScheme = URI_SCHEME_PATTERN.test(specifier) &&
      !specifier.startsWith("npm:");
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
    if (!specifier.startsWith("@/")) return null;
    const path = specifier.slice(2);
    const jsPath = path.endsWith(".js") ? path : `${path}.js`;
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
  if (Object.keys(localPaths).length === 0) return code;

  return await replaceSpecifiers(code, (specifier) => localPaths[specifier] || null);
}

function stripReactFromImportMap(importMap: ImportMapConfig): ImportMapConfig {
  const imports = importMap.imports ? { ...importMap.imports } : undefined;
  if (imports) {
    for (const key of Object.keys(imports)) {
      if (isReactSpecifier(key)) delete imports[key];
    }
  }

  const scopes = importMap.scopes
    ? Object.fromEntries(
      Object.entries(importMap.scopes).map(([scope, mappings]) => {
        const filtered = { ...mappings };
        for (const key of Object.keys(filtered)) {
          if (isReactSpecifier(key)) delete filtered[key];
        }
        return [scope, filtered];
      }),
    )
    : undefined;

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

  for (const imported of await parseImports(code)) {
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
  if (!options.dependencyPinningCacheKey?.startsWith("on:")) return importMapped;

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
  if (!dependencyPinningCacheKey?.startsWith("on:") || !moduleServerOrigin) return code;

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
  return imports.some((importSpecifier) => importSpecifier.n === "react");
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
  return filePath.split(/[\\/]/).at(-1) || "project source";
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
 * materialize the very payload the limit exists to refuse.
 */
async function readProjectJsxSourceWithinLimit(
  fs: NonNullable<ESMLoaderContext["adapter"]>["fs"],
  filePath: string,
  sourceIdentity: string,
): Promise<string> {
  if (fs.readFileBytesWithinLimit) {
    try {
      const bytes = await fs.readFileBytesWithinLimit(filePath, MAX_MDX_MODULE_CODE_BYTES);
      return new TextDecoder().decode(bytes);
    } catch (error) {
      // The contract for this capability is to reject an oversized source with
      // a RangeError rather than report its size, so the size stays unknown.
      if (error instanceof RangeError) {
        throw new ModuleSourceLimitError(sourceIdentity, undefined, MAX_MDX_MODULE_CODE_BYTES);
      }
      throw error;
    }
  }

  if (fs.readFileBytesBounded) {
    // One byte past the ceiling distinguishes an exactly-sized file from an
    // oversized one without reading the rest of an oversized file.
    const bytes = await fs.readFileBytesBounded(filePath, MAX_MDX_MODULE_CODE_BYTES + 1);
    assertMdxModuleSourceSize(sourceIdentity, bytes.byteLength);
    return new TextDecoder().decode(bytes);
  }

  const raw = await fs.readFile(filePath);
  const sourceCode = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  assertMdxModuleSourceSize(sourceIdentity, utf8ByteLength(sourceCode));
  return sourceCode;
}

/**
 * Cached content variants retained per source path.
 *
 * Deleting every variant but the one this pass wrote is not safe: a render
 * that transformed an older generation of the same path is still holding the
 * `file://` specifier of its own artifact, and deleting it breaks that render's
 * module load. The window is sized above the default per-project request
 * ceiling (`maxConcurrentPerProject`, 20) so ordinary concurrency never reaches
 * it, and {@link JSX_CACHE_VARIANT_MIN_AGE_MS} is what actually guarantees an
 * in-flight artifact survives when that ceiling is raised.
 */
export const MAX_JSX_CACHE_VARIANTS_PER_PATH = 32;

/**
 * Age an artifact must reach before it can be retired.
 *
 * A retention count alone assumes concurrency stays below the window. This
 * floor removes the assumption: an artifact a transform just returned is by
 * definition younger than the grace period, so no prune pass can delete it
 * before the render that owns it has imported it, no matter how many renders
 * of the same path are in flight.
 */
export const JSX_CACHE_VARIANT_MIN_AGE_MS = 60_000;

/** Bound on the artifacts this process remembers as recently served. */
const MAX_SERVED_ARTIFACT_MEMO_ENTRIES = 4096;

/**
 * When this process last handed each artifact path to a render.
 *
 * An artifact's mtime records when it was written, not when it was last used,
 * so a cache hit on an artifact older than the grace period would otherwise be
 * eligible for deletion between the moment a render selects its `file://` URL
 * and the moment `doLoadModuleESM` imports the rewritten parent. Recording the
 * hit keeps the artifact out of pruning for one further grace period.
 */
const servedArtifactTimestamps = new Map<string, number>();

function markJsxArtifactServed(transformedPath: string, servedAtMs: number = Date.now()): void {
  // Delete-before-set keeps the map in recency order, so reaching capacity
  // evicts the artifact served longest ago instead of wiping the whole memo
  // and momentarily dropping the protection every in-flight hit relies on.
  servedArtifactTimestamps.delete(transformedPath);
  if (servedArtifactTimestamps.size >= MAX_SERVED_ARTIFACT_MEMO_ENTRIES) {
    const oldest = servedArtifactTimestamps.keys().next().value;
    if (oldest !== undefined) servedArtifactTimestamps.delete(oldest);
  }
  servedArtifactTimestamps.set(transformedPath, servedAtMs);
}

function wasJsxArtifactRecentlyServed(transformedPath: string, nowMs: number): boolean {
  const servedAtMs = servedArtifactTimestamps.get(transformedPath);
  return servedAtMs !== undefined && nowMs - servedAtMs < JSX_CACHE_VARIANT_MIN_AGE_MS;
}

/**
 * Per-artifact operation queues, dropped once the last queued operation
 * settles, so the map holds only paths with an operation in flight.
 */
const jsxArtifactLocks = new Map<string, Promise<void>>();

/**
 * Serialize the operations on one artifact path that must not interleave: a
 * cache hit verifying the file and recording it as served, a transform
 * rewriting it, and a prune pass removing it. Without this, a hit could verify
 * the artifact after the pruner checked the served memo but before its
 * `remove` landed, and the rewritten parent would import a just-deleted path.
 */
async function withJsxArtifactLock<T>(
  artifactPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = jsxArtifactLocks.get(artifactPath) ?? Promise.resolve();
  const run = previous.then(operation);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  jsxArtifactLocks.set(artifactPath, settled);
  void settled.then(() => {
    if (jsxArtifactLocks.get(artifactPath) === settled) {
      jsxArtifactLocks.delete(artifactPath);
    }
  });
  return await run;
}

async function readArtifactModifiedAtMs(path: string): Promise<number> {
  try {
    return (await getLocalFs().stat(path)).mtime?.getTime() ?? 0;
  } catch (_) {
    /* expected: a concurrent transform may have removed the variant already */
    return 0;
  }
}

/** Slack a scheduled follow-up adds so the variants it targets have aged out. */
const JSX_CACHE_PRUNE_RETRY_SLACK_MS = 1_000;

/** At most one pending follow-up prune per cache directory. */
const scheduledJsxCachePrunes = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Schedule a follow-up prune for variants the grace period protected.
 *
 * The prune pass otherwise runs only when a transform writes an artifact, so a
 * burst that puts a path over its window inside one grace period and then goes
 * idle would leave the excess on disk until an unrelated future write. The
 * timer is unref'd: cleanup of superseded cache files is never a reason to
 * keep the process alive.
 */
function scheduleJsxCachePruneRetry(esmCacheDir: string, delayMs: number): void {
  if (scheduledJsxCachePrunes.has(esmCacheDir)) return;
  const timer = setTimeout(() => {
    scheduledJsxCachePrunes.delete(esmCacheDir);
    collectExcessJsxArtifacts(esmCacheDir, new Map(), Date.now()).catch((error) => {
      logger.debug(`${LOG_PREFIX_MDX_LOADER} Scheduled JSX cache prune failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, delayMs);
  unrefTimer(timer);
  scheduledJsxCachePrunes.set(esmCacheDir, timer);
}

/** Drop every pending follow-up prune (test isolation only). */
function cancelScheduledJsxCachePrunes(): void {
  for (const timer of scheduledJsxCachePrunes.values()) clearTimeout(timer);
  scheduledJsxCachePrunes.clear();
}

/**
 * Remove one artifact unless a hit claimed it while the removal waited.
 *
 * The served re-check runs under the same per-path lock the cache-hit
 * verification runs under, so selection and removal cannot interleave: a hit
 * that got the lock first has marked the artifact served by the time this
 * check runs, and a removal that got there first leaves the hit a missing
 * file, which it reports as a miss and regenerates.
 */
async function removeJsxArtifactUnlessServed(artifactPath: string, nowMs: number): Promise<void> {
  await withJsxArtifactLock(artifactPath, async () => {
    if (wasJsxArtifactRecentlyServed(artifactPath, Math.max(nowMs, Date.now()))) return;
    try {
      await getLocalFs().remove(artifactPath);
    } catch (_) {
      /* expected: a concurrent transform may have removed the variant already */
    }
  });
}

/**
 * Retire the oldest cached content variants of every source path in the cache.
 *
 * Artifact names are content-keyed, so a project that keeps changing the same
 * path would otherwise accumulate one persistent `jsx-*.mjs` file per variant.
 *
 * The pass covers every path the directory holds, not only the paths this
 * transform wrote: a burst of changes can leave a path over its window with
 * every variant still inside the grace period, and if the writer stopped there
 * would be nothing left to trigger its cleanup. Recovering each entry's
 * per-path prefix from its own fixed-width name keeps that generality at one
 * `readDir` and one map lookup per entry, rather than multiplying entries by
 * the number of paths written.
 *
 * It runs only after a transform wrote something, so a render served entirely
 * from cache never pays for it; a pass that has to leave over-window variants
 * behind schedules its own follow-up instead of waiting for a future write.
 */
async function pruneSupersededJsxArtifacts(
  esmCacheDir: string,
  writtenArtifacts: ReadonlyMap<string, string>,
  nowMs: number = Date.now(),
): Promise<void> {
  if (writtenArtifacts.size === 0) return;

  const currentByPrefix = new Map<string, string>();
  for (const [filePath, currentFileName] of writtenArtifacts) {
    currentByPrefix.set(buildMdxJsxCacheFileNamePrefix(filePath), currentFileName);
  }
  await collectExcessJsxArtifacts(esmCacheDir, currentByPrefix, nowMs);
}

/**
 * One prune pass over `esmCacheDir`. `currentByPrefix` protects the artifacts
 * the caller just wrote; a scheduled follow-up passes none and relies on the
 * grace period alone. Also reclaims artifacts stranded under a superseded
 * cache namespace: recognisably this loader's files, but unreachable since the
 * roll, so no variant window can ever cover them again.
 */
async function collectExcessJsxArtifacts(
  esmCacheDir: string,
  currentByPrefix: ReadonlyMap<string, string>,
  nowMs: number,
): Promise<void> {
  const localFs = getLocalFs();

  const variantsByPrefix = new Map<string, string[]>();
  const strandedNamespaceArtifacts: string[] = [];
  try {
    for await (const entry of localFs.readDir(esmCacheDir)) {
      if (!entry.isFile) continue;
      if (!entry.name.startsWith(MDX_JSX_CACHE_NAMESPACE_PREFIX)) {
        if (entry.name.startsWith(MDX_JSX_CACHE_ROOT_PREFIX)) {
          strandedNamespaceArtifacts.push(entry.name);
        }
        continue;
      }
      if (entry.name.length <= MDX_JSX_CACHE_FILE_NAME_PREFIX_LENGTH) continue;

      const prefix = entry.name.slice(0, MDX_JSX_CACHE_FILE_NAME_PREFIX_LENGTH);
      if (entry.name === currentByPrefix.get(prefix)) continue;

      const variants = variantsByPrefix.get(prefix);
      if (variants) variants.push(entry.name);
      else variantsByPrefix.set(prefix, [entry.name]);
    }
  } catch (error) {
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Failed to scan JSX cache artifacts for pruning`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  /** Earliest moment a variant this pass left behind becomes collectable. */
  let retryAtMs: number | undefined;
  const noteRetry = (readyAtMs: number) => {
    retryAtMs = retryAtMs === undefined ? readyAtMs : Math.min(retryAtMs, readyAtMs);
  };

  for (const name of strandedNamespaceArtifacts) {
    const artifactPath = join(esmCacheDir, name);
    // The grace period still applies: during a rolling deploy a process on the
    // previous namespace may have handed this artifact to a render moments ago.
    const modifiedAtMs = await readArtifactModifiedAtMs(artifactPath);
    if (nowMs - modifiedAtMs < JSX_CACHE_VARIANT_MIN_AGE_MS) {
      noteRetry(modifiedAtMs + JSX_CACHE_VARIANT_MIN_AGE_MS);
      continue;
    }
    await removeJsxArtifactUnlessServed(artifactPath, nowMs);
  }

  for (const [prefix, variants] of variantsByPrefix) {
    // The artifact just written, when there is one, counts against the window.
    const retained = MAX_JSX_CACHE_VARIANTS_PER_PATH - (currentByPrefix.has(prefix) ? 1 : 0);
    if (variants.length <= retained) continue;

    const dated = await Promise.all(
      variants.map(async (name) => ({
        name,
        modifiedAtMs: await readArtifactModifiedAtMs(join(esmCacheDir, name)),
      })),
    );
    dated.sort((left, right) => right.modifiedAtMs - left.modifiedAtMs);

    for (const { name, modifiedAtMs } of dated.slice(retained)) {
      const artifactPath = join(esmCacheDir, name);
      const servedAtMs = servedArtifactTimestamps.get(artifactPath) ?? 0;
      const collectableAtMs = Math.max(modifiedAtMs, servedAtMs) + JSX_CACHE_VARIANT_MIN_AGE_MS;
      if (collectableAtMs > nowMs) {
        noteRetry(collectableAtMs);
        continue;
      }
      await removeJsxArtifactUnlessServed(artifactPath, nowMs);
    }
  }

  if (retryAtMs !== undefined) {
    scheduleJsxCachePruneRetry(
      esmCacheDir,
      Math.max(retryAtMs - nowMs, 0) + JSX_CACHE_PRUNE_RETRY_SLACK_MS,
    );
  }
}

/**
 * Reachable for the cache-retention and redaction tests, which need to drive
 * the prune pass and the source identity directly rather than through a full
 * JSX transform.
 */
export const __importTransformerInternals = {
  cancelScheduledJsxCachePrunes,
  collectExcessJsxArtifacts,
  describeProjectSource,
  hasScheduledJsxCachePrune: (esmCacheDir: string): boolean =>
    scheduledJsxCachePrunes.has(esmCacheDir),
  isFrameworkSourceFile,
  isProjectSourceFile,
  markJsxArtifactServed,
  MAX_SERVED_ARTIFACT_MEMO_ENTRIES,
  servedArtifactMemoSize: (): number => servedArtifactTimestamps.size,
  pruneSupersededJsxArtifacts,
  readArtifactModifiedAtMs,
  removeJsxArtifactUnlessServed,
  wasJsxArtifactRecentlyServed,
  withJsxArtifactLock,
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
  for (const importSpecifier of imports) {
    const specifier = importSpecifier.n;
    if (!specifier?.startsWith("file://")) continue;

    const filePath = specifier.slice("file://".length);
    const ext = filePath.match(/\.(tsx?|jsx?)$/)?.[1];
    if (!ext) continue;

    importsToProcess.push({ specifier, filePath, ext });
  }

  if (importsToProcess.length === 0) return code;
  assertMdxModuleImportCount("compiled MDX JSX imports", importsToProcess.length);

  const transformStart = performance.now();
  logger.debug(
    `${LOG_PREFIX_MDX_LOADER} Transforming ${importsToProcess.length} JSX imports in parallel`,
  );

  /** Source path to the artifact name this pass wrote, for one prune pass. */
  const writtenArtifacts = new Map<string, string>();
  /**
   * An oversized source rejects the whole transform, but `parallelMap` runs on
   * `Promise.all`, which does not cancel siblings. Throwing out of the callback
   * would return the error while those siblings kept writing artifacts that no
   * prune pass ever followed, so the failure is carried out instead and rethrown
   * once every callback has settled and the cleanup has run.
   */
  let admissionFailure: ModuleSourceLimitError | undefined;

  const transformResults = await parallelMap(
    importsToProcess,
    async ({ specifier, filePath, ext }) => {
      try {
        // Project identity is decided before the framework exception: a project
        // can live beneath FRAMEWORK_ROOT, and everything inside it - its own
        // source and the dependencies under its node_modules alike - is tenant
        // controlled, so it has to go through the adapter that bounds the read.
        const isFrameworkFile = !isProjectSourceFile(filePath, projectDir) &&
          (isFrameworkSourceFile(filePath) ||
            (filePath.startsWith(FRAMEWORK_ROOT) && filePath.includes("/node_modules/")));
        let sourceCode: string;
        if (isFrameworkFile) {
          sourceCode = await getLocalFs().readTextFile(filePath);
        } else if (adapter) {
          sourceCode = await readProjectJsxSourceWithinLimit(
            adapter.fs,
            filePath,
            describeProjectSource(filePath, projectDir),
          );
        } else {
          logger.warn(
            `${LOG_PREFIX_MDX_LOADER} No adapter available to read JSX file: ${filePath}`,
          );
          return null;
        }

        const transformedFileName = buildMdxJsxCacheFileName(filePath, sourceCode);
        const transformedPath = join(esmCacheDir, transformedFileName);

        // Verification and the served mark run under the artifact's lock — the
        // same lock the prune pass removes under — so a prune either sees the
        // mark and keeps the file, or finishes removing before the check here
        // reports a miss and the transform below regenerates it.
        const serveCached = await withJsxArtifactLock(transformedPath, async () => {
          try {
            const stat = await getLocalFs().stat(transformedPath);
            if (!stat?.isFile) return false;
            if (!(await ensureCachedJsxModulePatched(transformedPath, filePath))) return false;
            // A cache hit is an active reference: record it so a concurrent
            // prune cannot retire the artifact this render is about to import.
            markJsxArtifactServed(transformedPath);
            return true;
          } catch (_) {
            /* expected: cached JSX module may not exist yet */
            return false;
          }
        });
        if (serveCached) {
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

        await withJsxArtifactLock(transformedPath, async () => {
          await getLocalFs().writeTextFile(transformedPath, transformed);
          markJsxArtifactServed(transformedPath);
        });
        writtenArtifacts.set(filePath, transformedFileName);

        return {
          specifier,
          replacement: `file://${transformedPath}`,
          cached: false,
        };
      } catch (error) {
        // An oversized source is an admission failure, not a transform that can
        // be skipped: surface it the way the other MDX module limits do instead
        // of leaving an untransformed file:// specifier behind.
        if (error instanceof ModuleSourceLimitError) {
          admissionFailure ??= error;
          return null;
        }
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to transform JSX import: ${filePath}`, error);
        return null;
      }
    },
    { semaphore: new Semaphore(MAX_MDX_MODULE_TRANSFORM_CONCURRENCY) },
  );

  // Runs before the rethrow so the artifacts written by the siblings that kept
  // going after the admission failure are still covered by a cleanup pass.
  await pruneSupersededJsxArtifacts(esmCacheDir, writtenArtifacts);
  if (admissionFailure) throw admissionFailure;

  logger.debug(`${LOG_PREFIX_MDX_LOADER} JSX transform phase completed`, {
    total: importsToProcess.length,
    success: transformResults.filter(Boolean).length,
    cached: transformResults.filter((r) => r?.cached).length,
    durationMs: (performance.now() - transformStart).toFixed(1),
  });

  const replacements = new Map<string, string>();
  for (const t of transformResults) {
    if (t) replacements.set(t.specifier, t.replacement);
  }

  if (replacements.size === 0) return code;
  return await replaceSpecifiers(code, (specifier) => replacements.get(specifier) ?? null);
}
