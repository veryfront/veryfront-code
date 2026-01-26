/**
 * Static File Handler
 * Serves static files from dist/ and public/ directories
 *
 * Security: Uses secure filesystem wrapper to prevent path traversal attacks
 */
import * as dntShim from "../../../../_dnt.shims.js";


import { BaseHandler } from "../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.js";
import {
  getExtension,
  hasHashedFilename,
  isWithinDirectory,
  joinPath,
  normalizePath,
} from "../../../utils/path-utils.js";
import { computeEtag, hasMatchingEtag } from "../utils/etag.js";
import { getContentType } from "../utils/content-types.js";
import type { CacheStrategy } from "../../../security/index.js";
import { createSecureFs } from "../../../security/index.js";
import type { BuildManifest } from "../../../build/production-build/index.js";
import {
  HTTP_NOT_FOUND,
  HTTP_OK,
  PRIORITY_MEDIUM_STATIC,
} from "../../../utils/constants/index.js";
import { normalizeChunkPath } from "../../../utils/chunk-utils.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";

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

  handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult> {
    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return Promise.resolve(this.continue());
    }

    const pathname = new URL(req.url).pathname;
    if (pathname.startsWith("/_")) {
      return Promise.resolve(this.continue());
    }

    return this.withProxyContext(ctx, async () => {
      const response = await this.tryServeStatic(req, pathname, ctx);
      return response ? this.respond(response) : this.continue();
    });
  }

  private tryServeStatic(
    req: dntShim.Request,
    pathname: string,
    ctx: HandlerContext,
  ): Promise<dntShim.Response | null> {
    return withSpan(
      "static.tryServeStatic",
      async () => {
        const secureFs = createSecureFs({
          baseDir: ctx.projectDir,
          adapter: ctx.adapter,
          context: "static-serving",
          throwOnError: false,
        });

        const tryDirs = ["dist", "public"] as const;
        const reqPath = pathname === "/" ? "/index.html" : pathname;
        const manifestCandidate = await this.resolveManifestAsset(reqPath, ctx);

        const seen = new Set<string>();
        const candidates: Array<{ abs: string; source: "manifest" | (typeof tryDirs)[number] }> =
          [];

        const pushCandidate = (abs: string, source: "manifest" | (typeof tryDirs)[number]) => {
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
          if (!isWithinDirectory(root, abs)) continue;

          pushCandidate(abs, dir);
        }

        this.logDebug(
          `Trying static file candidates`,
          {
            reqPath,
            candidateCount: candidates.length,
            candidates: candidates.map((c) => ({ source: c.source, path: c.abs })),
          },
          ctx,
        );

        const isHead = req.method.toUpperCase() === "HEAD";

        for (const candidate of candidates) {
          try {
            this.logDebug(
              `Checking candidate`,
              { path: candidate.abs, source: candidate.source },
              ctx,
            );

            const info = await secureFs.stat(candidate.abs);
            if (!info.isFile) continue;

            const fileData = await secureFs.readFileBytes(candidate.abs);
            const etag = computeEtag(fileData);

            if (hasMatchingEtag(req, etag)) {
              const builder = this.createResponseBuilder(ctx);
              return builder
                .withCORS(req, ctx.securityConfig?.cors)
                .withSecurity(ctx.securityConfig ?? undefined)
                .notModified(etag);
            }

            const ext = getExtension(candidate.abs);
            const isHashed = hasHashedFilename(candidate.abs);
            const isVeryfrontAsset = reqPath.includes("/_veryfront/");

            let cacheStrategy: CacheStrategy;
            const isPreviewMode = ctx.requestContext?.mode === "preview" &&
              !ctx.requestContext?.isLocalDev;

            if (isPreviewMode) {
              cacheStrategy = "no-cache";
            } else if (
              isHashed ||
              ((candidate.source === "dist" || candidate.source === "manifest") && isVeryfrontAsset)
            ) {
              cacheStrategy = "immutable";
            } else {
              cacheStrategy = "medium";
            }

            const contentType = getContentType(ext);
            const builder = this.createResponseBuilder(ctx);
            // slice() creates a copy with a pure ArrayBuffer (not SharedArrayBuffer)
            const body: dntShim.BodyInit | null = isHead ? null : fileData.slice();

            const response = builder
              .withCORS(req, ctx.securityConfig?.cors)
              .withSecurity(ctx.securityConfig ?? undefined)
              .withCache(cacheStrategy)
              .withETag(etag)
              .withContentType(contentType, body, HTTP_OK);

            this.logDebug(
              `Served static file: ${candidate.abs}`,
              {
                contentType,
                cacheStrategy,
                size: fileData.byteLength,
                source: candidate.source,
              },
              ctx,
            );

            return response;
          } catch (error) {
            this.logDebug(
              `Failed to serve ${candidate.abs}: ${this.getErrorMessage(error)}`,
              { source: candidate.source },
              ctx,
            );
          }
        }

        if (!this.isAssetRequest(pathname)) return null;

        const builder = this.createResponseBuilder(ctx);
        return builder
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined)
          .withCache("no-cache")
          .withContentType(
            "text/plain; charset=utf-8",
            isHead ? null : "Not Found",
            HTTP_NOT_FOUND,
          );
      },
      { "static.pathname": pathname, "static.projectSlug": ctx.projectSlug || "unknown" },
    );
  }

  private async resolveManifestAsset(
    reqPath: string,
    ctx: HandlerContext,
  ): Promise<string | null> {
    const index = await this.loadManifestIndex(ctx);
    if (!index) return null;

    const normalized = normalizePath(reqPath.startsWith("/") ? reqPath : `/${reqPath}`);
    return index.assets.get(normalized) ?? null;
  }

  private async loadManifestIndex(
    ctx: HandlerContext,
  ): Promise<{ assets: Map<string, string>; mtime: number | null } | null> {
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
    const currentMtime = stat.mtime?.getTime() ?? null;

    if (cached && (cached.mtime ?? null) === currentMtime) {
      return cached;
    }

    let loader = StaticHandler.manifestLoading.get(cacheKey);
    if (loader) return await loader;

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
    return await loader;
  }

  private extractManifestAssets(manifest: BuildManifest, distRoot: string): Map<string, string> {
    const assets = new Map<string, string>();

    const addAsset = (requestPath: string | null | undefined) => {
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

  private isAssetRequest(pathname: string): boolean {
    // Don't treat .veryfront directory paths as asset requests
    // They should be handled by the SSR handler
    if (pathname.includes("/.veryfront/") || pathname.startsWith("/.veryfront")) {
      return false;
    }
    // Don't treat .md files as asset requests - they should go through to MarkdownPreviewHandler
    if (pathname.endsWith(".md")) {
      return false;
    }
    return pathname.includes(".") || pathname.startsWith("/_veryfront/");
  }
}
