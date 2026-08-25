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
import { SECURITY_VIOLATION } from "#veryfront/errors";
import { serverLogger } from "#veryfront/utils";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { relative, resolve } from "#veryfront/platform/compat/path/index.ts";
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
import {
  CONTENT_TYPES,
  getContentType as getContentTypeFromExt,
} from "../../handlers/utils/content-types.ts";

const logger = serverLogger.component("static-file-service");

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
  /** Configured production build output directory */
  buildOutDir?: string;
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

interface StaticFileSystems {
  buildOutput: FileSystemLike;
  project: FileSystemLike;
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

  private resolveBuildOutputRoot(options: StaticFileOptions): string {
    const projectRoot = resolve(options.projectDir);
    const configuredRoot = resolve(projectRoot, options.buildOutDir || "dist");

    // Project configuration is not a trusted filesystem boundary. Fail loudly
    // instead of serving a different directory from the one the build wrote.
    if (configuredRoot === projectRoot || !isWithinDirectory(projectRoot, configuredRoot)) {
      throw SECURITY_VIOLATION.create({
        detail: "build.outDir must resolve to a directory inside the project",
      });
    }
    return configuredRoot;
  }

  private getFileSystems(options: StaticFileOptions): StaticFileSystems {
    if (this.fsRepo) return { buildOutput: this.fsRepo, project: this.fsRepo };

    const projectRoot = resolve(options.projectDir);
    const projectSecureFs = createSecureFs({
      baseDir: projectRoot,
      adapter: options.adapter,
      context: "static-serving",
    });

    const adaptSecureFs = (
      secureFs: ReturnType<typeof createSecureFs>,
      root: string,
    ): FileSystemLike => {
      const toScopedPath = (path: string): string => relative(root, resolve(path));
      return {
        readFile: (path) => secureFs.readFile(toScopedPath(path)),
        readFileBytes: (path) => secureFs.readFileBytes(toScopedPath(path)),
        stat: (path) => secureFs.stat(toScopedPath(path)),
      };
    };

    // Keep public files under the project policy. Resolve configured output
    // through a project-root boundary as well, so a symlink at the configured
    // output directory cannot become a trusted filesystem root of its own.
    const project = adaptSecureFs(projectSecureFs, projectRoot);
    const buildOutputSecureFs = createSecureFs({
      baseDir: projectRoot,
      adapter: options.adapter,
      context: "internal",
      validationOptions: { checkExists: true, followSymlinks: false },
    });
    return {
      buildOutput: adaptSecureFs(buildOutputSecureFs, projectRoot),
      project,
    };
  }

  async resolveFile(
    requestPath: string,
    options: StaticFileOptions,
  ): Promise<StaticFileResult | null> {
    const fileSystems = this.getFileSystems(options);
    const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
    const candidates = await this.buildCandidates(normalizedPath, options, fileSystems.buildOutput);
    const unexpectedErrors: unknown[] = [];

    for (const candidate of candidates) {
      const fs = candidate.source === "public" ? fileSystems.project : fileSystems.buildOutput;
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

    const buildOutputRoot = this.resolveBuildOutputRoot(options);
    const publicRoot = resolve(options.projectDir, "public");
    const dirs: ReadonlyArray<{
      root: string;
      source: "dist" | "public";
    }> = options.isLocalProject && !options.isPreviewMode
      ? [{ root: publicRoot, source: "public" }]
      : [
        { root: buildOutputRoot, source: "dist" },
        { root: publicRoot, source: "public" },
      ];

    for (const { root, source } of dirs) {
      const absPath = normalizePath(joinPath(root, normalizedPath));
      if (isWithinDirectory(root, absPath)) addCandidate(absPath, source);
    }

    if (this.shouldProbeIndexPage(normalizedPath)) {
      const indexPath = `${normalizedPath.replace(/\/$/, "")}/index.html`;
      for (const { root, source } of dirs) {
        const absPath = normalizePath(joinPath(root, indexPath));
        if (isWithinDirectory(root, absPath)) addCandidate(absPath, source);
      }
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
    } catch (error) {
      // Candidate probing uses exceptions as control flow: this method is called
      // once per candidate location (dist, public, ...). A missing file, or a
      // candidate the security layer rejects (outside the allowed roots), just
      // means "this candidate does not apply" — resolveFile() must still try the
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
    const distRoot = this.resolveBuildOutputRoot(options);
    const cacheKey = distRoot;
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
    if (this.isDeniedDotfile(pathname)) return false;
    return pathname.includes(".") || pathname.startsWith("/_veryfront/") ||
      pathname.startsWith("/_vf/assets/");
  }

  private shouldProbeIndexPage(pathname: string): boolean {
    if (pathname === "/index.html") return false;
    if (pathname.startsWith("/_veryfront/") || pathname.startsWith("/_vf/assets/")) return false;
    if (!this.isAssetRequest(pathname)) return true;
    return !Object.hasOwn(CONTENT_TYPES, getExtension(pathname).toLowerCase());
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
    StaticFileService.manifestCache.clear();
    StaticFileService.manifestLoading.clear();
  }
}
