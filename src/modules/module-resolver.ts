import { serverLogger as logger } from "#veryfront/utils";
import { dirname, isAbsolute, join, normalize, relative } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { buildModuleResolveCacheKey } from "#veryfront/cache/keys.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { CACHE_MAX_ENTRIES_LARGE } from "#veryfront/utils/constants/limits.ts";

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

interface CachedResolution {
  specifier: string;
  referrer?: string;
  resolved: ResolvedModule;
}

const MODULE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs"];

export class ModuleResolver {
  private importMap: Record<string, string>;
  private virtualModules: Map<string, string>;
  private cache: LRUCache<string, CachedResolution>;
  private adapter: RuntimeAdapter;

  constructor(private options: ModuleResolverOptions) {
    this.adapter = options.adapter;
    this.importMap = options.importMap ?? {};
    this.virtualModules = options.virtualModules ?? new Map();
    this.cache = new LRUCache<string, CachedResolution>({
      maxEntries: options.cacheSize ?? CACHE_MAX_ENTRIES_LARGE,
    });
  }

  private cacheAndReturn(
    cacheKey: string,
    specifier: string,
    referrer: string | undefined,
    resolved: ResolvedModule,
  ): ResolvedModule {
    this.cache.set(cacheKey, { specifier, referrer, resolved });
    return resolved;
  }

  resolve(specifier: string, referrer?: string): Promise<ResolvedModule | null> {
    return withSpan(
      "modules.resolver.resolve",
      async () => {
        const requestedSpecifier = specifier;
        const cacheKey = buildModuleResolveCacheKey(specifier, referrer);
        const cached = this.cache.get(cacheKey);
        if (cached) return cached.resolved;

        logger.debug(`Resolving module: ${specifier} from ${referrer ?? "root"}`);

        const virtualContent = this.virtualModules.get(specifier);
        if (virtualContent !== undefined) {
          return this.cacheAndReturn(
            cacheKey,
            requestedSpecifier,
            referrer,
            {
              path: specifier,
              type: "virtual",
              content: virtualContent,
              transformed: true,
            },
          );
        }

        const mapped = this.importMap[specifier];
        if (mapped) {
          if (mapped.startsWith("http://") || mapped.startsWith("https://")) {
            return this.cacheAndReturn(
              cacheKey,
              requestedSpecifier,
              referrer,
              { path: mapped, type: "external" },
            );
          }
          specifier = mapped;
        }

        if (specifier.startsWith("./") || specifier.startsWith("../")) {
          const refPath = referrer
            ? isAbsolute(referrer) ? referrer : join(this.options.projectDir, referrer)
            : undefined;

          const basePath = refPath ? dirname(refPath) : this.options.projectDir;
          const fullPath = normalize(join(basePath, specifier));

          for (const ext of MODULE_EXTENSIONS) {
            const pathWithExt = fullPath + ext;
            if (await this.adapter.fs.exists(pathWithExt)) {
              return this.cacheAndReturn(
                cacheKey,
                requestedSpecifier,
                referrer,
                { path: pathWithExt, type: "file" },
              );
            }
          }

          return null;
        }

        if (specifier.startsWith("/")) {
          const fullPath = join(this.options.projectDir, specifier);
          const relativePath = relative(this.options.projectDir, fullPath);

          if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
            logger.warn(`Path traversal attempt blocked: ${specifier}`);
            return null;
          }

          if (await this.adapter.fs.exists(fullPath)) {
            return this.cacheAndReturn(
              cacheKey,
              requestedSpecifier,
              referrer,
              { path: fullPath, type: "file" },
            );
          }

          return null;
        }

        if (!specifier.startsWith(".")) {
          return this.cacheAndReturn(
            cacheKey,
            requestedSpecifier,
            referrer,
            {
              path: `https://esm.sh/${specifier}`,
              type: "npm",
            },
          );
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

    for (const [key, cached] of [...this.cache.entries()]) {
      if (
        cached.specifier.includes(pattern) ||
        (cached.referrer ?? "root").includes(pattern)
      ) {
        this.cache.delete(key);
      }
    }
  }

  private invalidateSpecifier(specifier: string): void {
    for (const [key, cached] of [...this.cache.entries()]) {
      if (cached.specifier === specifier) this.cache.delete(key);
    }
  }

  addVirtualModule(path: string, content: string): void {
    this.virtualModules.set(path, content);
    this.invalidateSpecifier(path);
  }

  removeVirtualModule(path: string): void {
    this.virtualModules.delete(path);
    this.invalidateSpecifier(path);
  }
}
