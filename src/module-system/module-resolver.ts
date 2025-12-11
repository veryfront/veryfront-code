import { serverLogger as logger } from "@veryfront/utils";
import { dirname, isAbsolute, join, relative } from "std/path/mod.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";

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
}

export class ModuleResolver {
  private importMap: Record<string, string>;
  private virtualModules: Map<string, string>;
  private cache = new Map<string, ResolvedModule>();
  private adapter: RuntimeAdapter;

  constructor(private options: ModuleResolverOptions) {
    this.adapter = options.adapter;
    this.importMap = options.importMap ?? {};
    this.virtualModules = options.virtualModules ?? new Map();
  }

  async resolve(specifier: string, referrer?: string): Promise<ResolvedModule | null> {
    const cacheKey = `${specifier}::${referrer || "root"}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    logger.debug(`Resolving module: ${specifier} from ${referrer || "root"}`);

    if (this.virtualModules.has(specifier)) {
      const resolved: ResolvedModule = {
        path: specifier,
        type: "virtual",
        content: this.virtualModules.get(specifier),
        transformed: true,
      };
      this.cache.set(cacheKey, resolved);
      return resolved;
    }

    const mapped = this.importMap[specifier];
    if (mapped) {
      if (mapped.startsWith("http://") || mapped.startsWith("https://")) {
        const resolved: ResolvedModule = {
          path: mapped,
          type: "external",
        };
        this.cache.set(cacheKey, resolved);
        return resolved;
      }
      specifier = mapped;
    }

    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const refPath = referrer
        ? (isAbsolute(referrer) ? referrer : join(this.options.projectDir, referrer))
        : null;
      const basePath = refPath ? dirname(refPath) : this.options.projectDir;
      const fullPath = join(basePath, specifier);

      const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs"];
      for (const ext of extensions) {
        const pathWithExt = fullPath + ext;
        if (await this.adapter.fs.exists(pathWithExt)) {
          const resolved: ResolvedModule = {
            path: pathWithExt,
            type: "file",
          };
          this.cache.set(cacheKey, resolved);
          return resolved;
        }
      }
    }

    if (specifier.startsWith("/")) {
      const fullPath = join(this.options.projectDir, specifier);

      const relativePath = relative(this.options.projectDir, fullPath);
      if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
        logger.warn(`Path traversal attempt blocked: ${specifier}`);
        return null;
      }

      if (await this.adapter.fs.exists(fullPath)) {
        const resolved: ResolvedModule = {
          path: fullPath,
          type: "file",
        };
        this.cache.set(cacheKey, resolved);
        return resolved;
      }
    }

    if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
      const resolved: ResolvedModule = {
        path: `https://esm.sh/${specifier}`,
        type: "npm",
      };
      this.cache.set(cacheKey, resolved);
      return resolved;
    }

    return null;
  }

  clearCache(pattern?: string): void {
    if (pattern) {
      for (const key of this.cache.keys()) {
        if (key.includes(pattern)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
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
