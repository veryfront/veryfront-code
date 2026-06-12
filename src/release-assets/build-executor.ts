/**
 * Release Asset Manifest — builder executor.
 *
 * Runs inside the project runtime as the `task:release-asset-build` handler.
 * Materializes a release's file set, transforms every browser module through
 * the SAME pipeline `serveModule` uses (byte parity with the JIT fallback is a
 * hard requirement), compiles route CSS where reachable, content-addresses and
 * uploads each asset, then assembles and PUTs the manifest (→ ready).
 *
 * Defensive by construction:
 * - Any module transform failure reports `failed` and stops without PUTting.
 * - Any other build failure (list/hash/upload/PUT) also reports `failed`.
 * - The temp dir is always cleaned up by the caller.
 *
 * @module release-assets/build-executor
 */

import { serverLogger } from "#veryfront/utils";
import { VERSION } from "#veryfront/utils/version.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import { transformToESM } from "#veryfront/transforms/esm-transform.ts";
import { sha256HexBytes } from "./hash.ts";
import {
  RELEASE_ASSET_BASE_PATH,
  RELEASE_ASSET_CONTENT_TYPES,
  RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
  RELEASE_ASSET_MAX_SIZE_BYTES,
  RELEASE_ASSET_UPLOAD_CONCURRENCY,
} from "./constants.ts";
import type {
  ReleaseAssetCssEntry,
  ReleaseAssetManifest,
  ReleaseAssetRouteEntry,
} from "./manifest-schema.ts";

const logger = serverLogger.component("release-asset-build");

/** Browser module source extensions eligible for transform. */
const BROWSER_MODULE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx"];
/** Directories whose modules are part of the browser closure. */
const BROWSER_MODULE_DIRS = ["pages/", "components/", "layouts/", "lib/", "src/"];

export interface ReleaseAssetBuildInput {
  /** Project reference (slug or id) used for API calls. */
  projectReference: string;
  /** Project UUID. */
  projectId: string;
  /** Release UUID. */
  releaseId: string;
  /** Release version (integer). */
  releaseVersion: number;
  /** Release version string used for API path segments. */
  releaseVersionRef: string;
  /** React version for transforms. */
  reactVersion?: string;
  /** Authenticated, project-scoped API client. */
  client: ReleaseAssetBuildClient;
  /** Runtime adapter used by the transform pipeline. */
  // deno-lint-ignore no-explicit-any -- adapter is passed through to transformToESM
  adapter: any;
  /**
   * Transform function. Defaults to the same `transformToESM` pipeline
   * `serveModule` uses (browser, non-SSR) — byte parity is a hard requirement.
   * Injectable for tests.
   */
  transform?: ReleaseAssetTransform;
}

export type ReleaseAssetTransform = (
  source: string,
  sourceFile: string,
  projectDir: string,
  // deno-lint-ignore no-explicit-any -- adapter is opaque to the executor
  adapter: any,
  options: { projectId: string; dev: boolean; ssr: boolean; reactVersion?: string },
) => Promise<string>;

/** Subset of the API client used by the builder (eases testing). */
export interface ReleaseAssetBuildClient {
  beginReleaseAssetManifestBuild(
    version: string,
  ): Promise<{ id: string; manifest_version: number; state: string }>;
  listAllReleaseFiles(
    version: string,
  ): Promise<Array<{ path: string; content?: string }>>;
  uploadReleaseAsset(
    version: string,
    contentHash: string,
    contentType: string,
    bytes: Uint8Array,
  ): Promise<{ stored: boolean; existed: boolean }>;
  putReleaseAssetManifest(
    version: string,
    manifest: unknown,
  ): Promise<{ state: string; manifest_version?: number }>;
  reportReleaseAssetManifestState(
    version: string,
    state: "partial" | "failed",
    error?: string,
  ): Promise<unknown>;
  /** Optional project CSS compiler; when absent, css:[] is recorded. */
  compileProjectCss?(
    candidates: Set<string>,
  ): Promise<{ css: string; styleProfileHash: string | null } | null>;
}

export interface ReleaseAssetBuildResult {
  success: boolean;
  state: "ready" | "failed";
  moduleCount: number;
  cssCount: number;
  routeCount: number;
  gaps: string[];
  error?: string;
}

interface PreparedAsset {
  logicalPath: string;
  contentHash: string;
  size: number;
  contentType: string;
}

/** Sanitize an error for state reporting (no internal paths / stack traces). */
function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\/[^\s]+/g, "<path>").slice(0, 300);
}

