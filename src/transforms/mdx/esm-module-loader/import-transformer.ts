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
  MAX_MDX_MODULE_IMPORTS_PER_FILE,
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
 * it; {@link JSX_CACHE_VARIANT_MIN_AGE_MS} and the active references a render
 * holds until its parent import settles are what actually guarantee an
 * in-flight artifact survives when that ceiling is raised.
 */
export const MAX_JSX_CACHE_VARIANTS_PER_PATH = 32;

/**
 * Age an artifact must reach before it can be retired.
 *
 * A retention count alone assumes concurrency stays below the window. This
 * floor removes the assumption for the moments before a render pins its
 * artifacts: an artifact a transform just returned is by definition younger
 * than the grace period, so no prune pass can delete it in the gap between
 * `transformJsxImports` returning and the render acquiring its active
 * references via {@link retainJsxArtifactsReferencedIn}. Once those references
 * exist they, not this floor, are what carry the artifact through the rest of
 * the render, however long its module-recovery phase runs.
 */
export const JSX_CACHE_VARIANT_MIN_AGE_MS = 60_000;

/**
 * Age a variant inside the per-path window must reach, measured from its last
 * use, before it is retired as idle.
 *
 * The per-path window alone bounds only paths that keep receiving writes: a
 * tenant that renames its imported source on every edit leaves one variant per
 * retired path, each in a prefix group too small for the window to touch, so
 * per-project disk growth would again track edit history. Idle collection is
 * the directory-wide backstop: any artifact whose last use (mtime, refreshed
 * by cache hits) is older than this floor is deleted no matter how few
 * variants share its prefix, so the cache converges on the artifacts the
 * project actually served recently.
 */
export const JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS = 6 * 60 * 60 * 1_000;

/**
 * How stale an artifact's mtime may grow before a cache hit refreshes it.
 *
 * A hit refreshes the file's mtime so "last use" is visible across processes
 * — the in-memory served memo and active references are not — which is what
 * lets one process's grace check protect an artifact another process (for
 * example one draining during a rolling deploy) just served. The interval
 * keeps the refresh to at most one metadata write per artifact per interval.
 */
const JSX_CACHE_MTIME_REFRESH_INTERVAL_MS = JSX_CACHE_VARIANT_MIN_AGE_MS / 4;

/**
 * Per-project request ceiling this cache's memos are sized against
 * (`maxConcurrentPerProject` in `server/runtime-handler/project-isolation.ts`;
 * kept as a local mirror so the transform layer does not import server
 * runtime configuration).
 */
const SUPPORTED_CONCURRENT_RENDERS_PER_PROJECT = 20;

/**
 * Bound on the artifacts this process remembers as recently served.
 *
 * Sized to twice the supported in-flight fan-out — the per-project request
 * ceiling times the per-module import ceiling — so reaching capacity can only
 * ever evict marks that no supported load pattern still relies on. Active
 * references, not this memo, are what protect a render across its long
 * post-transform phases; the memo only has to cover the moments between a
 * transform returning and those references being acquired.
 */
const MAX_SERVED_ARTIFACT_MEMO_ENTRIES = 2 * SUPPORTED_CONCURRENT_RENDERS_PER_PROJECT *
  MAX_MDX_MODULE_IMPORTS_PER_FILE;

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
 * Artifacts currently pinned by an in-flight render, by reference count.
 *
 * A render acquires a reference to every artifact its rewritten module imports
 * (via {@link retainJsxArtifactsReferencedIn}) and releases it after the parent
 * dynamic import settles. Unlike the served memo, which is a fixed-age lease,
 * a reference is unconditional: no prune pass removes a referenced artifact,
 * however long the render's HTTP-caching and bundle-recovery phases run.
 */
const jsxArtifactActiveRefs = new Map<string, number>();

function retainJsxArtifact(artifactPath: string): void {
  jsxArtifactActiveRefs.set(artifactPath, (jsxArtifactActiveRefs.get(artifactPath) ?? 0) + 1);
}

function releaseJsxArtifact(artifactPath: string): void {
  const count = jsxArtifactActiveRefs.get(artifactPath);
  if (count === undefined) return;
  if (count <= 1) jsxArtifactActiveRefs.delete(artifactPath);
  else jsxArtifactActiveRefs.set(artifactPath, count - 1);
}

/**
 * Refresh an artifact's mtime so its last use is visible to other processes.
 *
 * Best effort on a best-effort signal: a runtime without `utime` (or a failed
 * refresh) falls back to the in-process served memo, which still protects
 * every render this process owns.
 */
