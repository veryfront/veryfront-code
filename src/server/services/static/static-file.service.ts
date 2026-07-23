/**
 * Static File Service
 *
 * Business logic for static file serving, extracted from StaticHandler.
 * Handles manifest resolution, file candidate determination, and cache strategy.
 *
 * Supports optional FileSystemRepository injection for testing and advanced use cases.
 *
 * @module server/services/static/static-file-service
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { BuildManifest } from "#veryfront/build/production-build/index.ts";
import type { CacheStrategy } from "#veryfront/security";
import { createSecureFs } from "#veryfront/security";
import { serverLogger } from "#veryfront/utils";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import type { FileSystemRepository } from "#veryfront/repositories/types.ts";
import {
  getExtension,
  hasHashedFilename,
  isWithinDirectory,
  joinPath,
  normalizePath,
} from "#veryfront/utils/path-utils.ts";
import { normalizeChunkPath } from "../../utils/chunk-utils.ts";
import { computeEtag } from "../../handlers/utils/etag.ts";
import { getContentType as getContentTypeFromExt } from "../../handlers/utils/content-types.ts";

const logger = serverLogger.component("static-file-service");

/** Maximum body buffered for one static response. */
export const MAX_STATIC_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_STATIC_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_MANIFEST_CACHE_ENTRIES = 256;

function isExpectedCandidateMiss(error: unknown): boolean {
  if (isNotFoundError(error)) return true;

  const maybeVeryfrontError = error as { name?: unknown; slug?: unknown };
  return error instanceof Error &&
    maybeVeryfrontError.name === "VeryfrontError" &&
    maybeVeryfrontError.slug === "security-violation";
}

/**
 * Result of resolving a static file
 */
export interface StaticFileResult {
  /** Absolute path to the file */
  path: string;
  /** File content as bytes */
  data: Uint8Array;
  /** ETag for caching */
  etag: string;
  /** Content type based on extension */
  contentType: string;
  /** Cache strategy to use */
  cacheStrategy: CacheStrategy;
  /** Source directory (manifest, dist, public) */
  source: "manifest" | "dist" | "public";
}

/**
 * Options for resolving static files
 */
export interface StaticFileOptions {
  /** Project directory root */
  projectDir: string;
  /** Runtime adapter for file system access */
  adapter: RuntimeAdapter;
  /** Whether in preview mode (affects caching) */
  isPreviewMode: boolean;
  /** Whether this is a local filesystem project */
  isLocalProject: boolean;
}

/**
 * Manifest index for fast asset lookup
 */
interface ManifestIndex {
  assets: Map<string, string>;
  mtime: number | null;
  size: number | null;
}

/**
 * Filesystem interface for StaticFileService
 * Abstraction over SecureFs and FileSystemRepository
 */
interface FileSystemLike {
  readFile(path: string): Promise<string>;
  readFileBytes(path: string): Promise<Uint8Array>;
  stat(path: string): Promise<{ isFile: boolean; mtime: Date | null; size?: number }>;
}

/**
 * Injection interface for testing StaticFileService dependencies
 */
interface StaticFileServiceDeps {
  manifestCache?: Map<string, ManifestIndex>;
  manifestLoading?: Map<string, Promise<ManifestIndex | null>>;
}

let injectedDeps: StaticFileServiceDeps | null = null;

/**
 * Inject dependencies for testing. Pass null to reset to defaults.
 */
export function __injectDepsForTests(deps: StaticFileServiceDeps | null): void {
  injectedDeps = deps;
}

export class StaticFileService {
  private static manifestCache = new Map<string, ManifestIndex>();
  private static manifestLoading = new Map<string, Promise<ManifestIndex | null>>();
  private static latestManifestLoad = new Map<string, symbol>();
  private static filesystemIds = new WeakMap<object, number>();
  private static nextFilesystemId = 1;
  private static cacheEpoch = 0;

  private readonly fsRepo?: FileSystemRepository;

  constructor(fsRepo?: FileSystemRepository) {
    this.fsRepo = fsRepo;
  }

  private getManifestCache(): Map<string, ManifestIndex> {
    return injectedDeps?.manifestCache ?? StaticFileService.manifestCache;
  }

