import { serverLogger as logger } from "#veryfront/utils";
import { dirname, isAbsolute, join, normalize } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { buildModuleResolveCacheKey } from "#veryfront/cache/keys.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerLRUCache } from "#veryfront/cache";
import { CACHE_MAX_ENTRIES_LARGE } from "#veryfront/utils/constants/limits.ts";
import { isPathContainedBy } from "#veryfront/platform/adapters/path-containment.ts";
import { isCanonicalNotFoundError } from "#veryfront/platform/compat/not-found-error.ts";

export interface ResolvedModule {
  path: string;
  type: "file" | "virtual" | "external" | "npm";
  content?: string;
  transformed?: boolean;
}

export interface ModuleResolverOptions {
  projectDir: string;
  importMap?: Record<string, string>;
  virtualModules?: Map<string, string>;
  adapter: RuntimeAdapter;
  cacheSize?: number;
}

const MODULE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs"];

export class ModuleResolver {
  private importMap: Record<string, string>;
  private virtualModules: Map<string, string>;
  private cache: LRUCache<string, ResolvedModule>;
  private adapter: RuntimeAdapter;

  constructor(private options: ModuleResolverOptions) {
    this.adapter = options.adapter;
    this.importMap = options.importMap ?? {};
    this.virtualModules = options.virtualModules ?? new Map();
    this.cache = new LRUCache<string, ResolvedModule>({
      maxEntries: options.cacheSize ?? CACHE_MAX_ENTRIES_LARGE,
    });

    // Register cache for monitoring
    registerLRUCache(`module-resolver:${options.projectDir}`, this.cache);
  }

  private cacheAndReturn(cacheKey: string, resolved: ResolvedModule): ResolvedModule {
    this.cache.set(cacheKey, resolved);
    return resolved;
  }

  private isContainedPath(candidatePath: string): boolean {
    const projectDir = normalize(this.options.projectDir);
    const normalizedCandidate = normalize(candidatePath);
    return isPathContainedBy(normalizedCandidate, projectDir);
  }

  private async resolveContainedFile(
    candidatePath: string,
    specifier: string,
  ): Promise<string | null> {
    const projectDir = normalize(this.options.projectDir);
    const normalizedCandidate = normalize(candidatePath);

    if (!this.isContainedPath(normalizedCandidate)) return null;

    if (!await this.adapter.fs.exists(normalizedCandidate)) return null;

    const realPath = this.adapter.fs.realPath;
    if (!realPath) return normalizedCandidate;

    const [projectResult, candidateResult] = await Promise.allSettled([
      realPath.call(this.adapter.fs, projectDir),
      realPath.call(this.adapter.fs, normalizedCandidate),
    ]);
    // A canonical not-found from one path must not mask an operational
    // failure from the other, regardless of which settles first.
    for (const result of [projectResult, candidateResult]) {
      if (result.status === "rejected" && !isCanonicalNotFoundError(result.reason)) {
        throw result.reason;
      }
    }
    if (projectResult.status !== "fulfilled" || candidateResult.status !== "fulfilled") {
      return null;
    }
    const canonicalProjectDir = normalize(projectResult.value);
    const canonicalCandidate = normalize(candidateResult.value);
    if (!isPathContainedBy(canonicalCandidate, canonicalProjectDir)) {
      logger.warn(`Canonical path escape blocked: ${specifier}`);
      return null;
    }

    return canonicalCandidate;
  }

  resolve(specifier: string, referrer?: string): Promise<ResolvedModule | null> {
    return withSpan(
      "modules.resolver.resolve",
      async () => {
        const cacheKey = buildModuleResolveCacheKey(specifier, referrer);
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        logger.debug(`Resolving module: ${specifier} from ${referrer ?? "root"}`);

        const virtualContent = this.virtualModules.get(specifier);
        if (virtualContent !== undefined) {
          return this.cacheAndReturn(cacheKey, {
            path: specifier,
            type: "virtual",
            content: virtualContent,
            transformed: true,
          });
        }

        const mapped = this.importMap[specifier];
        if (mapped) {
          if (mapped.startsWith("http://") || mapped.startsWith("https://")) {
            return this.cacheAndReturn(cacheKey, { path: mapped, type: "external" });
          }
          specifier = mapped;
        }

        if (specifier.startsWith("./") || specifier.startsWith("../")) {
          const refPath = referrer
            ? isAbsolute(referrer) ? referrer : join(this.options.projectDir, referrer)
            : undefined;

          const basePath = refPath ? dirname(refPath) : this.options.projectDir;
          const fullPath = normalize(join(basePath, specifier));
          if (!this.isContainedPath(fullPath)) {
            logger.warn(`Path traversal attempt blocked: ${specifier}`);
            return null;
          }

          for (const ext of MODULE_EXTENSIONS) {
            const pathWithExt = fullPath + ext;
            const resolvedPath = await this.resolveContainedFile(pathWithExt, specifier);
            if (resolvedPath) {
              return this.cacheAndReturn(cacheKey, { path: resolvedPath, type: "file" });
            }
          }

          return null;
        }

        if (specifier.startsWith("/")) {
          const fullPath = join(this.options.projectDir, specifier);
          if (!this.isContainedPath(fullPath)) {
            logger.warn(`Path traversal attempt blocked: ${specifier}`);
            return null;
          }
          const resolvedPath = await this.resolveContainedFile(fullPath, specifier);
          if (resolvedPath) {
            return this.cacheAndReturn(cacheKey, { path: resolvedPath, type: "file" });
          }

          return null;
        }

        if (!specifier.startsWith(".")) {
          return this.cacheAndReturn(cacheKey, {
            path: `https://esm.sh/${specifier}`,
            type: "npm",
          });
        }

        return null;
      },
      { "resolver.specifier": specifier, "resolver.referrer": referrer ?? "root" },
    );
  }

  clearCache(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      return;
    }

    for (const key of [...this.cache.keys()]) {
      if (key.includes(pattern)) this.cache.delete(key);
    }
  }

  addVirtualModule(path: string, content: string): void {
    this.virtualModules.set(path, content);
    this.clearCache(path);
  }

  removeVirtualModule(path: string): void {
    this.virtualModules.delete(path);
    this.clearCache(path);
  }
}