async function refreshJsxArtifactMtime(
  artifactPath: string,
  modifiedAtMs: number,
  nowMs: number = Date.now(),
): Promise<void> {
  if (nowMs - modifiedAtMs < JSX_CACHE_MTIME_REFRESH_INTERVAL_MS) return;
  const localFs = getLocalFs();
  if (!localFs.utime) return;
  try {
    await localFs.utime(artifactPath, new Date(nowMs), new Date(nowMs));
  } catch (_) {
    /* expected: a concurrent prune may have removed the artifact already */
  }
}

/**
 * Pin every JSX cache artifact the rewritten module imports until the caller
 * releases them, keeping each one's on-disk recency fresh in the meantime.
 *
 * `doLoadModuleESM` performs HTTP caching and bundle recovery between the JSX
 * transform returning its `file://` specifiers and the dynamic import that
 * consumes them, and that phase has no time bound. The references keep every
 * prune pass in this process away from the artifacts for that whole span, and
 * the periodic mtime refresh keeps other processes' grace checks away from
 * them too. The returned release is idempotent and must be called once the
 * parent import has settled, success or failure.
 */
export async function retainJsxArtifactsReferencedIn(code: string): Promise<() => void> {
  const artifactPaths: string[] = [];
  for (const imported of await parseImports(code)) {
    const specifier = imported.n;
    if (!specifier?.startsWith("file://")) continue;
    const artifactPath = specifier.slice("file://".length);
    const name = artifactPath.split("/").at(-1) ?? "";
    if (!name.startsWith(MDX_JSX_CACHE_ROOT_PREFIX) || !name.endsWith(".mjs")) continue;
    artifactPaths.push(artifactPath);
    retainJsxArtifact(artifactPath);
  }
  if (artifactPaths.length === 0) return () => {};

  const refreshAll = async () => {
    await Promise.all(
      artifactPaths.map((artifactPath) => refreshJsxArtifactMtime(artifactPath, 0)),
    );
  };
  await refreshAll();
  const heartbeat = setInterval(() => void refreshAll(), JSX_CACHE_MTIME_REFRESH_INTERVAL_MS);
  unrefTimer(heartbeat);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
    const nowMs = Date.now();
    for (const artifactPath of artifactPaths) {
      // The import just completed, so the module is as recently used as a
      // fresh cache hit: the served mark bridges the release and any
      // immediately following prune pass.
      markJsxArtifactServed(artifactPath, nowMs);
      releaseJsxArtifact(artifactPath);
    }
  };
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
const scheduledJsxCachePrunes = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; fireAtMs: number }
>();

/**
 * Schedule a follow-up prune for variants a preservation rule protected.
 *
 * The prune pass otherwise runs only when a transform writes an artifact, so a
 * burst that puts a path over its window inside one grace period and then goes
 * idle would leave the excess on disk until an unrelated future write. One
 * timer per directory, always at the earliest requested deadline: a pending
 * idle-horizon follow-up hours out must not swallow a grace-period retry due
 * in seconds. The timer is unref'd: cleanup of superseded cache files is never
 * a reason to keep the process alive.
 */
