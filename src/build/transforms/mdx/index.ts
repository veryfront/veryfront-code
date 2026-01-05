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
  private esmCacheDir?: string;
  private moduleCache: LRUCache<string, MDXModule> = new LRUCache({
    maxEntries: MDX_RENDERER_MAX_ENTRIES,
    ttlMs: MDX_RENDERER_TTL_MS,
  });

  constructor() {
  }

  async clearCache() {
    this.moduleCache.destroy();

    if (this.esmCacheDir) {
      try {
        const { getAdapter } = await import("@veryfront/platform/adapters/detect.ts");
        const adapter = await getAdapter();
        await adapter.fs.remove(this.esmCacheDir, { recursive: true });
      } catch (_error) {
        void _error;
      }
      this.esmCacheDir = undefined;
    }
  }

  async loadModuleESM(
    compiledProgramCode: string,
    adapter?: import("@veryfront/platform/adapters/base.ts").RuntimeAdapter,
  ): Promise<MDXModule> {
    const context: ESMLoaderContext = {
      esmCacheDir: this.esmCacheDir,
      moduleCache: this.moduleCache,
      adapter,
    };
    const result = await loadModuleESM(compiledProgramCode, context);
    this.esmCacheDir = context.esmCacheDir;
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

export async function clearMDXRendererCache() {
  await getMDXRendererInstance().clearCache();
}

export {
  MDXCacheAdapter,
  type MDXCacheAdapterOptions,
  type MDXCompilationResult,
} from "./mdx-cache-adapter.ts";
