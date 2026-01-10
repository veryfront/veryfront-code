import { rendererLogger as logger } from "@veryfront/utils";
import { LRUCache } from "@veryfront/utils/lru-wrapper.ts";
import React from "react";
import { MDX_RENDERER_MAX_ENTRIES, MDX_RENDERER_TTL_MS } from "@veryfront/utils/constants/cache.ts";
import { type ESMLoaderContext, loadModuleESM } from "./esm-module-loader.ts";
import {
  executeModule as _executeModule,
  selectComponent as _selectComponent,
} from "./module-executor.ts";
import { type ParsedMDX, parseMDXCode } from "./parser.ts";
import type { MDXComponents, MDXFrontmatter, MDXGlobals, MDXModule } from "./types.ts";

export interface MDXRenderOptions {
  components?: MDXComponents;
  frontmatter?: MDXFrontmatter;
  globals?: MDXGlobals;
  extractLayout?: boolean;
  children?: React.ReactNode;
}

export class MDXRenderer {
  // NOTE: We intentionally do NOT cache esmCacheDir here.
  // Each call to loadModuleESM gets the cache dir fresh from getMdxEsmCacheDir()
  // which uses AsyncLocalStorage for proper isolation in parallel tests.
  // Caching it would cause race conditions where parallel tests corrupt each other's state.

  private moduleCache: LRUCache<string, MDXModule> = new LRUCache({
    maxEntries: MDX_RENDERER_MAX_ENTRIES,
    ttlMs: MDX_RENDERER_TTL_MS,
  });

  constructor() {
  }

  clearCache() {
    this.moduleCache.destroy();
    // Note: We don't track/cleanup esmCacheDir here anymore.
    // Each test context manages its own cache dir via AsyncLocalStorage.
    // The temp directories are cleaned up by the test context's cleanup().
  }

  async loadModuleESM(
    compiledProgramCode: string,
    adapter?: import("@veryfront/platform/adapters/base.ts").RuntimeAdapter,
  ): Promise<MDXModule> {
    // Don't pass esmCacheDir - let loadModuleESM get it fresh from getMdxEsmCacheDir()
    // which respects AsyncLocalStorage for proper test isolation
    const context: ESMLoaderContext = {
      esmCacheDir: undefined, // Always get fresh from getMdxEsmCacheDir()
      moduleCache: this.moduleCache,
      adapter,
    };
    const result = await loadModuleESM(compiledProgramCode, context);
    // Don't cache context.esmCacheDir - it may be for a different AsyncLocalStorage context
    return result;
  }

  render(
    _compiledCode: string,
    _options: MDXRenderOptions = {},
  ): React.ReactElement {
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

  private parseMDXCode(compiledCode: string): ParsedMDX {
    return parseMDXCode(compiledCode);
  }
}

let _mdxRendererInstance: MDXRenderer | undefined;

function getMDXRendererInstance(): MDXRenderer {
  if (!_mdxRendererInstance) {
    _mdxRendererInstance = new MDXRenderer();
  }
  return _mdxRendererInstance;
}

export const mdxRenderer = new Proxy({} as MDXRenderer, {
  get(_target, prop) {
    const instance = getMDXRendererInstance();
    const value = instance[prop as keyof MDXRenderer];
    if (typeof value === "function") {
      return value.bind(instance);
    }
    return value;
  },
  set(_target, prop, value) {
    const instance = getMDXRendererInstance();
    (instance as any)[prop] = value;
    return true;
  },
  has(_target, prop) {
    const instance = getMDXRendererInstance();
    return prop in instance;
  },
  ownKeys(_target) {
    const instance = getMDXRendererInstance();
    return Reflect.ownKeys(instance);
  },
  getOwnPropertyDescriptor(_target, prop) {
    const instance = getMDXRendererInstance();
    return Reflect.getOwnPropertyDescriptor(instance, prop);
  },
});

export function clearMDXRendererCache() {
  getMDXRendererInstance().clearCache();
}

export {
  MDXCacheAdapter,
  type MDXCacheAdapterOptions,
  type MDXCompilationResult,
} from "./mdx-cache-adapter.ts";
