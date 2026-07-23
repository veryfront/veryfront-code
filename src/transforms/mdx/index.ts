/**
 * Transforms Mdx
 *
 * @module transforms/mdx
 */

import { rendererLogger as logger } from "#veryfront/utils";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { MDX_RENDERER_MAX_ENTRIES, MDX_RENDERER_TTL_MS } from "#veryfront/utils/constants/cache.ts";
import React from "react";
import { type ESMLoaderContext, loadModuleESM } from "./esm-module-loader/index.ts";
import type { MDXComponents, MDXFrontmatter, MDXGlobals, MDXModule } from "./types.ts";

/** Compatibility options accepted by the deprecated synchronous renderer. */
export interface MDXRenderOptions {
  /** Component overrides passed to the compiled MDX component. */
  components?: MDXComponents;
  /** Frontmatter values available to compatibility consumers. */
  frontmatter?: MDXFrontmatter;
  /** Global values available to compatibility consumers. */
  globals?: MDXGlobals;
  /** Whether a legacy caller requested layout extraction. */
  extractLayout?: boolean;
  /** Child content wrapped by a compiled MDX layout. */
  children?: React.ReactNode;
}

/** Stable marker returned by the disabled synchronous MDX renderer. */
export const MDX_SYNC_RENDER_DISABLED = "mdx-sync-render-disabled" as const;

/** Props carried by the synchronous renderer's explicit migration element. */
export interface MDXSyncRenderDisabledProps {
  /** Machine-readable failure identifier. */
  "data-veryfront-error": typeof MDX_SYNC_RENDER_DISABLED;
  /** Stable render outcome for error-boundary integrations. */
  "data-veryfront-render-status": "failed";
  /** Accessibility role for the visible migration notice. */
  role: "alert";
  /** Inline presentation for the visible migration notice. */
  style: React.CSSProperties;
}

/** Explicit compatibility result from the disabled synchronous MDX renderer. */
export interface MDXSyncRenderResult {
  /** Intrinsic element used for the visible migration failure. */
  readonly type: "div";
  /** Marker, accessibility, presentation, and child content properties. */
  readonly props: MDXSyncRenderDisabledProps & { readonly children?: React.ReactNode };
  /** React reconciliation key. */
  readonly key: string | null;
}

/** Cache-backed loader for compiled MDX ESM programs. */
export class MDXRenderer {
  private moduleCache: LRUCache<string, MDXModule> = new LRUCache({
    maxEntries: MDX_RENDERER_MAX_ENTRIES,
    ttlMs: MDX_RENDERER_TTL_MS,
  });

  /** Clear loaded MDX modules. */
  clearCache(): void {
    this.moduleCache.clear();
  }

  /** Load a compiled MDX program through the secure ESM loader. */
  loadModuleESM(
    compiledProgramCode: string,
    adapter?: import("#veryfront/platform/adapters/base.ts").RuntimeAdapter,
    projectId?: string,
    projectDir?: string,
    projectSlug?: string,
    contentSourceId?: string,
    reactVersion?: string,
  ): Promise<MDXModule> {
    const context: ESMLoaderContext = {
      esmCacheDir: undefined,
      moduleCache: this.moduleCache,
      adapter,
      projectId,
      projectDir,
      projectSlug,
      contentSourceId,
      reactVersion,
    };

    return loadModuleESM(compiledProgramCode, context);
  }

  /**
   * Return an explicit migration element because synchronous code evaluation is disabled.
   *
   * @deprecated Use `loadModuleESM()` and render an exported component.
   */
  render(_compiledCode: string, _options: MDXRenderOptions = {}): MDXSyncRenderResult {
    logger.error(
      "[MDX] Synchronous render() called but string-based factories are disabled for security. " +
        "Use await mdxRenderer.loadModuleESM(compiledCode) instead.",
    );

    return React.createElement(
      "div",
      {
        "data-veryfront-error": MDX_SYNC_RENDER_DISABLED,
        "data-veryfront-render-status": "failed",
        role: "alert",
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
      "Use: ",
      React.createElement("code", {}, "await mdxRenderer.loadModuleESM(compiledCode)"),
    ) as MDXSyncRenderResult;
  }
}

const mdxRendererTarget = {} as MDXRenderer;
let mdxRendererInstance: MDXRenderer | undefined;

function getMDXRendererInstance(): MDXRenderer {
  if (mdxRendererInstance === undefined) {
    const created = new MDXRenderer();
    Object.setPrototypeOf(mdxRendererTarget, Object.getPrototypeOf(created));
    Object.defineProperties(
      mdxRendererTarget,
      Object.getOwnPropertyDescriptors(created),
    );
    mdxRendererInstance = mdxRendererTarget;
  }
  return mdxRendererInstance;
}

/** Lazily initialized shared MDX renderer. */
export const mdxRenderer = new Proxy(mdxRendererTarget, {
  get(target, prop, receiver) {
    const instance = getMDXRendererInstance();
    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
  set(target, prop, value, receiver) {
    getMDXRendererInstance();
    return Reflect.set(target, prop, value, receiver);
  },
  has(target, prop) {
    getMDXRendererInstance();
    return Reflect.has(target, prop);
  },
  ownKeys(target) {
    getMDXRendererInstance();
    return Reflect.ownKeys(target);
  },
  getOwnPropertyDescriptor(target, prop) {
    getMDXRendererInstance();
    return Reflect.getOwnPropertyDescriptor(target, prop);
  },
  defineProperty(target, prop, descriptor) {
    getMDXRendererInstance();
    return Reflect.defineProperty(target, prop, descriptor);
  },
  deleteProperty(target, prop) {
    getMDXRendererInstance();
    return Reflect.deleteProperty(target, prop);
  },
  getPrototypeOf(target) {
    getMDXRendererInstance();
    return Reflect.getPrototypeOf(target);
  },
  setPrototypeOf(target, prototype) {
    getMDXRendererInstance();
    return Reflect.setPrototypeOf(target, prototype);
  },
  isExtensible(target) {
    getMDXRendererInstance();
    return Reflect.isExtensible(target);
  },
  preventExtensions(target) {
    getMDXRendererInstance();
    return Reflect.preventExtensions(target);
  },
});

/** Clear the shared MDX renderer's module cache. */
export function clearMDXRendererCache(): void {
  getMDXRendererInstance().clearCache();
}

export {
  createMDXCacheKey,
  MDXCacheAdapter,
  type MDXCacheAdapterOptions,
  type MDXCacheIdentity,
  type MDXCacheKeyInput,
  type MDXCompilationResult,
} from "./mdx-cache-adapter.ts";
