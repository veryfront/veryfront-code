import { computeContentSourceId } from "#veryfront/cache/keys.ts";
import {
  isExplicitlyLocalProject,
  isHostProjectCodeExecutionAllowed,
  requiresIsolatedProjectRuntime,
} from "#veryfront/security/project-locality.ts";
import { isBun, isNode } from "#veryfront/platform/compat/runtime.ts";
import {
  captureLocalReactPeers,
  type LocalReactPeerSnapshot,
} from "#veryfront/platform/compat/react-paths.ts";
import { getRuntimeModuleLoader } from "#veryfront/platform/adapters/module-loader.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import { loadModuleFromSource } from "#veryfront/modules/react-loader/component-loader.ts";
import {
  getProjectReact,
  getReactDOMServer,
} from "#veryfront/react/compat/ssr-adapter/server-loader.ts";
import { renderToStringAdapter } from "#veryfront/react";
import { resolveProjectReactVersion } from "#veryfront/transforms/esm/package-registry.ts";
import { join } from "#veryfront/compat/path/index.ts";
import type { CapturedDependencyConfiguration } from "#veryfront/transforms/esm/dependency-snapshot.ts";
import { computeHash, rendererLogger } from "#veryfront/utils";
import { PROJECT_EXECUTION_UNAVAILABLE, RENDER_ERROR } from "#veryfront/errors";
import type { RenderMetadata } from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";
import type { HTMLGenerationOptions } from "#veryfront/html";
import { wrapInHTMLShell } from "#veryfront/html/html-shell-generator.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import { escapeHtml } from "#veryfront/html/html-escape.ts";
import {
  type CacheBackend,
  createCacheBackend,
  MemoryCacheBackend,
} from "#veryfront/cache/backend.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  createDependencyPinningSource,
  type DependencyPinningSource,
  getDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { appendDependencyPinningKey } from "#veryfront/transforms/import-rewriter/url-builder.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { resolveProdHydrationModulePath } from "#veryfront/html/hydration-script-builder/prod-runtime-selection.ts";

const logger = rendererLogger.component("snippet-renderer");

const SNIPPET_CACHE_MAX_ENTRIES = 500;
const SNIPPET_CACHE_TTL_MS = 10 * 60 * 1_000; // 10 minutes
const SNIPPET_DISTRIBUTED_CACHE_TTL_SECONDS = 600; // 10 minutes for distributed cache
const SNIPPET_CACHE_CLEANUP_INTERVAL_MS = 60_000;

export interface SnippetRenderOptions {
  mode: "development" | "production";
  reactPeers?: LocalReactPeerSnapshot;
  projectDir: string;
  adapter?: RuntimeAdapter;
  isLocalProject?: boolean;
  /** Host-owned grant for an operator-admitted shared executor. */
  allowHostProjectCodeExecution?: boolean;
  projectId?: string;
  contentSourceId?: string;
  /** Release that owns the immutable hydration runtime for this shell. */
  releaseId?: string;
  /** Canonical request-scoped dependency source supplied by server handlers. */
  dependencyPinningSource?: DependencyPinningSource;
  /** Required original admitted source identifier for prepared module loaders. */
  filePath?: string;
  nonce?: string;
  /** Base URL for module server (e.g., http://localhost:3002) */
  moduleServerUrl?: string;
  /** Project slug for proxy mode (needed to resolve @/ imports) */
  projectSlug?: string;
  /** Project config for styling, theme, and HMR settings */
  config?: VeryfrontConfig;
  /** Entity UUID from Studio to use for page_id (for postMessage communication) */
  pageId?: string;
}

export interface SnippetRenderResult {
  html: string;
  frontmatter: Record<string, unknown>;
}

