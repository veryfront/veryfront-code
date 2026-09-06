/**
 * Transforms Mdx
 *
 * @module transforms/mdx
 */

import { rendererLogger as logger } from "#veryfront/utils";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { MDX_RENDERER_MAX_ENTRIES, MDX_RENDERER_TTL_MS } from "#veryfront/utils/constants/cache.ts";
import React from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getRuntimeModuleLoader } from "#veryfront/platform/adapters/module-loader.ts";
import { type ESMLoaderContext, loadModuleESM } from "./esm-module-loader/index.ts";
import type { MDXComponents, MDXFrontmatter, MDXGlobals, MDXModule } from "./types.ts";
import {
  type DependencyPinningSourceInput,
  resolveDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";

export interface MDXRenderOptions {
  components?: MDXComponents;
  frontmatter?: MDXFrontmatter;
  globals?: MDXGlobals;
  extractLayout?: boolean;
  children?: React.ReactNode;
}

/** Options for {@link MDXRenderer.loadModuleESM}. */
export interface MDXLoadModuleOptions {
  adapter?: RuntimeAdapter;
  /** Original source identity, required by an executor-owned module loader. */
  sourcePath?: string;
  projectId?: string;
  projectDir?: string;
  projectSlug?: string;
  contentSourceId?: string;
  /**
   * Render mode for this load. It selects the compile mode of every
   * `/_vf_modules/*` import the compiled entry pulls in. Absent means
   * production.
   */
  mode?: "development" | "production";
  reactVersion?: string;
  serverExternalPackages?: readonly string[];
  dependencyPinningCacheKey?: string;
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  dependencyPinningSource?: DependencyPinningSourceInput;
  moduleServerOrigin?: string;
  isLocalProject?: boolean;
}

function isRuntimeAdapter(value: unknown): value is RuntimeAdapter {
  return typeof value === "object" && value !== null &&
    !("adapter" in value) &&
    ("fs" in value || "env" in value);
}

export class MDXRenderer {
  private moduleCache: LRUCache<string, MDXModule> = new LRUCache({
    maxEntries: MDX_RENDERER_MAX_ENTRIES,
    ttlMs: MDX_RENDERER_TTL_MS,
  });

  clearCache(): void {
    this.moduleCache.destroy();
  }

  loadModuleESM(compiledProgramCode: string, options?: MDXLoadModuleOptions): Promise<MDXModule>;
  loadModuleESM(
    compiledProgramCode: string,
    adapter?: RuntimeAdapter,
    projectId?: string,
    projectDir?: string,
    projectSlug?: string,
    contentSourceId?: string,
    reactVersion?: string,
    dependencyPinningCacheKey?: string,
    dependencyPinningDependencies?: Readonly<Record<string, string>>,
    dependencyPinningSource?: DependencyPinningSourceInput,
    moduleServerOrigin?: string,
    isLocalProject?: boolean,
  ): Promise<MDXModule>;
  async loadModuleESM(
    compiledProgramCode: string,
    optionsOrAdapter: MDXLoadModuleOptions | RuntimeAdapter | undefined = {},
    legacyProjectId?: string,
    legacyProjectDir?: string,
    legacyProjectSlug?: string,
    legacyContentSourceId?: string,
    legacyReactVersion?: string,
    legacyDependencyPinningCacheKey?: string,
    legacyDependencyPinningDependencies?: Readonly<Record<string, string>>,
    legacyDependencyPinningSource?: DependencyPinningSourceInput,
    legacyModuleServerOrigin?: string,
    legacyIsLocalProject?: boolean,
  ): Promise<MDXModule> {
    const options: MDXLoadModuleOptions =
      arguments.length <= 2 && !isRuntimeAdapter(optionsOrAdapter)
        ? (optionsOrAdapter ?? {}) as MDXLoadModuleOptions
        : {
          adapter: optionsOrAdapter as RuntimeAdapter | undefined,
          projectId: legacyProjectId,
          projectDir: legacyProjectDir,
          projectSlug: legacyProjectSlug,
          contentSourceId: legacyContentSourceId,
          reactVersion: legacyReactVersion,
          dependencyPinningCacheKey: legacyDependencyPinningCacheKey,
          dependencyPinningDependencies: legacyDependencyPinningDependencies,
          dependencyPinningSource: legacyDependencyPinningSource,
          moduleServerOrigin: legacyModuleServerOrigin,
          isLocalProject: legacyIsLocalProject,
        };
    const prepared = getRuntimeModuleLoader(options.adapter);
    if (prepared) {
      if (!options.sourcePath) throw new TypeError("Prepared MDX imports require sourcePath");
      const module = await prepared.importModule({ kind: "source", path: options.sourcePath });
      // Older prepared modules expose the compiler-private layout under this alias.
      return !module.MDXLayout && module.__vfLayout
        ? { ...module, MDXLayout: module.__vfLayout } as MDXModule
        : module as MDXModule;
    }
    const {
      adapter,
      projectId,
      projectDir,
      projectSlug,
      contentSourceId,
      mode,
      reactVersion,
      serverExternalPackages,
      dependencyPinningCacheKey,
      dependencyPinningDependencies,
      dependencyPinningSource,
      moduleServerOrigin,
      isLocalProject,
    } = options;
    const resolvedDependencyPinningSource = dependencyPinningSource ?? projectDir;
    const dependencySnapshot = await resolveDependencyPinningSnapshot(
      resolvedDependencyPinningSource,
      dependencyPinningCacheKey,
      dependencyPinningDependencies,
    );
    const context: ESMLoaderContext = {
      esmCacheDir: undefined,
      moduleCache: this.moduleCache,
      adapter,
      projectId,
      projectDir,
      projectSlug,
      contentSourceId,
      mode,
      reactVersion,
      serverExternalPackages,
      dependencyPinningCacheKey: dependencySnapshot.cacheKey,
      dependencyPinningDependencies: dependencySnapshot.dependencies,
      dependencyPinningSource: resolvedDependencyPinningSource,
      moduleServerOrigin: dependencySnapshot.cacheKey.startsWith("on:")
        ? moduleServerOrigin
        : undefined,
      isLocalProject,
    };

    return await loadModuleESM(compiledProgramCode, context);
  }

  render(_compiledCode: string, _options: MDXRenderOptions = {}): React.ReactElement {
    logger.error(
      "[MDX] Synchronous render() called but string-based factories are disabled for security. " +
        "Please use: await mdxRenderer.loadModuleESM(compiledCode) instead.",
    );

    return React.createElement(
      "div",
      {
        style: {
          padding: "1rem",
          backgroundColor: "#fff3cd",
          border: "1px solid #ffc107",
          borderRadius: "0.375rem",
          color: "#856404",
        },
      },
      React.createElement("strong", {}, "Migration Required: "),
      "Synchronous render() is no longer supported for security reasons. ",
      React.createElement("br"),
      "Please update to: ",
      React.createElement("code", {}, "await mdxRenderer.loadModuleESM(compiledCode)"),
    );
  }
}

let mdxRendererInstance: MDXRenderer | undefined;

function getMDXRendererInstance(): MDXRenderer {
  mdxRendererInstance ??= new MDXRenderer();
  return mdxRendererInstance;
}

export const mdxRenderer = new Proxy({} as MDXRenderer, {
  get(_target, prop) {
    const instance = getMDXRendererInstance();
    const value = instance[prop as keyof MDXRenderer];
    return typeof value === "function" ? value.bind(instance) : value;
  },
  set(_target, prop, value) {
    const instance = getMDXRendererInstance();
    (instance as MDXRenderer & Record<string | symbol, unknown>)[prop] = value;
    return true;
  },
  has(_target, prop) {
    return prop in getMDXRendererInstance();
  },
  ownKeys() {
    return Reflect.ownKeys(getMDXRendererInstance());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(getMDXRendererInstance(), prop);
  },
});

export function clearMDXRendererCache(): void {
  getMDXRendererInstance().clearCache();
}

export {
  MDXCacheAdapter,
  type MDXCacheAdapterOptions,
  type MDXCompilationResult,
} from "./mdx-cache-adapter.ts";
