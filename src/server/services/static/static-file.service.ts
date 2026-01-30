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
import { normalizeChunkPath } from "#veryfront/utils/chunk-utils.ts";
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
  /** Whether in local dev mode */
  isLocalDev: boolean;
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
 * Static File Service
 *
 * Handles the business logic of static file serving:
 * - Manifest loading and caching
 * - File candidate resolution
 * - Cache strategy determination
 *
 * Supports optional FileSystemRepository injection for testing.
 *
 * @example
 * ```typescript
 * // Default usage (creates SecureFs internally)
 * const service = new StaticFileService();
 * const result = await service.resolveFile("/style.css", options);
 *
 * // With injected repository (for testing)
 * const mockFs = new MockFileSystemRepository({ context, files: {...} });
 * const service = new StaticFileService(mockFs);
 * ```
 */
export class StaticFileService {
  private static manifestCache = new Map<string, ManifestIndex>();
  private static manifestLoading = new Map<string, Promise<ManifestIndex | null>>();

  /**
   * Optional filesystem repository for dependency injection.
   * When provided, used instead of creating SecureFs internally.
   */
  private readonly fsRepo?: FileSystemRepository;

  /**
   * Create a StaticFileService.
   *
   * @param fsRepo - Optional filesystem repository for testing/DI
   */
  constructor(fsRepo?: FileSystemRepository) {
    this.fsRepo = fsRepo;
  }

  /**
   * Get a filesystem interface for the given options.
   * Uses injected repository if available, otherwise creates SecureFs.
   */
  private getFileSystem(options: StaticFileOptions): FileSystemLike {
    if (this.fsRepo) {
      return this.fsRepo;
    }
    return createSecureFs({
      baseDir: options.projectDir,
      adapter: options.adapter,
      context: "static-serving",
      throwOnError: false,
    });
  }

  /**
   * Resolve a static file from the request path
   */
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

  /**
   * Build list of candidate file paths to check
   */
  private async buildCandidates(
    normalizedPath: string,
    options: StaticFileOptions,
    fs: FileSystemLike,
  ): Promise<Array<{ path: string; source: "manifest" | "dist" | "public" }>> {
    const candidates: Array<{ path: string; source: "manifest" | "dist" | "public" }> = [];
    const seen = new Set<string>();

    const addCandidate = (path: string, source: "manifest" | "dist" | "public") => {
      const normalized = normalizePath(path);
      if (seen.has(normalized)) return;
      seen.add(normalized);
      candidates.push({ path: normalized, source });
    };

    // Try manifest first
    const manifestPath = await this.resolveManifestAsset(normalizedPath, options, fs);
    if (manifestPath) {
      addCandidate(manifestPath, "manifest");
    }

    // Then try dist and public directories
    for (const dir of ["dist", "public"] as const) {
      const root = joinPath(options.projectDir, dir);
      const absPath = normalizePath(joinPath(root, normalizedPath));

      if (isWithinDirectory(root, absPath)) {
        addCandidate(absPath, dir);
      }
    }

    return candidates;
  }

  /**
   * Try to resolve a single candidate path
   */
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
      const ext = getExtension(candidate.path);
      const cacheStrategy = this.determineCacheStrategy(candidate, requestPath, options);

