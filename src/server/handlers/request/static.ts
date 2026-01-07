/**
 * Static File Handler
 * Serves static files from dist/ and public/ directories
 *
 * Security: Uses secure filesystem wrapper to prevent path traversal attacks
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import {
  getExtension,
  hasHashedFilename,
  isWithinDirectory,
  joinPath,
  normalizePath,
} from "@veryfront/utils/path-utils.ts";
import { computeEtag, hasMatchingEtag } from "../utils/etag.ts";
import { getContentType } from "../utils/content-types.ts";
import type { CacheStrategy } from "@veryfront/security";
import { createSecureFs } from "@veryfront/security";
import type { BuildManifest } from "@veryfront/build/production-build/index.ts";
import {
  HTTP_NOT_FOUND,
  HTTP_OK,
  PRIORITY_MEDIUM_STATIC,
} from "@veryfront/core/constants/index.ts";
import { normalizeChunkPath } from "@veryfront/utils/chunk-utils.ts";

export class StaticHandler extends BaseHandler {
  private static manifestCache = new Map<
    string,
    { assets: Map<string, string>; mtime: number | null }
  >();
  private static manifestLoading = new Map<
    string,
    Promise<{ assets: Map<string, string>; mtime: number | null } | null>
  >();

  metadata: HandlerMetadata = {
    name: "StaticHandler",
    priority: PRIORITY_MEDIUM_STATIC as HandlerPriority, // MEDIUM priority
    patterns: [
      { pattern: /^\/[^_].*/, method: "GET" }, // All GET requests not starting with _
      { pattern: /^\/[^_].*/, method: "HEAD" }, // Support HEAD for static files
    ],
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    // Only handle GET and HEAD requests
    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return Promise.resolve(this.continue());
    }

    const url = new URL(req.url);
    const pathname = url.pathname;

    // Skip internal paths
    if (pathname.startsWith("/_")) {
      return Promise.resolve(this.continue());
    }

    // For proxy mode, wrap file access in project context
    return this.withProxyContext(ctx, async () => {
      // Try to serve static file
      const response = await this.tryServeStatic(req, pathname, ctx);
      if (response) {
        return this.respond(response);
      }

      // Not a static file, continue to next handler
      return this.continue();
    });
  }

  private withProxyContext<T>(
    ctx: HandlerContext,
    fn: () => Promise<T>,
  ): Promise<T> {
    // Only use proxy context if we have both token/slug and the adapter supports it
    if (!ctx.projectSlug) {
      return fn();
    }

    const fsWrapper = ctx.adapter.fs as {
      runWithContext?: <T>(
        slug: string,
        token: string,
        fn: () => Promise<T>,
        projectId?: string,
        options?: { productionMode?: boolean; releaseId?: string | null },
      ) => Promise<T>;
    };

    // Multi-project mode: use runWithContext
    if (typeof fsWrapper.runWithContext === "function") {
      // Determine production mode based on domain type
      let isProduction = false;
      if (ctx.parsedDomain?.isVeryfrontDomain) {
        isProduction = ctx.parsedDomain.isDraft === false;
      } else {
        // Custom domain - proxy tells us the environment
        isProduction = ctx.proxyEnvironment === "production";
      }

      this.logDebug("Using multi-project context for static files", {
        projectSlug: ctx.projectSlug,
        projectId: ctx.projectId,
        productionMode: isProduction,
      }, ctx);
      // Token can be empty - the adapter will use fallback token from config
      return fsWrapper.runWithContext(
        ctx.projectSlug,
        ctx.proxyToken || "",
        fn,
        ctx.projectId,
        { productionMode: isProduction },
      );
    }

    return fn();
  }

  private async tryServeStatic(
    req: Request,
    pathname: string,
    ctx: HandlerContext,
  ): Promise<Response | null> {
    // Create secure filesystem wrapper for static file serving
    const secureFs = createSecureFs({
      baseDir: ctx.projectDir,
      adapter: ctx.adapter,
      context: "static-serving",
      throwOnError: false, // Don't throw, just skip invalid paths
    });

    const tryDirs = ["dist", "public"] as const;
    const reqPath = pathname === "/" ? "/index.html" : pathname;
    const manifestCandidate = await this.resolveManifestAsset(reqPath, ctx);

    const seen = new Set<string>();
    const candidates: Array<{ abs: string; source: "manifest" | typeof tryDirs[number] }> = [];

    const pushCandidate = (
      abs: string,
      source: "manifest" | typeof tryDirs[number],
    ) => {
      const normalized = normalizePath(abs);
      if (seen.has(normalized)) return;
      seen.add(normalized);
      candidates.push({ abs: normalized, source });
    };

    if (manifestCandidate) {
      pushCandidate(manifestCandidate, "manifest");
    }

    for (const dir of tryDirs) {
      const root = joinPath(ctx.projectDir, dir);
      const abs = normalizePath(joinPath(root, reqPath));

      // Security check: ensure path is within directory
      // Note: secureFs will perform additional validation
      if (!isWithinDirectory(root, abs)) {
        continue;
      }

      pushCandidate(abs, dir);
    }

    this.logDebug(`Trying static file candidates`, {
      reqPath,
      candidateCount: candidates.length,
      candidates: candidates.map(c => ({ source: c.source, path: c.abs })),
    }, ctx);

    for (const candidate of candidates) {
      try {
        // Use secure filesystem wrapper (automatic path validation)
        this.logDebug(`Checking candidate`, { path: candidate.abs, source: candidate.source }, ctx);
        const info = await secureFs.stat(candidate.abs);
        if (!info.isFile) continue;

        const fileData = await secureFs.readFileBytes(candidate.abs);
        const etag = computeEtag(fileData);

        // Check if-none-match
        if (hasMatchingEtag(req, etag)) {
          const builder = this.createResponseBuilder(ctx);
          return builder
            .withCORS(req, ctx.securityConfig?.cors)
            .withSecurity(ctx.securityConfig ?? undefined)
            .notModified(etag);
        }

        // Determine cache strategy
        const ext = getExtension(candidate.abs);
        const isHashed = hasHashedFilename(candidate.abs);
        const isVeryfrontAsset = reqPath.includes("/_veryfront/");

        let cacheStrategy: CacheStrategy;
        // Immutable cache for hashed files regardless of source directory
        // or for dist/manifest assets including _veryfront resources
        if (
          isHashed ||
          ((candidate.source === "dist" || candidate.source === "manifest") && isVeryfrontAsset)
        ) {
          cacheStrategy = "immutable";
        } else {
          cacheStrategy = "medium";
        }

        const contentType = getContentType(ext);
        const builder = this.createResponseBuilder(ctx);

        // For HEAD requests, don't include body
        // Cast to BodyInit to satisfy type in newer TypeScript/Deno versions
        const body = req.method.toUpperCase() === "HEAD" ? null : fileData as BodyInit;

        const response = builder
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined)
          .withCache(cacheStrategy)
          .withETag(etag)
          .withContentType(contentType, body, HTTP_OK);

        this.logDebug(`Served static file: ${candidate.abs}`, {
          contentType,
          cacheStrategy,
          size: fileData.byteLength,
          source: candidate.source,
        }, ctx);

        return response;
      } catch (error) {
        // File not found or read error, try next candidate
        this.logDebug(
          `Failed to serve ${candidate.abs}: ${this.getErrorMessage(error)}`,
          { source: candidate.source },
          ctx,
        );
        continue;
      }
    }

    if (this.isAssetRequest(pathname)) {
      const builder = this.createResponseBuilder(ctx);
      const isHead = req.method.toUpperCase() === "HEAD";
      return builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined)
        .withCache("no-cache")
        .withContentType(
          "text/plain; charset=utf-8",
          isHead ? null : "Not Found",
          HTTP_NOT_FOUND,
        );
    }

    return null;
  }

  private async resolveManifestAsset(
    reqPath: string,
    ctx: HandlerContext,
  ): Promise<string | null> {
    const index = await this.loadManifestIndex(ctx);
    if (!index) return null;

    const normalized = normalizePath(reqPath.startsWith("/") ? reqPath : `/${reqPath}`);
    const asset = index.assets.get(normalized);
    if (!asset) return null;

    return asset;
  }

  private async loadManifestIndex(
    ctx: HandlerContext,
  ): Promise<{ assets: Map<string, string>; mtime: number | null } | null> {
    // Create secure filesystem wrapper for manifest loading
    const secureFs = createSecureFs({
      baseDir: ctx.projectDir,
      adapter: ctx.adapter,
      context: "static-serving",
      throwOnError: false,
    });

    const cacheKey = ctx.projectDir;
    const distRoot = joinPath(ctx.projectDir, "dist");
    const manifestPath = joinPath(distRoot, "_veryfront/manifest.json");

    let stat;
    try {
      stat = await secureFs.stat(manifestPath);
    } catch {
      return null;
    }

    const cached = StaticHandler.manifestCache.get(cacheKey);
    const cachedMtime = cached?.mtime ?? null;
    const currentMtime = stat.mtime ? stat.mtime.getTime() : null;

    if (cached && cachedMtime === currentMtime) {
      return cached;
    }

    let loader = StaticHandler.manifestLoading.get(cacheKey);
    if (!loader) {
      loader = (async () => {
        try {
          const manifestRaw = await secureFs.readFile(manifestPath);
          const manifest = JSON.parse(manifestRaw) as BuildManifest;
          const assets = this.extractManifestAssets(manifest, distRoot);
          const indexValue = { assets, mtime: currentMtime };
          StaticHandler.manifestCache.set(cacheKey, indexValue);
          return indexValue;
        } catch (error) {
          this.logDebug(
            "Failed to load manifest",
            { error: this.getErrorMessage(error), manifestPath },
            ctx,
          );
          StaticHandler.manifestCache.delete(cacheKey);
          return null;
        } finally {
          StaticHandler.manifestLoading.delete(cacheKey);
        }
      })();
      StaticHandler.manifestLoading.set(cacheKey, loader);
    }

    return await loader;
  }

  private extractManifestAssets(manifest: BuildManifest, distRoot: string): Map<string, string> {
    const assets = new Map<string, string>();
    const addAsset = (requestPath: string | null | undefined) => {
      if (!requestPath) return;
      const normalized = normalizePath(
        requestPath.startsWith("/") ? requestPath : `/${requestPath}`,
      );
      const abs = normalizePath(joinPath(distRoot, normalized));
      assets.set(normalized, abs);
    };

    if (manifest.chunks) {
      for (const chunkInfo of Object.values(manifest.chunks.chunks || {})) {
        if (!chunkInfo || typeof chunkInfo !== "object") continue;
        const chunk = chunkInfo as { file?: string; css?: string; imports?: string[] };
        if (chunk.file) {
          addAsset(normalizeChunkPath(chunk.file, "/_veryfront"));
        }
        if (chunk.css) {
          addAsset(normalizeChunkPath(chunk.css, "/_veryfront"));
        }
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
      if (Array.isArray(route.chunks)) {
        for (const chunk of route.chunks) {
          addAsset(normalizeChunkPath(chunk, "/_veryfront/chunks"));
        }
      }
    }

    return assets;
  }

  private isAssetRequest(pathname: string): boolean {
    return pathname.includes(".") || pathname.startsWith("/_veryfront/");
  }
}
