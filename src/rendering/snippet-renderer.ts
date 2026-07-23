import { computeHash, rendererLogger } from "#veryfront/utils";
import { RENDER_ERROR } from "#veryfront/errors";
import type { RenderMetadata } from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";
import { wrapInHTMLShell } from "#veryfront/html/html-shell-generator.ts";
import type { HTMLRuntimeGenerationOptions } from "#veryfront/html/types.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import { escapeHtml } from "#veryfront/html/html-escape.ts";
import { type CacheBackend, createCacheBackend } from "#veryfront/cache/backend.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { sanitizeErrorText } from "#veryfront/errors/sanitization.ts";
import { registerProcessStateReset } from "#veryfront/platform/compat/process/state-reset.ts";
import {
  MAX_STUDIO_CONFIG_ID_LENGTH,
  MAX_STUDIO_CONFIG_PATH_LENGTH,
} from "#veryfront/studio/limits.ts";

const logger = rendererLogger.component("snippet-renderer");

const SNIPPET_CACHE_MAX_ENTRIES = 500;
const SNIPPET_CACHE_TTL_MS = 10 * 60 * 1_000; // 10 minutes
const SNIPPET_DISTRIBUTED_CACHE_TTL_SECONDS = 600; // 10 minutes for distributed cache
const SNIPPET_CACHE_CLEANUP_INTERVAL_MS = 60_000;
const MAX_SNIPPET_SOURCE_BYTES = 5 * 1024 * 1024;

export interface SnippetRenderOptions {
  mode: "development" | "production";
  /** Stable project identity used to isolate executable snippet cache entries. */
  projectId: string;
  projectDir: string;
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

interface SnippetCacheEntry {
  code: string;
  frontmatter: Record<string, unknown>;
  projectScope: string;
  projectSlug?: string;
}

export interface CompiledSnippetCacheInput {
  hash: string;
  code: string;
  frontmatter?: Record<string, unknown>;
  projectScope: string;
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

