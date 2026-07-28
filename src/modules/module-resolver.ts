import { serverLogger as logger } from "#veryfront/utils";
import { dirname, isAbsolute, join, normalize, relative } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { buildModuleResolveCacheKey } from "#veryfront/cache/keys.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { CACHE_MAX_ENTRIES_LARGE } from "#veryfront/utils/constants/limits.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";

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
const MAX_MODULE_SPECIFIER_LENGTH = 32 * 1024;

function snapshotImportMap(
  importMap: Record<string, string> | undefined,
): Record<string, string> {
  const snapshot = Object.create(null) as Record<string, string>;
  if (!importMap) return snapshot;

  for (const key of Reflect.ownKeys(importMap)) {
    if (typeof key !== "string") continue;
    const descriptor = Reflect.getOwnPropertyDescriptor(importMap, key);
    if (!descriptor?.enumerable) continue;
    if (!("value" in descriptor) || typeof descriptor.value !== "string") {
      throw new TypeError(`Import-map entry "${key}" must be a string data property`);
    }
    if (descriptor.value.length === 0) {
      throw new TypeError(`Import-map entry "${key}" cannot be empty`);
    }
    Object.defineProperty(snapshot, key, {
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }

  return Object.freeze(snapshot);
}

function assertModuleIdentifier(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_MODULE_SPECIFIER_LENGTH ||
    /[\0\r\n]/.test(value)
  ) {
    throw new TypeError(
      `${label} must contain 1 to ${MAX_MODULE_SPECIFIER_LENGTH} characters without NUL or line breaks`,
    );
  }
  return value;
}

export class ModuleResolver {
  private importMap: Record<string, string>;
  private virtualModules: Map<string, string>;
  private cache: LRUCache<string, CachedResolution>;
  private adapter: RuntimeAdapter;
  private readonly projectDir: string;

  constructor(private options: ModuleResolverOptions) {
    this.adapter = options.adapter;
    this.projectDir = normalize(options.projectDir);
    this.importMap = snapshotImportMap(options.importMap);
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
    const immutableResolution = Object.freeze({ ...resolved });
    this.cache.set(cacheKey, {
      specifier,
      referrer,
      resolved: immutableResolution,
    });
    return immutableResolution;
  }

  private isWithinProject(path: string): boolean {
    const relativePath = relative(this.projectDir, path);
    return relativePath === "" ||
      (
        relativePath !== ".." &&
        !relativePath.startsWith("../") &&
        !relativePath.startsWith("..\\") &&
        !isAbsolute(relativePath)
      );
  }

  private async isProjectFile(path: string): Promise<boolean> {
    if (!this.isWithinProject(path)) return false;

    try {
      const stat = await this.adapter.fs.stat(path);
      if (!stat.isFile) return false;

      if (this.adapter.fs.realPath) {
        const canonicalPath = await this.adapter.fs.realPath(path);
        if (!this.isWithinProject(normalize(canonicalPath))) {
          logger.warn(`Symlink escape attempt blocked: ${path}`);
          return false;
        }
      }
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }

  async resolve(specifier: string, referrer?: string): Promise<ResolvedModule | null> {
    const boundedSpecifier = assertModuleIdentifier(specifier, "Module specifier");
    const boundedReferrer = referrer === undefined
      ? undefined
      : assertModuleIdentifier(referrer, "Module referrer");

    return await withSpan(
      "modules.resolver.resolve",
      async () => {
        specifier = boundedSpecifier;
        referrer = boundedReferrer;
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

        const mapped = Object.hasOwn(this.importMap, specifier)
          ? this.importMap[specifier]
          : undefined;
        if (mapped !== undefined) {
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

        if (specifier.startsWith("http://") || specifier.startsWith("https://")) {
          return this.cacheAndReturn(
            cacheKey,
            requestedSpecifier,
            referrer,
            { path: specifier, type: "external" },
          );
        }

        if (specifier.startsWith("./") || specifier.startsWith("../")) {
          const refPath = referrer
            ? isAbsolute(referrer) ? normalize(referrer) : join(this.projectDir, referrer)
            : undefined;

          if (refPath && !this.isWithinProject(refPath)) {
            logger.warn(`Referrer outside project blocked: ${referrer}`);
            return null;
          }

          const basePath = refPath ? dirname(refPath) : this.projectDir;
          const fullPath = normalize(join(basePath, specifier));
          if (!this.isWithinProject(fullPath)) {
            logger.warn(`Path traversal attempt blocked: ${specifier}`);
            return null;
          }

          for (const ext of MODULE_EXTENSIONS) {
            const pathWithExt = fullPath + ext;
            if (await this.isProjectFile(pathWithExt)) {
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
          const fullPath = normalize(join(this.projectDir, specifier));

          if (!this.isWithinProject(fullPath)) {
            logger.warn(`Path traversal attempt blocked: ${specifier}`);
            return null;
          }

          if (await this.isProjectFile(fullPath)) {
            return this.cacheAndReturn(
              cacheKey,
              requestedSpecifier,
              referrer,
              { path: fullPath, type: "file" },
            );
          }

          return null;
        }

        if (specifier.startsWith("npm:")) {
          const npmSpecifier = specifier.slice("npm:".length);
          if (!npmSpecifier) return null;
          return this.cacheAndReturn(
            cacheKey,
            requestedSpecifier,
            referrer,
            {
              path: `https://esm.sh/${npmSpecifier}`,
              type: "npm",
            },
          );
        }

        if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(specifier)) {
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
      {
        "resolver.specifier": boundedSpecifier,
        "resolver.referrer": boundedReferrer ?? "root",
      },
    );
  }

  clearCache(pattern?: string): void {
    if (pattern === undefined) {
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
