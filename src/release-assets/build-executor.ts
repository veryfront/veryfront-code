/**
 * Release Asset Manifest — builder executor.
 *
 * Runs inside the project runtime as the `task:release-asset-build` handler.
 * Materializes a release's file set, transforms every browser module through
 * the SAME pipeline `serveModule` uses (byte parity with the JIT fallback is a
 * hard requirement), compiles route CSS where reachable, content-addresses and
 * uploads each asset, then assembles and PUTs the manifest (→ ready).
 *
 * Defensive by construction: any module transform failure reports `failed` and
 * stops without PUTting, and the temp dir is always cleaned up.
 *
 * @module release-assets/build-executor
 */

import { serverLogger } from "#veryfront/utils";
import { VERSION } from "#veryfront/utils/version.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import { transformToESM } from "#veryfront/transforms/esm-transform.ts";
import { sha256Hex } from "./hash.ts";
import {
  RELEASE_ASSET_BASE_PATH,
  RELEASE_ASSET_CONTENT_TYPES,
  RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
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
function routeForPage(logicalPath: string): string | null {
  if (!logicalPath.startsWith("pages/")) return null;
  const withoutPrefix = logicalPath.slice("pages/".length);
  const withoutExt = withoutPrefix.replace(/\.(tsx|ts|jsx|mdx|js)$/, "");
  const route = withoutExt.replace(/\/index$/, "").replace(/^index$/, "");
  return `/${route}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
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

  // 1. Begin (idempotent).
  await client.beginReleaseAssetManifestBuild(input.releaseVersionRef);

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
  const assetBytes = new Map<string, { bytes: Uint8Array; contentType: string }>();

  for (const [logicalPath, source] of sourceByPath) {
    if (!isBrowserModule(logicalPath)) continue;

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

    const bytes = new TextEncoder().encode(code);
    const contentHash = await sha256Hex(code);
    const entry: PreparedAsset = {
      logicalPath,
      contentHash,
      size: bytes.byteLength,
      contentType: RELEASE_ASSET_CONTENT_TYPES.js,
    };
    modules[logicalPath] = entry;
    if (!assetBytes.has(contentHash)) {
      assetBytes.set(contentHash, { bytes, contentType: RELEASE_ASSET_CONTENT_TYPES.js });
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
        const bytes = new TextEncoder().encode(compiled.css);
        const contentHash = await sha256Hex(compiled.css);
        css.push({
          contentHash,
          size: bytes.byteLength,
          contentType: RELEASE_ASSET_CONTENT_TYPES.css,
          styleProfileHash: compiled.styleProfileHash,
        });
        cssHashes.push(contentHash);
        if (!assetBytes.has(contentHash)) {
          assetBytes.set(contentHash, { bytes, contentType: RELEASE_ASSET_CONTENT_TYPES.css });
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

  // 5a. Upload assets with bounded concurrency.
  await uploadWithConcurrency(uploadQueue, RELEASE_ASSET_UPLOAD_CONCURRENCY, async (asset) => {
    const stored = assetBytes.get(asset.contentHash);
    if (!stored) return;
    await client.uploadReleaseAsset(
      input.releaseVersionRef,
      asset.contentHash,
      stored.contentType,
      stored.bytes,
    );
  });

  // 3b. Routes: map each page to its (page) module + css closure.
  const routes: Record<string, ReleaseAssetRouteEntry> = {};
  for (const logicalPath of Object.keys(modules)) {
    const route = routeForPage(logicalPath);
    if (!route) continue;
    routes[route] = { modules: [logicalPath], css: cssHashes };
  }

  // 6. Assemble and PUT the manifest.
  const sourceContentHash = await sha256Hex(
    [...sourceByPath.keys()].sort().join("\n"),
  );
  const manifest: ReleaseAssetManifest = {
    schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
    projectId: input.projectId,
    releaseId: input.releaseId,
    releaseVersion: input.releaseVersion,
    manifestVersion: 1,
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