  private getManifestLoading(): Map<string, Promise<ManifestIndex | null>> {
    return injectedDeps?.manifestLoading ?? StaticFileService.manifestLoading;
  }

  private getFileSystem(options: StaticFileOptions): FileSystemLike {
    if (this.fsRepo) return this.fsRepo;

    return createSecureFs({
      baseDir: options.projectDir,
      adapter: options.adapter,
      context: "static-serving",
      throwOnError: false,
    });
  }

  private getManifestCacheKey(options: StaticFileOptions): string {
    const filesystem = (this.fsRepo ?? options.adapter.fs) as object;
    let filesystemId = StaticFileService.filesystemIds.get(filesystem);
    if (filesystemId === undefined) {
      filesystemId = StaticFileService.nextFilesystemId++;
      StaticFileService.filesystemIds.set(filesystem, filesystemId);
    }
    return `${filesystemId}:${normalizePath(options.projectDir)}`;
  }

  async resolveFile(
    requestPath: string,
    options: StaticFileOptions,
  ): Promise<StaticFileResult | null> {
    const fs = this.getFileSystem(options);
    const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
    const candidates = await this.buildCandidates(normalizedPath, options, fs);
    const unexpectedErrors: unknown[] = [];

    for (const candidate of candidates) {
      const result = await this.tryResolveCandidate(
        candidate,
        requestPath,
        options,
        fs,
        unexpectedErrors,
      );
      if (result) return result;
    }

    if (unexpectedErrors.length > 0) throw unexpectedErrors[0];

    return null;
  }

  private async buildCandidates(
    normalizedPath: string,
    options: StaticFileOptions,
    fs: FileSystemLike,
  ): Promise<Array<{ path: string; source: "manifest" | "dist" | "public" }>> {
    const candidates: Array<{ path: string; source: "manifest" | "dist" | "public" }> = [];
    const seen = new Set<string>();

    const addCandidate = (path: string, source: "manifest" | "dist" | "public"): void => {
      const normalized = normalizePath(path);
      if (seen.has(normalized)) return;
      seen.add(normalized);
      candidates.push({ path: normalized, source });
    };

    if (!options.isLocalProject) {
      const manifestPath = await this.resolveManifestAsset(normalizedPath, options, fs);
      if (manifestPath) addCandidate(manifestPath, "manifest");
    }

    const dirs = options.isLocalProject && !options.isPreviewMode
      ? ["public"] as const
      : ["dist", "public"] as const;

    for (const dir of dirs) {
      const root = joinPath(options.projectDir, dir);
      const absPath = normalizePath(joinPath(root, normalizedPath));
      if (isWithinDirectory(root, absPath)) addCandidate(absPath, dir);
    }

    return candidates;
  }

  private async tryResolveCandidate(
    candidate: { path: string; source: "manifest" | "dist" | "public" },
    requestPath: string,
    options: StaticFileOptions,
    fs: FileSystemLike,
    unexpectedErrors: unknown[],
  ): Promise<StaticFileResult | null> {
    try {
      const info = await fs.stat(candidate.path);
      if (!info.isFile) return null;
      if (info.size !== undefined) {
        if (!Number.isSafeInteger(info.size) || info.size < 0) {
          throw new TypeError("Static file metadata contains an invalid size");
        }
        if (info.size > MAX_STATIC_FILE_BYTES) {
          throw new RangeError(
            `Static file exceeds the ${MAX_STATIC_FILE_BYTES}-byte serving limit`,
          );
        }
      }

      const data = await fs.readFileBytes(candidate.path);
      if (data.byteLength > MAX_STATIC_FILE_BYTES) {
        throw new RangeError(
          `Static file exceeds the ${MAX_STATIC_FILE_BYTES}-byte serving limit`,
        );
      }
      const etag = await computeEtag(data);

      return {
        path: candidate.path,
        data,
        etag,
        contentType: getContentTypeFromExt(getExtension(candidate.path)),
        cacheStrategy: this.determineCacheStrategy(candidate, requestPath, options),
        source: candidate.source,
      };
    } catch (error) {
      // Candidate probing uses exceptions as control flow: this method is called
      // once per candidate location (dist, public, ...). A missing file, or a
      // candidate the security layer rejects (outside the allowed roots), just
      // means "this candidate does not apply". resolveFile() must still try the
      // remaining candidates, so we fall through to null rather than throwing.
      // Genuinely unexpected errors are logged and recorded for diagnosability,
      // but must not fail resolution of a sibling candidate that would have
      // matched. resolveFile() rethrows the first recorded error only after all
      // candidates miss, so transient I/O failures surface as 5xx instead of
      // cacheable 404s without breaking candidate probing.
      if (!isExpectedCandidateMiss(error)) {
        unexpectedErrors.push(error);
        logger.debug("Static file candidate did not resolve", {
          source: candidate.source,
          errorName: error instanceof Error ? error.name : typeof error,
        });
      }
      return null;
    }
  }