function scheduleJsxCachePruneRetry(esmCacheDir: string, delayMs: number): void {
  const fireAtMs = Date.now() + delayMs;
  const pending = scheduledJsxCachePrunes.get(esmCacheDir);
  if (pending) {
    if (pending.fireAtMs <= fireAtMs) return;
    clearTimeout(pending.timer);
  }
  const timer = setTimeout(() => {
    scheduledJsxCachePrunes.delete(esmCacheDir);
    collectExcessJsxArtifacts(esmCacheDir, new Map(), Date.now()).catch((error) => {
      logger.debug(`${LOG_PREFIX_MDX_LOADER} Scheduled JSX cache prune failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, delayMs);
  unrefTimer(timer);
  scheduledJsxCachePrunes.set(esmCacheDir, { timer, fireAtMs });
}

/** Drop every pending follow-up prune (test isolation only). */
function cancelScheduledJsxCachePrunes(): void {
  for (const pending of scheduledJsxCachePrunes.values()) clearTimeout(pending.timer);
  scheduledJsxCachePrunes.clear();
}

/** Outcome of one removal attempt; a preserved artifact names its retry time. */
type JsxArtifactRemoval = { removed: true } | { removed: false; retryAtMs: number };

/**
 * Remove one artifact unless a render still holds it.
 *
 * The re-checks run under the same per-path lock the cache-hit verification
 * runs under, so selection and removal cannot interleave: a hit that got the
 * lock first has marked the artifact served (or pinned it with an active
 * reference) by the time these checks run, and a removal that got there first
 * leaves the hit a missing file, which it reports as a miss and regenerates.
 * A preserved artifact reports when it next becomes collectable so the caller
 * can schedule a follow-up rather than wait for an unrelated future write.
 */
async function removeJsxArtifactUnlessServed(
  artifactPath: string,
  nowMs: number,
): Promise<JsxArtifactRemoval> {
  return await withJsxArtifactLock(artifactPath, async () => {
    const checkedAtMs = Math.max(nowMs, Date.now());
    if (jsxArtifactActiveRefs.has(artifactPath)) {
      // Release time is the parent import settling, which has no schedule of
      // its own; poll again one grace period out.
      return { removed: false, retryAtMs: checkedAtMs + JSX_CACHE_VARIANT_MIN_AGE_MS };
    }
    const servedAtMs = servedArtifactTimestamps.get(artifactPath);
    if (servedAtMs !== undefined && checkedAtMs - servedAtMs < JSX_CACHE_VARIANT_MIN_AGE_MS) {
      return { removed: false, retryAtMs: servedAtMs + JSX_CACHE_VARIANT_MIN_AGE_MS };
    }
    try {
      await getLocalFs().remove(artifactPath);
    } catch (_) {
      /* expected: a concurrent transform may have removed the variant already */
    }
    return { removed: true };
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
 * grace period and idle floor alone. Beyond the per-path variant window, the
 * pass retires any variant idle past {@link JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS}
 * — the directory-wide backstop that keeps retired source paths from leaking
 * one artifact each — and reclaims artifacts stranded under a superseded
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
    // The grace period still applies, and cache hits refresh mtime, so during
    // a rolling deploy a draining process on the previous namespace keeps the
    // artifacts it is still serving visibly fresh to this check.
    const modifiedAtMs = await readArtifactModifiedAtMs(artifactPath);
    if (nowMs - modifiedAtMs < JSX_CACHE_VARIANT_MIN_AGE_MS) {
      noteRetry(modifiedAtMs + JSX_CACHE_VARIANT_MIN_AGE_MS);
      continue;
    }
    const removal = await removeJsxArtifactUnlessServed(artifactPath, nowMs);
    if (!removal.removed) noteRetry(removal.retryAtMs);
  }

  for (const [prefix, variants] of variantsByPrefix) {
    // The artifact just written, when there is one, counts against the window.
    const retained = MAX_JSX_CACHE_VARIANTS_PER_PATH - (currentByPrefix.has(prefix) ? 1 : 0);

    const dated = await Promise.all(
      variants.map(async (name) => ({
        name,
        modifiedAtMs: await readArtifactModifiedAtMs(join(esmCacheDir, name)),
      })),
    );
    dated.sort((left, right) => right.modifiedAtMs - left.modifiedAtMs);

    for (const [index, { name, modifiedAtMs }] of dated.entries()) {
      const artifactPath = join(esmCacheDir, name);
      const servedAtMs = servedArtifactTimestamps.get(artifactPath) ?? 0;
      const lastUsedMs = Math.max(modifiedAtMs, servedAtMs);
      // A variant over the per-path window goes as soon as its grace period
      // ends. A variant inside the window is bounded by idle age instead:
      // without that, a path retired by a rename keeps its last variants
      // forever, and disk growth tracks edit history again. Cache hits refresh
      // mtime, so an artifact still being served never reads as idle.
      const collectableAtMs = index >= retained
        ? lastUsedMs + JSX_CACHE_VARIANT_MIN_AGE_MS
        : lastUsedMs + JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS;
      if (collectableAtMs > nowMs) {
        noteRetry(collectableAtMs);
        continue;
      }
      const removal = await removeJsxArtifactUnlessServed(artifactPath, nowMs);
      if (!removal.removed) noteRetry(removal.retryAtMs);
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
  jsxArtifactActiveRefCount: (artifactPath: string): number =>
    jsxArtifactActiveRefs.get(artifactPath) ?? 0,
  markJsxArtifactServed,
  MAX_SERVED_ARTIFACT_MEMO_ENTRIES,
  refreshJsxArtifactMtime,
  releaseJsxArtifact,
  retainJsxArtifact,
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
            // prune cannot retire the artifact this render is about to import,
            // and refresh the on-disk mtime so prune passes in other processes
            // see the use too.
            markJsxArtifactServed(transformedPath);
            await refreshJsxArtifactMtime(transformedPath, stat.mtime?.getTime() ?? 0);
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
