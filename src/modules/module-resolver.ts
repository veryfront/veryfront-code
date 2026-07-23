import { serverLogger as logger } from "#veryfront/utils";
import {
  dirname,
  fromFileUrl,
  isAbsolute,
  join,
  normalize,
  relative,
} from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  buildModuleResolveCacheKey,
  isModuleResolveCacheKeyForSpecifier,
  parseModuleResolveCacheKey,
} from "#veryfront/cache/keys.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { CACHE_MAX_ENTRIES_LARGE } from "#veryfront/utils/constants/limits.ts";
import { INVALID_ARGUMENT, SERVICE_OVERLOADED } from "#veryfront/errors";
import { resolveImport } from "./import-map/resolver.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";
import { sanitizeImportMap } from "./import-map/merger.ts";

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

const MODULE_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
];
const MAX_MODULE_IDENTITY_LENGTH = 8_192;
const MAX_VIRTUAL_MODULES = 10_000;
const MAX_VIRTUAL_MODULE_BYTES = 5 * 1024 * 1024;

function validateModuleIdentity(value: string, label: string): void {
  if (
    value.length === 0 || value.length > MAX_MODULE_IDENTITY_LENGTH ||
    hasUnsafeControlCharacters(value)
  ) {
    throw INVALID_ARGUMENT.create({ detail: `${label} is invalid` });
  }
}

function cloneResolvedModule(resolved: ResolvedModule): ResolvedModule {
  return { ...resolved };
}

function isPathInsideProject(projectDir: string, candidatePath: string): boolean {
  const relativePath = relative(normalize(projectDir), normalize(candidatePath));
  return relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith("../") &&
      !relativePath.startsWith("..\\") &&
      !isAbsolute(relativePath));
}

export class ModuleResolver {
  private importMap: Record<string, string>;
  private virtualModules: Map<string, string>;
  private cache: LRUCache<string, ResolvedModule>;
  private adapter: RuntimeAdapter;

  constructor(private options: ModuleResolverOptions) {
    validateModuleIdentity(options.projectDir, "projectDir");
    if (options.virtualModules && options.virtualModules.size > MAX_VIRTUAL_MODULES) {
      throw SERVICE_OVERLOADED.create({ detail: "Virtual module capacity exceeded" });
    }
    for (const [path, content] of options.virtualModules ?? []) {
      validateModuleIdentity(path, "virtual module path");
      if (new TextEncoder().encode(content).byteLength > MAX_VIRTUAL_MODULE_BYTES) {
        throw INVALID_ARGUMENT.create({ detail: "Virtual module source exceeds size limit" });
      }
    }
    this.adapter = options.adapter;
    const sanitizedImportMap = sanitizeImportMap({ imports: options.importMap ?? {} });
    if (!sanitizedImportMap?.imports) {
      throw INVALID_ARGUMENT.create({ detail: "Import map is invalid" });
    }
    this.importMap = sanitizedImportMap.imports;
    this.virtualModules = new Map(options.virtualModules ?? []);
    this.cache = new LRUCache<string, ResolvedModule>({
      maxEntries: options.cacheSize ?? CACHE_MAX_ENTRIES_LARGE,
    });
  }

  private cacheAndReturn(cacheKey: string, resolved: ResolvedModule): ResolvedModule {
    this.cache.set(cacheKey, cloneResolvedModule(resolved));
    return cloneResolvedModule(resolved);
  }

  private async isFile(path: string): Promise<boolean> {
    try {
      return (await this.adapter.fs.stat(path)).isFile;
    } catch {
      return false;
    }
  }

  private async resolveFilePath(fullPath: string): Promise<string | null> {
    for (const ext of MODULE_EXTENSIONS) {
      const pathWithExt = fullPath + ext;
      if (await this.isFile(pathWithExt)) return pathWithExt;
    }
    for (const ext of MODULE_EXTENSIONS.slice(1)) {
      const indexPath = join(fullPath, `index${ext}`);
      if (await this.isFile(indexPath)) return indexPath;
    }
    return null;
  }