/** Build the document shell for a compiled snippet. */
export async function wrapSnippetInHTMLShell(
  bodyHtml: string,
  meta: RenderMetadata,
  options: SnippetRenderOptions,
  context: {
    hash: string;
    moduleServerBase: string;
    dependencyPinningCacheKey: string;
    dependencyPinningDependencies?: Readonly<Record<string, string>>;
    dependencyPinningConfiguredVersions?: CapturedDependencyConfiguration;
  },
): Promise<string> {
  const serverPort = getServerPort(options.moduleServerUrl);
  const snippetConfig = {
    ...options.config,
    dev: {
      ...options.config?.dev,
      hmr: true,
      port: serverPort ?? options.config?.dev?.port,
    },
  };
  const prodHydrationModulePath = options.mode === "production"
    ? await resolveProdHydrationModulePath({
      fs: options.adapter?.fs ?? createFileSystem(),
      projectDir: options.projectDir,
      buildOutDir: options.config?.build?.outDir,
      releaseId: options.releaseId,
    })
    : undefined;
  const htmlOptions: HTMLGenerationOptions = {
    adapter: options.adapter,
    reactPeers: options.reactPeers,
    mode: options.mode,
    config: snippetConfig,
    projectDir: options.projectDir,
    moduleServerOrigin: new URL(context.moduleServerBase).origin,
    nonce: options.nonce,
    studioEmbed: true,
    pagePath: `_snippets/${context.hash}`,
    pageId: options.pageId,
    releaseId: options.releaseId,
    prodHydrationModulePath,
    dependencyPinningCacheKey: context.dependencyPinningCacheKey,
    dependencyPinningDependencies: context.dependencyPinningDependencies,
    dependencyPinningConfiguredVersions: context.dependencyPinningConfiguredVersions,
  };
  return await wrapInHTMLShell(bodyHtml, meta, htmlOptions);
}

export function buildSnippetModuleUrl(
  moduleServerBase: string,
  hash: string,
  cacheBuster: number,
  dependencyPinningCacheKey?: string,
): string {
  return appendDependencyPinningKey(
    `${moduleServerBase}/_vf_modules/_snippets/${hash}.js?ssr=true&v=${cacheBuster}`,
    dependencyPinningCacheKey,
  );
}

interface SnippetCacheEntry {
  code: string;
  frontmatter: Record<string, unknown>;
  projectSlug?: string;
}

const snippetCache = new LRUCache<string, SnippetCacheEntry>({
  maxEntries: SNIPPET_CACHE_MAX_ENTRIES,
  ttlMs: SNIPPET_CACHE_TTL_MS,
  cleanupIntervalMs: SNIPPET_CACHE_CLEANUP_INTERVAL_MS,
});

registerCache("snippet-cache", () => ({
  name: "snippet-cache",
  entries: snippetCache.size,
  maxEntries: SNIPPET_CACHE_MAX_ENTRIES,
}));

let distributedSnippetCache: CacheBackend | null = null;
let distributedCacheInitPromise: Promise<CacheBackend> | null = null;

async function getDistributedSnippetCache(): Promise<CacheBackend> {
  if (distributedSnippetCache) return distributedSnippetCache;
  if (distributedCacheInitPromise) return distributedCacheInitPromise;

  distributedCacheInitPromise = (async () => {
    try {
      const backend = await createCacheBackend({ keyPrefix: "snippet" });
      distributedSnippetCache = backend;
      logger.debug("Distributed cache initialized", {
        type: backend.type,
      });
      return backend;
    } catch (error) {
      logger.warn(
        "[SnippetRenderer] Failed to initialize distributed cache, using memory",
        { error },
      );
      distributedSnippetCache = new MemoryCacheBackend(SNIPPET_CACHE_MAX_ENTRIES);
      return distributedSnippetCache;
    }
  })();

  return distributedCacheInitPromise;
}

export function getCompiledSnippet(hash: string): string | undefined {
  return snippetCache.get(hash)?.code;
}

export async function getCompiledSnippetAsync(
  hash: string,
): Promise<string | undefined> {
  const local = snippetCache.get(hash);
  if (local) return local.code;

  try {
    const cache = await getDistributedSnippetCache();
    const cached = await cache.get(hash);
    if (!cached) return undefined;

    const entry = JSON.parse(cached) as SnippetCacheEntry;
    snippetCache.set(hash, entry);
    logger.debug("Snippet cache hit from distributed cache", {
      hash,
    });
    return entry.code;
  } catch (error) {
    logger.debug("Failed to read from distributed cache", {
      hash,
      error,
    });
    return undefined;
  }
}

/**
 * Clear all cached snippets - used during cache invalidation
 * @deprecated Use clearSnippetCacheForProject for multi-tenant deployments
 */
export function clearSnippetCache(): void {
  const keysToDelete = [...snippetCache.keys()];
  const entriesCleared = keysToDelete.length;
  snippetCache.clear();
  logger.debug("✓ Global snippet cache cleared", { entriesCleared });

  if (keysToDelete.length === 0) return;

  void (async () => {
    try {
      const cache = await getDistributedSnippetCache();
      await Promise.allSettled(keysToDelete.map((key) => cache.del(key)));
    } catch {
      // Ignore distributed cache clear failures
    }
  })();
}