  distributedCacheInitPromise = createCacheBackend({ keyPrefix: "snippet" })
    .then((backend) => {
      distributedSnippetCache = backend;
      logger.debug("Distributed cache initialized", { type: backend.type });
      return backend;
    })
    .catch((error) => {
      logger.warn("Distributed snippet cache initialization failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      throw error;
    })
    .finally(() => {
      if (!distributedSnippetCache) distributedCacheInitPromise = null;
    });

  return distributedCacheInitPromise;
}

export function getCompiledSnippet(
  hash: string,
  expectedProjectScope: string,
): string | undefined {
  const entry = snippetCache.get(hash);
  return entry?.projectScope === expectedProjectScope ? entry.code : undefined;
}

/** Remember compiled snippet code in the process-local cache. */
export function rememberCompiledSnippet(input: CompiledSnippetCacheInput): void {
  if (!/^[a-f0-9]{64}$/.test(input.hash)) {
    throw new TypeError("Compiled snippet hash must be a SHA-256 hex digest");
  }
  if (
    !input.projectScope || input.projectScope.length > 512 ||
    hasControlCharacters(input.projectScope)
  ) {
    throw new TypeError("Compiled snippet project scope is invalid");
  }
  if (new TextEncoder().encode(input.code).byteLength > MAX_SNIPPET_SOURCE_BYTES) {
    throw new RangeError("Compiled snippet code exceeds the supported size");
  }
  snippetCache.set(input.hash, {
    code: input.code,
    frontmatter: input.frontmatter ?? {},
    projectScope: input.projectScope,
    projectSlug: input.projectSlug,
  });
}

export async function getCompiledSnippetAsync(
  hash: string,
  expectedProjectScope: string,
): Promise<string | undefined> {
  const local = snippetCache.get(hash);
  if (local) {
    return local.projectScope === expectedProjectScope ? local.code : undefined;
  }

  try {
    const cache = await getDistributedSnippetCache();
    const cached = await cache.get(hash);
    if (!cached) return undefined;

    const entry = parseSnippetCacheEntry(cached);
    if (!entry) {
      await cache.del(hash);
      return undefined;
    }
    if (entry.projectScope !== expectedProjectScope) return undefined;
    snippetCache.set(hash, entry);
    logger.debug("Snippet cache hit from distributed cache");
    return entry.code;
  } catch (error) {
    logger.debug("Failed to read from distributed cache", {
      errorName: error instanceof Error ? error.name : "UnknownError",
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
  logger.debug("Global snippet cache cleared", { entriesCleared });

  if (keysToDelete.length === 0 && !distributedSnippetCache) return;

  void (async () => {
    try {
      const cache = await getDistributedSnippetCache();
      if (cache.delByPattern) {
        await cache.delByPattern("*");
      } else {
        await Promise.allSettled(keysToDelete.map((key) => cache.del(key)));
      }
    } catch (error) {
      logger.warn("Distributed snippet cache clear failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  })();
}

registerProcessStateReset("snippet renderer", clearSnippetCache);

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

  logger.debug("Snippet cache cleared for project", { entriesCleared: keysToDelete.length });

  if (keysToDelete.length === 0) return;

  void (async () => {
    try {
      const cache = await getDistributedSnippetCache();
      await Promise.allSettled(keysToDelete.map((key) => cache.del(key)));
    } catch (error) {
      logger.warn("Distributed project snippet cache clear failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  })();
}

function getModuleServerBase(moduleServerUrl?: string): string {
  if (!moduleServerUrl) {
    throw new TypeError("Snippet rendering requires an explicit module server URL");
  }

  const url = new URL(moduleServerUrl);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password ||
    url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new TypeError("Snippet module server URL must be an HTTP(S) origin without credentials");
  }
  return url.origin;
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

export async function renderSnippet(
  mdxContent: string,
  options: SnippetRenderOptions,
): Promise<SnippetRenderResult> {
  validateSnippetStudioConfig(options);
  return withSpan(
    "rendering.renderSnippet",
    async () => {
      logger.debug("Starting render", {
        contentLength: mdxContent.length,
        hasFilePath: options.filePath !== undefined,
      });

      try {
        validateSnippetOptions(mdxContent, options);
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

        const projectScope = options.projectId;
        const hash = await computeHash(JSON.stringify([
          1,
          projectScope,
          options.mode,
          options.projectDir,
          options.filePath ?? "",
          mdxContent,
        ]));
        const frontmatter = bundle.frontmatter ?? {};
        const cacheEntry: SnippetCacheEntry = {
          code: bundle.compiledCode,
          frontmatter,
          projectScope,
          projectSlug: options.projectSlug,
        };

        rememberCompiledSnippet({ hash, ...cacheEntry });

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
              "Failed to store snippet in distributed cache",
              { errorName: error instanceof Error ? error.name : "UnknownError" },
            );
          }
        })();

        logger.debug("Snippet cached", {
          codeLength: bundle.compiledCode.length,
        });

        const moduleServerBase = getModuleServerBase(options.moduleServerUrl);
        const cacheBuster = Date.now();
        const snippetUrl =
          `${moduleServerBase}/_vf_modules/_snippets/${hash}.js?ssr=true&v=${cacheBuster}`;

        logger.debug("Loading snippet module", {
          moduleServerOrigin: new URL(moduleServerBase).origin,
        });

        const module = await import(snippetUrl);
        const MDXContent = module.default || module.MDXContent;
        if (!MDXContent) {
          throw RENDER_ERROR.create({ detail: "No MDXContent export found in compiled snippet" });
        }

        const [{ renderToString }, React] = await Promise.all([
          import("react-dom/server"),
          import("react"),
        ]);

        const element = React.createElement(MDXContent, { frontmatter });
        const bodyHtml = renderToString(element);

        logger.debug("SSR complete", {
          bodyHtmlLength: bodyHtml.length,
        });

        const meta: RenderMetadata = {
          title: (bundle.frontmatter?.name as string) || "Component Preview",
          slug: options.filePath || "snippet",
          frontmatter: bundle.frontmatter as RenderMetadata["frontmatter"],
        };

        const html = await wrapInHTMLShell(bodyHtml, meta, {
          ...createSnippetShellOptions(options),
          pagePath: `_snippets/${hash}`,
        });

        return { html, frontmatter };
      } catch (error) {
        logger.error("Render failed", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        });

        return {
          html: await generateErrorHTML(error, options),
          frontmatter: {},
        };
      }
    },
    {
      "snippet.contentLength": mdxContent.length,
      "snippet.hasFilePath": options.filePath !== undefined,
    },
  );
}

function createSnippetShellOptions(
  options: SnippetRenderOptions,
): HTMLRuntimeGenerationOptions {
  const serverPort = getServerPort(options.moduleServerUrl);
  return {
    mode: options.mode,
    config: {
      ...options.config,
      dev: {
        ...options.config?.dev,
        hmr: true,
        port: serverPort ?? options.config?.dev?.port,
      },
    },
    studioProjectId: options.projectId,
    projectDir: options.projectDir,
    nonce: options.nonce,
    studioEmbed: true,
    studioPagePath: options.filePath,
    pageId: options.pageId,
  };
}

async function generateErrorHTML(
  error: unknown,
  options: SnippetRenderOptions,
): Promise<string> {
  const message = options.mode === "development"
    ? sanitizeErrorText(error instanceof Error ? error.message : String(error), 1_024)
    : "Snippet rendering failed";
  const nonce = options.nonce ? ` nonce="${escapeHtml(options.nonce)}"` : "";

  const content = `
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
  </style>
  <div class="error-container">
    <div class="error-title">Snippet render error</div>
    <div class="error-message">${escapeHtml(message)}</div>
  </div>`;

  const meta: RenderMetadata = {
    title: "Snippet error",
    slug: options.filePath || "snippet-error",
    frontmatter: {},
  };
  return await wrapInHTMLShell(content, meta, createSnippetShellOptions(options));
}

function validateSnippetOptions(mdxContent: string, options: SnippetRenderOptions): void {
  if (!options.projectDir.trim()) throw new TypeError("Snippet projectDir must not be empty");
  if (new TextEncoder().encode(mdxContent).byteLength > MAX_SNIPPET_SOURCE_BYTES) {
    throw new RangeError("Snippet source exceeds the supported size");
  }
  getModuleServerBase(options.moduleServerUrl);
}

function validateSnippetStudioConfig(options: SnippetRenderOptions): void {
  const projectId = options.projectId;
  if (
    typeof projectId !== "string" || !projectId.trim() ||
    projectId.length > MAX_STUDIO_CONFIG_ID_LENGTH || hasControlCharacters(projectId)
  ) {
    throw new TypeError("Snippet projectId is invalid");
  }
  if (
    options.pageId !== undefined &&
    (typeof options.pageId !== "string" ||
      options.pageId.length > MAX_STUDIO_CONFIG_ID_LENGTH ||
      hasControlCharacters(options.pageId))
  ) {
    throw new TypeError("Snippet pageId is invalid");
  }
  if (
    options.filePath !== undefined &&
    (typeof options.filePath !== "string" ||
      options.filePath.length > MAX_STUDIO_CONFIG_PATH_LENGTH ||
      hasControlCharacters(options.filePath))
  ) {
    throw new TypeError("Snippet filePath is invalid");
  }
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function parseSnippetCacheEntry(serialized: string): SnippetCacheEntry | undefined {
  try {
    const value = JSON.parse(serialized) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (
      typeof record.code !== "string" || typeof record.projectScope !== "string" ||
      !record.projectScope || !record.frontmatter || typeof record.frontmatter !== "object" ||
      Array.isArray(record.frontmatter) ||
      (record.projectSlug !== undefined && typeof record.projectSlug !== "string")
    ) {
      return undefined;
    }
    return {
      code: record.code,
      frontmatter: record.frontmatter as Record<string, unknown>,
      projectScope: record.projectScope,
      projectSlug: record.projectSlug as string | undefined,
    };
  } catch {
    return undefined;
  }
}