  resolve(specifier: string, referrer?: string): Promise<ResolvedModule | null> {
    return withSpan(
      "modules.resolver.resolve",
      async () => {
        validateModuleIdentity(specifier, "specifier");
        if (referrer !== undefined) validateModuleIdentity(referrer, "referrer");
        const cacheKey = buildModuleResolveCacheKey(specifier, referrer);
        const cached = this.cache.get(cacheKey);
        if (cached) return cloneResolvedModule(cached);

        logger.debug("Resolving module");

        const virtualContent = this.virtualModules.get(specifier);
        if (virtualContent !== undefined) {
          return this.cacheAndReturn(cacheKey, {
            path: specifier,
            type: "virtual",
            content: virtualContent,
            transformed: true,
          });
        }

        const mapped = resolveImport(specifier, { imports: this.importMap });
        const mappedByImportMap = mapped !== specifier;
        if (mappedByImportMap) {
          validateModuleIdentity(mapped, "mapped specifier");
          if (mapped.startsWith("http://") || mapped.startsWith("https://")) {
            return this.cacheAndReturn(cacheKey, { path: mapped, type: "external" });
          }
          specifier = mapped;
        }

        if (specifier.startsWith("http://") || specifier.startsWith("https://")) {
          return this.cacheAndReturn(cacheKey, { path: specifier, type: "external" });
        }

        if (specifier.startsWith("file:")) {
          let filePath: string;
          try {
            filePath = fromFileUrl(specifier);
          } catch {
            return null;
          }
          validateModuleIdentity(filePath, "file URL path");
          if (!isPathInsideProject(this.options.projectDir, filePath)) {
            logger.warn("Blocked module path outside the project root");
            return null;
          }
          const resolvedPath = await this.resolveFilePath(filePath);
          return resolvedPath
            ? this.cacheAndReturn(cacheKey, { path: resolvedPath, type: "file" })
            : null;
        }

        if (specifier.startsWith("npm:")) {
          const npmSpecifier = specifier.slice(4);
          if (npmSpecifier.length === 0) return null;
          return this.cacheAndReturn(cacheKey, {
            path: `https://esm.sh/${npmSpecifier}`,
            type: "npm",
          });
        }

        if (specifier.startsWith("./") || specifier.startsWith("../")) {
          const refPath = !mappedByImportMap && referrer
            ? isAbsolute(referrer) ? referrer : join(this.options.projectDir, referrer)
            : undefined;

          if (refPath && !isPathInsideProject(this.options.projectDir, refPath)) {
            logger.warn("Blocked module resolution from outside the project root");
            return null;
          }

          const basePath = refPath ? dirname(refPath) : this.options.projectDir;
          const fullPath = normalize(join(basePath, specifier));
          if (!isPathInsideProject(this.options.projectDir, fullPath)) {
            logger.warn("Blocked module path outside the project root");
            return null;
          }

          const resolvedPath = await this.resolveFilePath(fullPath);
          return resolvedPath
            ? this.cacheAndReturn(cacheKey, { path: resolvedPath, type: "file" })
            : null;
        }

        if (specifier.startsWith("/")) {
          const fullPath = join(this.options.projectDir, specifier);
          if (!isPathInsideProject(this.options.projectDir, fullPath)) {
            logger.warn("Blocked module path outside the project root");
            return null;
          }

          const resolvedPath = await this.resolveFilePath(fullPath);
          return resolvedPath
            ? this.cacheAndReturn(cacheKey, { path: resolvedPath, type: "file" })
            : null;
        }

        if (!specifier.startsWith(".")) {
          return this.cacheAndReturn(cacheKey, {
            path: `https://esm.sh/${specifier}`,
            type: "npm",
          });
        }

        return null;
      },
      {},
    );
  }

  clearCache(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      return;
    }
    validateModuleIdentity(pattern, "cache pattern");

    for (const key of [...this.cache.keys()]) {
      const parsed = parseModuleResolveCacheKey(key);
      if (
        parsed &&
        (parsed.specifier.includes(pattern) || parsed.referrer?.includes(pattern))
      ) {
        this.cache.delete(key);
      }
    }
  }

  private clearCachedSpecifier(specifier: string): void {
    for (const key of [...this.cache.keys()]) {
      if (isModuleResolveCacheKeyForSpecifier(key, specifier)) this.cache.delete(key);
    }
  }

  addVirtualModule(path: string, content: string): void {
    validateModuleIdentity(path, "virtual module path");
    if (new TextEncoder().encode(content).byteLength > MAX_VIRTUAL_MODULE_BYTES) {
      throw INVALID_ARGUMENT.create({ detail: "Virtual module source exceeds size limit" });
    }
    if (!this.virtualModules.has(path) && this.virtualModules.size >= MAX_VIRTUAL_MODULES) {
      throw SERVICE_OVERLOADED.create({ detail: "Virtual module capacity exceeded" });
    }
    this.virtualModules.set(path, content);
    this.clearCachedSpecifier(path);
  }

  removeVirtualModule(path: string): void {
    validateModuleIdentity(path, "virtual module path");
    this.virtualModules.delete(path);
    this.clearCachedSpecifier(path);
  }
}