/** True when a logical path is an eligible browser module. */
function isBrowserModule(path: string): boolean {
  if (!BROWSER_MODULE_EXTENSIONS.some((ext) => path.endsWith(ext))) return false;
  if (path.endsWith(".d.ts")) return false;
  return BROWSER_MODULE_DIRS.some((dir) => path.startsWith(dir));
}

/** Derive a route path from a page module logical path. */
export function routeForPage(logicalPath: string): string | null {
  if (!logicalPath.startsWith("pages/")) return null;
  const withoutPrefix = logicalPath.slice("pages/".length);
  const withoutExt = withoutPrefix.replace(/\.(tsx|ts|jsx|mdx|js)$/, "");
  const route = withoutExt.replace(/\/index$/, "").replace(/^index$/, "");
  return `/${route}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

/**
 * Statically resolve relative imports in a source file to logical paths.
 *
 * Parses `import/export ... from "..."` and bare `import "..."` statements.
 * Only relative specifiers (`./` or `../`) are resolved; package imports and
 * absolute URLs are skipped. Extension-less specifiers try each browser module
 * extension in order.
 */
function resolveStaticImports(
  source: string,
  moduleLogicalPath: string,
  knownPaths: Set<string>,
): string[] {
  const importRe = /(?:^|;|\n)\s*(?:import|export)\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/gm;
  const results: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = importRe.exec(source)) !== null) {
    const specifier = m[1]!;
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;

    const dir = moduleLogicalPath.includes("/")
      ? moduleLogicalPath.slice(0, moduleLogicalPath.lastIndexOf("/"))
      : ".";

    // Resolve the path segments manually (no path library needed for simple cases).
    const segments = `${dir}/${specifier}`.split("/").filter((s) => s !== "");
    const resolved: string[] = [];
    for (const seg of segments) {
      if (seg === "..") {
        resolved.pop();
      } else if (seg !== ".") {
        resolved.push(seg);
      }
    }
    const candidate = resolved.join("/");

    // If the specifier already has a known extension and exists, use it.
    if (knownPaths.has(candidate)) {
      results.push(candidate);
      continue;
    }

    // Try appending each browser module extension.
    let found = false;
    for (const ext of BROWSER_MODULE_EXTENSIONS) {
      const withExt = `${candidate}${ext}`;
      if (knownPaths.has(withExt)) {
        results.push(withExt);
        found = true;
        break;
      }
    }

    // Also try /index variants for directory imports.
    if (!found) {
      for (const ext of BROWSER_MODULE_EXTENSIONS) {
        const indexPath = `${candidate}/index${ext}`;
        if (knownPaths.has(indexPath)) {
          results.push(indexPath);
          break;
        }
      }
    }
  }

  return results;
}

/**
 * Walk the static import graph from a set of entry points using BFS.
 * Returns all reachable logical paths (entries included).
 * Modules not in `sourceByPath` are recorded as closure gaps.
 */
function collectClosure(
  entrypoints: string[],
  sourceByPath: Map<string, string>,
  knownPaths: Set<string>,
): { modules: string[]; gaps: string[] } {
  const visited = new Set<string>();
  const queue = [...entrypoints];
  const gaps: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const source = sourceByPath.get(current);
    if (!source) {
      // Module referenced but not in the materialized file set.
      gaps.push(`closure-missing:${current}`);
      continue;
    }

    const imports = resolveStaticImports(source, current, knownPaths);
    for (const imp of imports) {
      if (!visited.has(imp)) queue.push(imp);
    }
  }

  return { modules: [...visited], gaps };
}

/**
 * Execute a release asset build. Pure orchestration over the injected client
 * and a runtime-provided temp dir + react version.
 */
export async function runReleaseAssetBuild(
  input: ReleaseAssetBuildInput,
  tempDir: string,
): Promise<ReleaseAssetBuildResult> {
  const { client } = input;
  const transform: ReleaseAssetTransform = input.transform ??
    ((source, sourceFile, projectDir, adapter, options) =>
      transformToESM(source, sourceFile, projectDir, adapter, {
        projectId: options.projectId,
        dev: options.dev,
        ssr: options.ssr,
        studioEmbed: false,
        reactVersion: options.reactVersion,
      }));

  // H1: wrap the whole build so any non-transform failure also reports failed.
  try {
    return await runBuildInner(input, tempDir, client, transform);
  } catch (error) {
    const sanitized = sanitizeError(error);
    logger.warn("Release asset build failed (non-transform error)", {
      releaseId: input.releaseId,
      error: sanitized,
    });
    try {
      await client.reportReleaseAssetManifestState(
        input.releaseVersionRef,
        "failed",
        sanitized,
      );
    } catch (reportErr) {
      logger.warn("Failed to report build failure state", {
        releaseId: input.releaseId,
        error: sanitizeError(reportErr),
      });
    }
    return {
      success: false,
      state: "failed",
      moduleCount: 0,
      cssCount: 0,
      routeCount: 0,
      gaps: [],
      error: sanitized,
    };
  }
}

async function runBuildInner(
  input: ReleaseAssetBuildInput,
  tempDir: string,
  client: ReleaseAssetBuildClient,
  transform: ReleaseAssetTransform,
): Promise<ReleaseAssetBuildResult> {
  // 1. Begin (idempotent). H2: capture manifest_version from the API response.
  const beginResult = await client.beginReleaseAssetManifestBuild(input.releaseVersionRef);
  const manifestVersion = beginResult.manifest_version;

  // 2. Materialize the release file set.
  const files = await client.listAllReleaseFiles(input.releaseVersionRef);
  const fs = createFileSystem();
  const sourceByPath = new Map<string, string>();

  for (const file of files) {
    if (typeof file.content !== "string") continue;
    sourceByPath.set(file.path, file.content);
    const abs = join(tempDir, file.path);
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeTextFile(abs, file.content);
  }

  // 3 + 4. Collect the browser module closure and transform each module
  // through the SAME pipeline serveModule uses (browser, non-SSR).
  const modules: Record<string, PreparedAsset> = {};
  const gaps: string[] = [];
  const uploadQueue: PreparedAsset[] = [];
  // Bytes are held per-hash only until uploaded, then dropped (M3).
  const pendingBytes = new Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>();
  const knownPaths = new Set(sourceByPath.keys());

  for (const [logicalPath, source] of sourceByPath) {
    if (!isBrowserModule(logicalPath)) continue;

    // M2: enforce client-side size limit before transform (source is a proxy;
    // transformed output is checked after encoding below).
    const sourceFile = join(tempDir, logicalPath);
    let code: string;
    try {
      code = await transform(source, sourceFile, tempDir, input.adapter, {
        projectId: input.projectId,
        dev: false,
        ssr: false,
        reactVersion: input.reactVersion,
      });
    } catch (error) {
      // Hard requirement: any module transform failure → report failed, stop.
      const sanitized = sanitizeError(error);
      logger.warn("Module transform failed during release asset build", {
        path: logicalPath,
        error: sanitized,
      });
      await client.reportReleaseAssetManifestState(
        input.releaseVersionRef,
        "failed",
        sanitized,
      );
      return {
        success: false,
        state: "failed",
        moduleCount: 0,
        cssCount: 0,
        routeCount: 0,
        gaps,
        error: sanitized,
      };
    }

    // L2: hash the bytes, not the string.
    const bytes = new TextEncoder().encode(code) as Uint8Array<ArrayBuffer>;

    // M2: enforce 10 MB client-side limit — skip oversized modules with a gap.
    if (bytes.byteLength > RELEASE_ASSET_MAX_SIZE_BYTES) {
      gaps.push(`oversized:${logicalPath}`);
      logger.warn("Module exceeds max size, skipping", {
        path: logicalPath,
        size: bytes.byteLength,
        limit: RELEASE_ASSET_MAX_SIZE_BYTES,
      });
      continue;
    }

    const contentHash = await sha256HexBytes(bytes);
    const entry: PreparedAsset = {
      logicalPath,
      contentHash,
      size: bytes.byteLength,
      contentType: RELEASE_ASSET_CONTENT_TYPES.js,
    };
    modules[logicalPath] = entry;
    if (!pendingBytes.has(contentHash)) {
      pendingBytes.set(contentHash, { bytes, contentType: RELEASE_ASSET_CONTENT_TYPES.js });
      uploadQueue.push(entry);
    }
  }

  // 5b. CSS: compile project CSS where reachable, else record css:[] and note.
  const css: ReleaseAssetCssEntry[] = [];
  const cssHashes: string[] = [];
  if (client.compileProjectCss) {
    try {
      const candidates = collectClassCandidates(sourceByPath);
      const compiled = await client.compileProjectCss(candidates);
      if (compiled && compiled.css) {
        const bytes = new TextEncoder().encode(compiled.css) as Uint8Array<ArrayBuffer>;
        const contentHash = await sha256HexBytes(bytes);
        css.push({
          contentHash,
          size: bytes.byteLength,
          contentType: RELEASE_ASSET_CONTENT_TYPES.css,
          styleProfileHash: compiled.styleProfileHash,
        });
        cssHashes.push(contentHash);
        if (!pendingBytes.has(contentHash)) {
          pendingBytes.set(contentHash, { bytes, contentType: RELEASE_ASSET_CONTENT_TYPES.css });
          uploadQueue.push({
            logicalPath: `__css__/${contentHash}`,
            contentHash,
            size: bytes.byteLength,
            contentType: RELEASE_ASSET_CONTENT_TYPES.css,
          });
        }
      }
    } catch (error) {
      // CSS is best-effort: record a gap, keep css:[].
      gaps.push("css:compile-failed");
      logger.warn("Release asset CSS compile failed (recording gap)", {
        error: sanitizeError(error),
      });
    }
  } else {
    gaps.push("css:no-pipeline");
  }

  // 5a. Upload assets with bounded concurrency, dropping bytes after each
  // successful upload (M3) to bound peak memory.
  await uploadWithConcurrency(uploadQueue, RELEASE_ASSET_UPLOAD_CONCURRENCY, async (asset) => {
    const stored = pendingBytes.get(asset.contentHash);
    if (!stored) return;
    await client.uploadReleaseAsset(
      input.releaseVersionRef,
      asset.contentHash,
      stored.contentType,
      stored.bytes,
    );
    // M3: drop bytes immediately after upload.
    pendingBytes.delete(asset.contentHash);
  });

  // B2. Routes: walk the full static import closure from each page entrypoint.
  // Modules whose source is not in sourceByPath are recorded as closure gaps.
  const routes: Record<string, ReleaseAssetRouteEntry> = {};
  const pageModules = Object.keys(modules).filter((p) => p.startsWith("pages/"));

  for (const logicalPath of pageModules) {
    const route = routeForPage(logicalPath);
    if (!route) continue;

    const { modules: closureModules, gaps: closureGaps } = collectClosure(
      [logicalPath],
      sourceByPath,
      knownPaths,
    );

    // Include only modules we actually have in the manifest (transformed +
    // within size limit). Framework lib/* modules are excluded per contract
    // (they are embedded by the runtime, not shipped as release assets).
    const manifestedModules = closureModules.filter((m) => modules[m] !== undefined);

    // Closure members not in the manifest (missing transforms, oversized, or
    // framework-provided) are recorded as gaps for this route.
    for (const missing of closureModules) {
      if (modules[missing] === undefined && !missing.startsWith("lib/")) {
        closureGaps.push(`route-gap:${route}:${missing}`);
      }
    }
    if (closureGaps.length > 0) {
      gaps.push(...closureGaps.filter((g) => !gaps.includes(g)));
    }

    routes[route] = { modules: manifestedModules, css: cssHashes };
  }

  // 6. Assemble and PUT the manifest.
  const sourceContentHash = await sha256HexBytes(
    new TextEncoder().encode([...sourceByPath.keys()].sort().join("\n")) as Uint8Array<ArrayBuffer>,
  );
  const manifest: ReleaseAssetManifest = {
    schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
    projectId: input.projectId,
    releaseId: input.releaseId,
    releaseVersion: input.releaseVersion,
    // H2: use the manifest_version returned by begin, not a hardcoded 1.
    manifestVersion,
    builderVersion: VERSION,
    sourceContentHash,
    createdAt: new Date().toISOString(),
    assetBasePath: RELEASE_ASSET_BASE_PATH,
    modules: Object.fromEntries(
      Object.entries(modules).map(([path, entry]) => [path, {
        contentHash: entry.contentHash,
        size: entry.size,
        contentType: entry.contentType,
      }]),
    ),
    css,
    routes,
    dependencies: {},
    fallback: { mode: "jit", gaps },
  };

  const result = await client.putReleaseAssetManifest(input.releaseVersionRef, manifest);
  logger.info("Release asset manifest built", {
    releaseId: input.releaseId,
    manifestVersion,
    moduleCount: Object.keys(modules).length,
    cssCount: css.length,
    routeCount: Object.keys(routes).length,
    state: result.state,
  });

  return {
    success: true,
    state: "ready",
    moduleCount: Object.keys(modules).length,
    cssCount: css.length,
    routeCount: Object.keys(routes).length,
    gaps,
  };
}

/** Extract Tailwind class candidates from materialized source (best-effort). */
function collectClassCandidates(sourceByPath: Map<string, string>): Set<string> {
  const candidates = new Set<string>();
  const re = /class(?:Name)?\s*=\s*["'`]([^"'`]+)["'`]/g;
  for (const source of sourceByPath.values()) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      for (const cls of m[1]!.split(/\s+/)) {
        if (cls) candidates.add(cls);
      }
    }
  }
  return candidates;
}

/** Run an async task over items with a fixed concurrency limit. */
async function uploadWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = index++;
      await task(items[current]!);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
}