export function clearSnippetCacheForProject(projectSlug: string): void {
  const keysToDelete: string[] = [];

  for (const [key, entry] of snippetCache.entries()) {
    if (entry?.projectSlug === projectSlug) {
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    snippetCache.delete(key);
  }

  logger.debug("✓ Snippet cache cleared for project", {
    projectSlug,
    entriesCleared: keysToDelete.length,
  });

  if (keysToDelete.length === 0) return;

  void (async () => {
    try {
      const cache = await getDistributedSnippetCache();
      await Promise.allSettled(keysToDelete.map((key) => cache.del(key)));
    } catch {
      // Ignore distributed cache clear failures
    }
  })();
}

function getModuleServerBase(moduleServerUrl?: string): string {
  if (!moduleServerUrl) return "http://localhost:3002";

  if (moduleServerUrl.startsWith("http://") || moduleServerUrl.startsWith("https://")) {
    return moduleServerUrl;
  }

  // The provided URL is not an http(s) URL (e.g. a bare hostname, ws:// address,
  // or typo). Falling back silently to localhost:3002 would mask the
  // misconfiguration with a confusing connection error — warn explicitly instead.
  logger.warn(
    "[SnippetRenderer] moduleServerUrl has an unrecognised scheme, falling back to localhost:3002",
    { moduleServerUrl },
  );
  return "http://localhost:3002";
}

function getServerPort(moduleServerUrl?: string): number | undefined {
  if (!moduleServerUrl) return undefined;

  try {
    const url = new URL(moduleServerUrl);
    return url.port ? parseInt(url.port, 10) : undefined;
  } catch (_) {
    /* expected: invalid URL string */
    return undefined;
  }
}

export function renderSnippet(
  mdxContent: string,
  options: SnippetRenderOptions,
): Promise<SnippetRenderResult> {
  return withSpan(
    "rendering.renderSnippet",
    async () => {
      const adapter = options.adapter ?? await getLocalAdapter();
      if (
        requiresIsolatedProjectRuntime({
          adapter,
          allowHostProjectCodeExecution: isHostProjectCodeExecutionAllowed(options),
        })
      ) {
        throw PROJECT_EXECUTION_UNAVAILABLE.create({
          detail:
            "Snippet rendering requires a dedicated isolated project runtime or an explicit host grant",
        });
      }
      const prepared = getRuntimeModuleLoader(adapter);
      if (prepared && !options.filePath) {
        throw new TypeError("Prepared snippet rendering requires an admitted filePath");
      }
      logger.debug("Starting render", {
        contentLength: mdxContent.length,
        filePath: options.filePath,
      });

      const dependencySource = options.dependencyPinningSource ?? createDependencyPinningSource({
        projectDir: options.projectDir,
        adapter,
        isLocalProject: options.isLocalProject,
        projectId: options.projectId,
        projectSlug: options.projectSlug,
        contentSourceId: options.contentSourceId,
        releaseId: options.releaseId,
        config: options.config,
      });
      const dependencySnapshot = await getDependencyPinningSnapshot(dependencySource);
      if (dependencySnapshot.cacheKey === "on:unknown") {
        throw new Error("Dependency pinning snapshot is unavailable: on:unknown");
      }

      try {
        const releaseId = dependencySource.releaseId ?? options.releaseId;
        const contentSourceId = dependencySource.contentSourceId ?? options.contentSourceId ??
          computeContentSourceId(
            isExplicitlyLocalProject(options),
            releaseId ? "production" : "preview",
            dependencySource.branch,
            releaseId,
          );
        const projectId = dependencySource.projectId ?? options.projectId ?? options.projectDir;
        const reactPeers = prepared
          ? undefined
          : options.reactPeers ?? ((isNode || isBun) ? captureLocalReactPeers() : undefined);
        const reactVersion = await resolveProjectReactVersion({
          adapter,
          reactPeers,
          projectDir: options.projectDir,
          config: options.config,
          dependencyPinningSource: dependencySource,
          dependencyPinningCacheKey: dependencySnapshot.cacheKey,
          dependencyPinningDependencies: dependencySnapshot.dependencies,
          dependencyPinningConfiguredVersions: dependencySnapshot.configuredVersions,
        });
        const { compileContent } = await import(
          "#veryfront/transforms/mdx/compiler/index.ts"
        );

        const bundle = await compileContent(
          options.mode,
          options.projectDir,
          mdxContent,
          undefined,
          options.filePath,
        );

        logger.debug("MDX compiled", {
          codeLength: bundle.compiledCode.length,
          hasFrontmatter: !!bundle.frontmatter,
        });

        const hash = (await computeHash(mdxContent + (options.projectSlug ?? ""))).slice(0, 16);
        const frontmatter = bundle.frontmatter ?? {};
        const cacheEntry: SnippetCacheEntry = {
          code: bundle.compiledCode,
          frontmatter,
          projectSlug: options.projectSlug,
        };

        snippetCache.set(hash, cacheEntry);

        void (async () => {
          try {
            const cache = await getDistributedSnippetCache();
            await cache.set(
              hash,
              JSON.stringify(cacheEntry),
              SNIPPET_DISTRIBUTED_CACHE_TTL_SECONDS,
            );
          } catch (error) {
            logger.debug(
              "[SnippetRenderer] Failed to store in distributed cache",
              { hash, error },
            );
          }
        })();

        logger.debug("Snippet cached", {
          hash,
          projectSlug: options.projectSlug,
          codePreview: bundle.compiledCode.substring(0, 300),
        });

        const moduleServerBase = getModuleServerBase(options.moduleServerUrl);
        let modulePath = options.filePath ?? join(options.projectDir, "_snippets", `${hash}.tsx`);
        // Prepared graphs address original source identifiers. Compiled input
        // needs a TSX virtual path in that directory to skip Markdown parsing.
        if (!prepared && options.filePath) modulePath += ".tsx";
        const module = await loadModuleFromSource(
          bundle.compiledCode,
          modulePath,
          options.projectDir,
          adapter,
          {
            dev: options.mode === "development",
            ssr: true,
            mode: options.mode,
            projectId,
            projectSlug: options.projectSlug,
            contentSourceId,
            reactVersion,
            reactPeers,
            moduleServerOrigin: new URL(moduleServerBase).origin,
            serverExternalPackages: options.config?.build?.serverExternalPackages,
            dependencyPinningSource: dependencySource,
            dependencyPinningCacheKey: dependencySnapshot.cacheKey,
            dependencyPinningDependencies: dependencySnapshot.dependencies,
            dependencyPinningConfiguredVersions: dependencySnapshot.configuredVersions,
          },
        );
        const MDXContent = module.default || module.MDXContent;
        if (!MDXContent) {
          throw RENDER_ERROR.create({ detail: "No MDXContent export found in compiled snippet" });
        }

        const [React, server] = await Promise.all([
          getProjectReact(reactVersion, adapter, reactPeers),
          getReactDOMServer(reactVersion, adapter, reactPeers),
        ]);
        const element = React.createElement(
          MDXContent as import("react").ComponentType<{ frontmatter: Record<string, unknown> }>,
          { frontmatter },
        );
        const bodyHtml = await renderToStringAdapter(element, {
          reactVersion,
          reactPeers,
          reactRuntime: { react: React, server },
        }, adapter);

        logger.debug("SSR complete", {
          bodyHtmlLength: bodyHtml.length,
        });

        const meta: RenderMetadata = {
          title: (bundle.frontmatter?.name as string) || "Component Preview",
          slug: options.filePath || "snippet",
          frontmatter: bundle.frontmatter as RenderMetadata["frontmatter"],
        };

        const html = await wrapSnippetInHTMLShell(bodyHtml, meta, {
          ...options,
          adapter,
          reactPeers,
          releaseId,
        }, {
          hash,
          moduleServerBase,
          dependencyPinningCacheKey: dependencySnapshot.cacheKey,
          dependencyPinningDependencies: dependencySnapshot.dependencies,
          dependencyPinningConfiguredVersions: dependencySnapshot.configuredVersions,
        });

        return { html, frontmatter };
      } catch (error) {
        logger.error("Render failed", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });

        return {
          html: generateErrorHTML(error, options),
          frontmatter: {},
        };
      }
    },
    {
      "snippet.contentLength": mdxContent.length,
      "snippet.filePath": options.filePath || "inline",
    },
  );
}

function generateErrorHTML(error: unknown, options: SnippetRenderOptions): string {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const nonce = options.nonce ? ` nonce="${escapeHtml(options.nonce)}"` : "";
  const stackHtml = options.mode === "development" && stack
    ? `<div class="error-stack">${escapeHtml(stack)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Snippet Error</title>
  <style${nonce}>
    body {
      margin: 0;
      padding: 1rem;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #fef2f2;
    }
    .error-container {
      padding: 1rem;
      background: #ffffff;
      border: 1px solid #fecaca;
      border-radius: 0.5rem;
      color: #dc2626;
    }
    .error-title {
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    .error-message {
      font-family: monospace;
      font-size: 0.875rem;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .error-stack {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid #fecaca;
      font-size: 0.75rem;
      color: #991b1b;
      white-space: pre-wrap;
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <div class="error-container">
    <div class="error-title">Snippet Render Error</div>
    <div class="error-message">${escapeHtml(message)}</div>
    ${stackHtml}
  </div>
</body>
</html>`;
}