  private determineCacheStrategy(
    candidate: { path: string; source: "manifest" | "dist" | "public" },
    requestPath: string,
    options: StaticFileOptions,
  ): CacheStrategy {
    if (options.isPreviewMode && !options.isLocalProject) return "no-cache";

    const isVeryfrontAsset = requestPath.includes("/_veryfront/") ||
      requestPath.includes("/_vf/assets/");
    if (
      hasHashedFilename(candidate.path) ||
      (isVeryfrontAsset && (candidate.source === "dist" || candidate.source === "manifest"))
    ) {
      return "immutable";
    }

    return "medium";
  }

  private async resolveManifestAsset(
    requestPath: string,
    options: StaticFileOptions,
    fs: FileSystemLike,
  ): Promise<string | null> {
    const index = await this.loadManifestIndex(options, fs);
    if (!index) return null;

    const normalized = normalizePath(requestPath.startsWith("/") ? requestPath : `/${requestPath}`);
    return index.assets.get(normalized) ?? null;
  }

  private async loadManifestIndex(
    options: StaticFileOptions,
    fs: FileSystemLike,
  ): Promise<ManifestIndex | null> {
    const cacheKey = this.getManifestCacheKey(options);
    const distRoot = joinPath(options.projectDir, "dist");
    const manifestPath = joinPath(distRoot, "_veryfront/manifest.json");
    const manifestCache = this.getManifestCache();
    const manifestLoading = this.getManifestLoading();

    let stat: { isFile: boolean; mtime: Date | null; size?: number };
    try {
      stat = await fs.stat(manifestPath);
    } catch (error) {
      manifestCache.delete(cacheKey);
      if (isExpectedCandidateMiss(error)) return null;
      throw error;
    }
    if (!stat.isFile) {
      manifestCache.delete(cacheKey);
      return null;
    }

    const currentMtime = stat.mtime?.getTime() ?? null;
    const currentSize = typeof stat.size === "number" && Number.isSafeInteger(stat.size) &&
        stat.size >= 0
      ? stat.size
      : null;
    if (currentSize !== null && currentSize > MAX_STATIC_MANIFEST_BYTES) {
      manifestCache.delete(cacheKey);
      throw new RangeError(
        `Static build manifest exceeds the ${MAX_STATIC_MANIFEST_BYTES}-byte limit`,
      );
    }

    const cached = manifestCache.get(cacheKey);
    if (
      currentMtime !== null && cached?.mtime === currentMtime &&
      cached.size === currentSize
    ) {
      manifestCache.delete(cacheKey);
      manifestCache.set(cacheKey, cached);
      return cached;
    }
    manifestCache.delete(cacheKey);

    const loadingKey = `${cacheKey}:${currentMtime ?? "unknown"}:${currentSize ?? "unknown"}`;
    const existingLoader = manifestLoading.get(loadingKey);
    if (existingLoader) return await existingLoader;

    const cacheEpoch = StaticFileService.cacheEpoch;
    const loadToken = Symbol(cacheKey);
    StaticFileService.latestManifestLoad.set(cacheKey, loadToken);
    const isLatestLoad = (): boolean =>
      cacheEpoch === StaticFileService.cacheEpoch &&
      StaticFileService.latestManifestLoad.get(cacheKey) === loadToken;
    const loaderRef: { current?: Promise<ManifestIndex | null> } = {};
    const loader = (async (): Promise<ManifestIndex | null> => {
      try {
        const manifestRaw = await fs.readFile(manifestPath);
        if (new TextEncoder().encode(manifestRaw).byteLength > MAX_STATIC_MANIFEST_BYTES) {
          if (isLatestLoad()) manifestCache.delete(cacheKey);
          throw new RangeError(
            `Static build manifest exceeds the ${MAX_STATIC_MANIFEST_BYTES}-byte limit`,
          );
        }
        let assets: Map<string, string>;
        try {
          const manifest = JSON.parse(manifestRaw) as BuildManifest;
          assets = this.extractManifestAssets(manifest, distRoot);
        } catch (cause) {
          throw new TypeError("Static build manifest is invalid", { cause });
        }
        const indexValue: ManifestIndex = {
          assets,
          mtime: currentMtime,
          size: currentSize,
        };
        if (isLatestLoad()) {
          manifestCache.delete(cacheKey);
          manifestCache.set(cacheKey, indexValue);
          while (manifestCache.size > MAX_MANIFEST_CACHE_ENTRIES) {
            const oldestKey = manifestCache.keys().next().value as string | undefined;
            if (oldestKey === undefined) break;
            manifestCache.delete(oldestKey);
          }
        }
        return indexValue;
      } catch (error) {
        if (isLatestLoad()) manifestCache.delete(cacheKey);
        if (isExpectedCandidateMiss(error)) return null;
        throw error;
      } finally {
        if (manifestLoading.get(loadingKey) === loaderRef.current) {
          manifestLoading.delete(loadingKey);
        }
        if (StaticFileService.latestManifestLoad.get(cacheKey) === loadToken) {
          StaticFileService.latestManifestLoad.delete(cacheKey);
        }
      }
    })();
    loaderRef.current = loader;

    manifestLoading.set(loadingKey, loader);
    return await loader;
  }