      return {
        path: candidate.path,
        data,
        etag,
        contentType: this.getContentType(ext),
        cacheStrategy,
        source: candidate.source,
      };
    } catch {
      return null;
    }
  }

  /**
   * Determine the appropriate cache strategy for a file
   */
  private determineCacheStrategy(
    candidate: { path: string; source: "manifest" | "dist" | "public" },
    requestPath: string,
    options: StaticFileOptions,
  ): CacheStrategy {
    // Preview mode: no caching
    if (options.isPreviewMode && !options.isLocalDev) {
      return "no-cache";
    }

    // Hashed filenames or veryfront assets from dist/manifest: immutable
    const isHashed = hasHashedFilename(candidate.path);
    const isVeryfrontAsset = requestPath.includes("/_veryfront/");
    if (
      isHashed ||
      ((candidate.source === "dist" || candidate.source === "manifest") && isVeryfrontAsset)
    ) {
      return "immutable";
    }

    // Default: medium caching
    return "medium";
  }

  /**
   * Resolve a request path to a manifest asset path
   */
  private async resolveManifestAsset(
    requestPath: string,
    options: StaticFileOptions,
    fs: FileSystemLike,
  ): Promise<string | null> {
    const index = await this.loadManifestIndex(options, fs);
    if (!index) return null;

    const normalized = normalizePath(
      requestPath.startsWith("/") ? requestPath : `/${requestPath}`,
    );
    return index.assets.get(normalized) ?? null;
  }

  /**
   * Load the build manifest index (with caching)
   */
  private async loadManifestIndex(
    options: StaticFileOptions,
    fs: FileSystemLike,
  ): Promise<ManifestIndex | null> {
    const cacheKey = options.projectDir;
    const distRoot = joinPath(options.projectDir, "dist");
    const manifestPath = joinPath(distRoot, "_veryfront/manifest.json");

    let stat;
    try {
      stat = await fs.stat(manifestPath);
    } catch {
      return null;
    }

    const currentMtime = stat.mtime?.getTime() ?? null;
    const cached = StaticFileService.manifestCache.get(cacheKey);

    if (cached && (cached.mtime ?? null) === currentMtime) {
      return cached;
    }

    // Check if already loading
    let loader = StaticFileService.manifestLoading.get(cacheKey);
    if (loader) return await loader;

    // Load manifest
    loader = (async () => {
      try {
        const manifestRaw = await fs.readFile(manifestPath);
        const manifest = JSON.parse(manifestRaw) as BuildManifest;
        const assets = this.extractManifestAssets(manifest, distRoot);
        const indexValue = { assets, mtime: currentMtime };
        StaticFileService.manifestCache.set(cacheKey, indexValue);
        return indexValue;
      } catch {
        StaticFileService.manifestCache.delete(cacheKey);
        return null;
      } finally {
        StaticFileService.manifestLoading.delete(cacheKey);
      }
    })();

    StaticFileService.manifestLoading.set(cacheKey, loader);
    return await loader;
  }

  /**
   * Extract asset paths from build manifest
   */
  private extractManifestAssets(manifest: BuildManifest, distRoot: string): Map<string, string> {
    const assets = new Map<string, string>();

    const addAsset = (requestPath: string | null | undefined) => {
      if (!requestPath) return;
      const normalized = normalizePath(
        requestPath.startsWith("/") ? requestPath : `/${requestPath}`,
      );
      assets.set(normalized, normalizePath(joinPath(distRoot, normalized)));
    };

    // Extract chunk assets
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

    // Extract route chunks
    for (const route of manifest.routes || []) {
      if (!Array.isArray(route.chunks)) continue;
      for (const chunk of route.chunks) {
        addAsset(normalizeChunkPath(chunk, "/_veryfront/chunks"));
      }
    }

    return assets;
  }

  /**
   * Get content type for file extension
   */
  private getContentType(ext: string): string {
    return getContentTypeFromExt(ext);
  }

  /**
   * Check if a path is an asset request (vs page request)
   */
  isAssetRequest(pathname: string): boolean {
    // .veryfront directory paths should go to SSR
    if (pathname.includes("/.veryfront/") || pathname.startsWith("/.veryfront")) {
      return false;
    }
    // .md files should go to MarkdownPreviewHandler
    if (pathname.endsWith(".md")) {
      return false;
    }
    return pathname.includes(".") || pathname.startsWith("/_veryfront/");
  }

  /**
   * Clear manifest cache (useful for testing)
   */
  static clearCache(): void {
    StaticFileService.manifestCache.clear();
    StaticFileService.manifestLoading.clear();
  }
}
