import { rendererLogger as logger } from "../../utils/index.js";
import { LRUCache } from "../../utils/lru-wrapper.js";
import { MDX_RENDERER_MAX_ENTRIES, MDX_RENDERER_TTL_MS } from "../../utils/constants/cache.js";
import React from "react";
import { type ESMLoaderContext, loadModuleESM } from "./esm-module-loader/index.js";
import { type ParsedMDX, parseMDXCode } from "./parser.js";
import type { MDXComponents, MDXFrontmatter, MDXGlobals, MDXModule } from "./types.js";

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

  clearCache(): void {
    this.moduleCache.destroy();
    // Note: We don't track/cleanup esmCacheDir here anymore.
    // Each test context manages its own cache dir via AsyncLocalStorage.
    // The temp directories are cleaned up by the test context's cleanup().
  }

  loadModuleESM(
    compiledProgramCode: string,
    adapter?: import("../../platform/adapters/base.js").RuntimeAdapter,
    projectId?: string,
    projectDir?: string,
    projectSlug?: string,
    contentSourceId?: string,
  ): Promise<MDXModule> {
    // Don't pass esmCacheDir - let loadModuleESM get it fresh from getMdxEsmCacheDir()
    // which respects AsyncLocalStorage for proper test isolation
    const context: ESMLoaderContext = {
      esmCacheDir: undefined, // Always get fresh from getMdxEsmCacheDir()
      moduleCache: this.moduleCache,
      adapter,
      projectId,
      projectDir,
      projectSlug,
      contentSourceId, // For cache isolation between preview/production
    };

    return loadModuleESM(compiledProgramCode, context);
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

  private parseMDXCode(compiledCode: string): ParsedMDX {
    return parseMDXCode(compiledCode);
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
    (instance as unknown as Record<string | symbol, unknown>)[prop] = value;
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
} from "./mdx-cache-adapter.js";