  private extractManifestAssets(manifest: BuildManifest, distRoot: string): Map<string, string> {
    const assets = new Map<string, string>();

    const addAsset = (requestPath: string | null | undefined): void => {
      if (!requestPath) return;
      const normalized = normalizePath(
        requestPath.startsWith("/") ? requestPath : `/${requestPath}`,
      );
      assets.set(normalized, normalizePath(joinPath(distRoot, normalized)));
    };

    if (manifest.chunks) {
      for (const chunkInfo of Object.values(manifest.chunks.chunks || {})) {
        if (!chunkInfo || typeof chunkInfo !== "object") continue;

        const chunk = chunkInfo as { file?: string; css?: string; imports?: string[] };
        if (chunk.file) addAsset(normalizeChunkPath(chunk.file, "/_veryfront"));
        if (chunk.css) addAsset(normalizeChunkPath(chunk.css, "/_veryfront"));

        if (Array.isArray(chunk.imports)) {
          for (const dependency of chunk.imports) {
            addAsset(normalizeChunkPath(dependency, "/_veryfront/chunks"));
          }
        }
      }

      for (const shared of manifest.chunks.shared || []) {
        addAsset(normalizeChunkPath(shared, "/_veryfront/chunks"));
      }
    }

    for (const route of manifest.routes || []) {
      if (!Array.isArray(route.chunks)) continue;
      for (const chunk of route.chunks) {
        addAsset(normalizeChunkPath(chunk, "/_veryfront/chunks"));
      }
    }

    return assets;
  }

  isAssetRequest(pathname: string): boolean {
    if (pathname.includes("/.veryfront/") || pathname.startsWith("/.veryfront")) return false;
    if (pathname.endsWith(".md")) return false;
    if (this.isDeniedDotfile(pathname)) return false;
    return pathname.includes(".") || pathname.startsWith("/_veryfront/") ||
      pathname.startsWith("/_vf/assets/");
  }

  private isDeniedDotfile(pathname: string): boolean {
    const segments = pathname.split("/");
    for (const segment of segments) {
      if (segment.startsWith(".") && segment !== ".well-known") {
        return true;
      }
    }
    return false;
  }

  static clearCache(): void {
    StaticFileService.cacheEpoch++;
    StaticFileService.manifestCache.clear();
    StaticFileService.manifestLoading.clear();
    StaticFileService.latestManifestLoad.clear();
    injectedDeps?.manifestCache?.clear();
    injectedDeps?.manifestLoading?.clear();
  }
}
