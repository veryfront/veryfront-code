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
}

/**
 * Filesystem interface for StaticFileService
 * Abstraction over SecureFs and FileSystemRepository
 */
interface FileSystemLike {
  readFile(path: string): Promise<string>;
  readFileBytes(path: string): Promise<Uint8Array>;
  stat(path: string): Promise<{ isFile: boolean; mtime: Date | null }>;
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

  async resolveFile(
    requestPath: string,
    options: StaticFileOptions,
  ): Promise<StaticFileResult | null> {
    const fs = this.getFileSystem(options);
    const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
    const candidates = await this.buildCandidates(normalizedPath, options, fs);

    for (const candidate of candidates) {
      const result = await this.tryResolveCandidate(candidate, requestPath, options, fs);
      if (result) return result;
    }

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

    const manifestPath = await this.resolveManifestAsset(normalizedPath, options, fs);
    if (manifestPath) addCandidate(manifestPath, "manifest");

    for (const dir of ["dist", "public"] as const) {
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
  ): Promise<StaticFileResult | null> {
    try {
      const info = await fs.stat(candidate.path);
      if (!info.isFile) return null;

      const data = await fs.readFileBytes(candidate.path);
      const etag = computeEtag(data);

      return {
        path: candidate.path,
        data,
        etag,
        contentType: getContentTypeFromExt(getExtension(candidate.path)),
        cacheStrategy: this.determineCacheStrategy(candidate, requestPath, options),
        source: candidate.source,
      };
    } catch (_) {
      /* expected: file may not exist */
      return null;
    }
  }

  private determineCacheStrategy(
    candidate: { path: string; source: "manifest" | "dist" | "public" },
    requestPath: string,
    options: StaticFileOptions,
  ): CacheStrategy {
    if (options.isPreviewMode && !options.isLocalProject) return "no-cache";

    const isVeryfrontAsset = requestPath.includes("/_veryfront/");
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
    const cacheKey = options.projectDir;
    const distRoot = joinPath(options.projectDir, "dist");
    const manifestPath = joinPath(distRoot, "_veryfront/manifest.json");

    let stat: { isFile: boolean; mtime: Date | null };
    try {
      stat = await fs.stat(manifestPath);
    } catch (_) {
      /* expected: manifest file may not exist */
      return null;
    }

    const currentMtime = stat.mtime?.getTime() ?? null;
    const manifestCache = this.getManifestCache();
    const manifestLoading = this.getManifestLoading();

    const cached = manifestCache.get(cacheKey);
    if (cached?.mtime === currentMtime) return cached;

    const existingLoader = manifestLoading.get(cacheKey);
    if (existingLoader) return await existingLoader;

    const loader = (async (): Promise<ManifestIndex | null> => {
      try {
        const manifestRaw = await fs.readFile(manifestPath);
        const manifest = JSON.parse(manifestRaw) as BuildManifest;
        const assets = this.extractManifestAssets(manifest, distRoot);
        const indexValue: ManifestIndex = { assets, mtime: currentMtime };
        manifestCache.set(cacheKey, indexValue);
        return indexValue;
      } catch (_) {
        /* expected: manifest may be malformed or unreadable */
        manifestCache.delete(cacheKey);
        return null;
      } finally {
        manifestLoading.delete(cacheKey);
      }
    })();

    manifestLoading.set(cacheKey, loader);
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
    return pathname.includes(".") || pathname.startsWith("/_veryfront/");
  }

  static clearCache(): void {
    StaticFileService.manifestCache.clear();
    StaticFileService.manifestLoading.clear();
  }
}
