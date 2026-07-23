import { computeHash, rendererLogger } from "#veryfront/utils";
import { RENDER_ERROR } from "#veryfront/errors";
import type { RenderMetadata } from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";
import { wrapInHTMLShell } from "#veryfront/html/html-shell-generator.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import { escapeHtml } from "#veryfront/html/html-escape.ts";
import { type CacheBackend, createCacheBackend } from "#veryfront/cache/backend.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const logger = rendererLogger.component("snippet-renderer");

const SNIPPET_CACHE_MAX_ENTRIES = 500;
const SNIPPET_CACHE_TTL_MS = 10 * 60 * 1_000; // 10 minutes
const SNIPPET_DISTRIBUTED_CACHE_TTL_SECONDS = 600; // 10 minutes for distributed cache
const SNIPPET_CACHE_CLEANUP_INTERVAL_MS = 60_000;
const SNIPPET_CACHE_FORMAT_VERSION = 2;
const MAX_SNIPPET_SOURCE_BYTES = 1 * 1024 * 1024;
const MAX_COMPILED_SNIPPET_BYTES = 2 * 1024 * 1024;
const MAX_SNIPPET_FRONTMATTER_BYTES = 256 * 1024;
const MAX_DISTRIBUTED_SNIPPET_BYTES = 3 * 1024 * 1024;
const textEncoder = new TextEncoder();

export interface SnippetRenderOptions {
  mode: "development" | "production";
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
  /** Stable identifier for a non-default content compiler/provider. */
  compilerIdentity?: string;
}

export interface SnippetRenderResult {
  html: string;
  frontmatter: Record<string, unknown>;
}

interface SnippetCacheEntry {
  version: typeof SNIPPET_CACHE_FORMAT_VERSION;
  hash: string;
  code: string;
  codeHash: string;
  frontmatter: Record<string, unknown>;
  projectScope: string;
  projectSlug?: string;
}

function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function encodeCacheSegment(value: string): string {
  return Array.from(textEncoder.encode(value), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function getProjectScope(
  options: Pick<SnippetRenderOptions, "projectDir" | "projectSlug">,
): string {
  return options.projectSlug?.trim() || options.projectDir;
}

/** @internal Exported for deterministic cache-contract tests. */
export function getSnippetCacheKey(projectScope: string, hash: string): string {
  return `v${SNIPPET_CACHE_FORMAT_VERSION}:${encodeCacheSegment(projectScope)}:${hash}`;
}

function getSnippetProjectPattern(projectScope: string): string {
  return `v${SNIPPET_CACHE_FORMAT_VERSION}:${encodeCacheSegment(projectScope)}:*`;
}

function stableSerialize(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value));
    case "bigint":
      return JSON.stringify({ $bigint: value.toString() });
    case "undefined":
      return JSON.stringify({ $undefined: true });
    case "function":
      return JSON.stringify({ $function: Function.prototype.toString.call(value) });
    case "symbol":
      return JSON.stringify({ $symbol: value.description ?? "" });
    case "object":
      break;
  }

  const objectValue = value as object;
  if (ancestors.has(objectValue)) {
    throw new TypeError("Snippet cache identity cannot contain cyclic configuration");
  }
  ancestors.add(objectValue);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableSerialize(item, ancestors)).join(",")}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item, ancestors)}`);
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(objectValue);
  }
}

/** Build the full SHA-256 identity used by both the module URL and cache payload. */
export function computeSnippetHash(
  mdxContent: string,
  options: SnippetRenderOptions,
): Promise<string> {
  return computeHash(stableSerialize({
    formatVersion: SNIPPET_CACHE_FORMAT_VERSION,
    content: mdxContent,
    projectScope: getProjectScope(options),
    projectDir: options.projectDir,
    projectSlug: options.projectSlug ?? null,
    filePath: options.filePath ?? null,
    mode: options.mode,
    compilerIdentity: options.compilerIdentity ?? "ContentProcessor",
    config: options.config ?? null,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function decodeSnippetCacheEntry(
  raw: string,
  expectedHash: string,
  expectedProjectScope: string,
): Promise<SnippetCacheEntry | null> {
  if (utf8ByteLength(raw) > MAX_DISTRIBUTED_SNIPPET_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== SNIPPET_CACHE_FORMAT_VERSION) return null;
  if (parsed.hash !== expectedHash || parsed.projectScope !== expectedProjectScope) return null;
  if (typeof parsed.code !== "string" || typeof parsed.codeHash !== "string") return null;
  if (!isRecord(parsed.frontmatter)) return null;
  if (parsed.projectSlug !== undefined && typeof parsed.projectSlug !== "string") return null;
  if (utf8ByteLength(parsed.code) > MAX_COMPILED_SNIPPET_BYTES) return null;
  if (utf8ByteLength(JSON.stringify(parsed.frontmatter)) > MAX_SNIPPET_FRONTMATTER_BYTES) {
    return null;
  }
  if (await computeHash(parsed.code) !== parsed.codeHash) return null;

  return parsed as unknown as SnippetCacheEntry;
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
let distributedCacheFactory = () => createCacheBackend({ keyPrefix: "snippet" });

async function getDistributedSnippetCache(): Promise<CacheBackend> {
  if (distributedSnippetCache) return distributedSnippetCache;
  if (distributedCacheInitPromise) return distributedCacheInitPromise;

  const initialization = distributedCacheFactory().then((backend) => {
    distributedSnippetCache = backend;
    logger.debug("Distributed cache initialized", { type: backend.type });
    return backend;
  });
  distributedCacheInitPromise = initialization;

  try {
    return await initialization;
  } finally {
    // A failed initialization must be retryable. Identity guarding prevents an
    // older rejection from clearing a newer attempt installed by a test/runtime reset.
    if (distributedCacheInitPromise === initialization) {
      distributedCacheInitPromise = null;
    }
  }
}

/** @internal Dependency seam for cache-failure and cold-pod tests. */
export function setSnippetCacheBackendFactoryForTesting(
  factory?: () => Promise<CacheBackend>,
): void {
  distributedSnippetCache = null;
  distributedCacheInitPromise = null;
  distributedCacheFactory = factory ?? (() => createCacheBackend({ keyPrefix: "snippet" }));
}

export function getCompiledSnippet(hash: string, projectScope?: string): string | undefined {
  if (!projectScope) return undefined;
  return snippetCache.get(getSnippetCacheKey(projectScope, hash))?.code;
}

export async function getCompiledSnippetAsync(
  hash: string,
  projectScope?: string,
): Promise<string | undefined> {
  if (!projectScope || !hash) return undefined;
  const cacheKey = getSnippetCacheKey(projectScope, hash);
  const local = snippetCache.get(cacheKey);
  if (local) return local.code;

  try {
    const cache = await getDistributedSnippetCache();
    const cached = await cache.get(cacheKey);
    if (!cached) return undefined;

    const entry = await decodeSnippetCacheEntry(cached, hash, projectScope);
    if (!entry) {
      logger.warn("Rejected invalid distributed snippet cache payload", { hash, projectScope });
      await cache.del(cacheKey);
      return undefined;
    }

    snippetCache.set(cacheKey, entry);
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
export async function clearSnippetCache(): Promise<void> {
  const entriesCleared = snippetCache.size;
  snippetCache.clear();
  logger.debug("✓ Global snippet cache cleared", { entriesCleared });
  const cache = await getDistributedSnippetCache();
  if (!cache.delByPattern) {
    throw new Error("Configured snippet cache backend does not support authoritative clearing");
  }
  await cache.delByPattern(`v${SNIPPET_CACHE_FORMAT_VERSION}:*`);
}

export async function clearSnippetCacheForProject(projectSlug: string): Promise<void> {
  const projectScope = projectSlug.trim();
  if (!projectScope) throw new TypeError("projectSlug must be non-empty");
  let entriesCleared = 0;

  for (const [key, entry] of snippetCache.entries()) {
    if (entry?.projectScope === projectScope) {
      snippetCache.delete(key);
      entriesCleared++;
    }
  }

  logger.debug("✓ Snippet cache cleared for project", {
    projectSlug: projectScope,
    entriesCleared,
  });

  // Always clear the authoritative backend, even on an idle/cold pod with no
  // local entries. Local residency is not evidence that distributed state is absent.
  const cache = await getDistributedSnippetCache();
  if (!cache.delByPattern) {
    throw new Error("Configured snippet cache backend does not support project-scoped clearing");
  }
  await cache.delByPattern(getSnippetProjectPattern(projectScope));
}

function getModuleServerBase(moduleServerUrl?: string): string {
  if (!moduleServerUrl) {
    throw RENDER_ERROR.create({ detail: "Snippet rendering requires an explicit moduleServerUrl" });
  }

  let parsed: URL;
  try {
    parsed = new URL(moduleServerUrl);
  } catch {
    throw RENDER_ERROR.create({ detail: "Snippet moduleServerUrl must be an absolute URL" });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw RENDER_ERROR.create({ detail: "Snippet moduleServerUrl must use http or https" });
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.href.replace(/\/$/, "");
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
      logger.debug("Starting render", {
        contentLength: mdxContent.length,
        filePath: options.filePath,
      });

      try {
        if (utf8ByteLength(mdxContent) > MAX_SNIPPET_SOURCE_BYTES) {
          throw RENDER_ERROR.create({ detail: "Snippet source exceeds the 1 MiB render limit" });
        }

        // Validate the module endpoint before compiling. This avoids expensive
        // work for a request that cannot possibly load its generated module.
        const moduleServerBase = getModuleServerBase(options.moduleServerUrl);
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

        if (utf8ByteLength(bundle.compiledCode) > MAX_COMPILED_SNIPPET_BYTES) {
          throw RENDER_ERROR.create({ detail: "Compiled snippet exceeds the 2 MiB cache limit" });
        }

        const hash = await computeSnippetHash(mdxContent, options);
        const projectScope = getProjectScope(options);
        const cacheKey = getSnippetCacheKey(projectScope, hash);
        const frontmatter = bundle.frontmatter ?? {};
        if (utf8ByteLength(JSON.stringify(frontmatter)) > MAX_SNIPPET_FRONTMATTER_BYTES) {
          throw RENDER_ERROR.create({
            detail: "Snippet frontmatter exceeds the 256 KiB cache limit",
          });
        }
        const cacheEntry: SnippetCacheEntry = {
          version: SNIPPET_CACHE_FORMAT_VERSION,
          hash,
          code: bundle.compiledCode,
          codeHash: await computeHash(bundle.compiledCode),
          frontmatter,
          projectScope,
          projectSlug: options.projectSlug,
        };

        const serializedEntry = JSON.stringify(cacheEntry);
        if (utf8ByteLength(serializedEntry) > MAX_DISTRIBUTED_SNIPPET_BYTES) {
          throw RENDER_ERROR.create({ detail: "Compiled snippet cache payload exceeds 3 MiB" });
        }

        snippetCache.set(cacheKey, cacheEntry);

        try {
          const cache = await getDistributedSnippetCache();
          await cache.set(
            cacheKey,
            serializedEntry,
            SNIPPET_DISTRIBUTED_CACHE_TTL_SECONDS,
          );
        } catch (error) {
          // The local artifact remains usable for this render. Initialization
          // failures are not memoized, so the next request can recover.
          logger.warn("[SnippetRenderer] Failed to store in distributed cache", {
            hash,
            projectScope,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        logger.debug("Snippet cached", {
          hash,
          projectSlug: options.projectSlug,
          codePreview: bundle.compiledCode.substring(0, 300),
        });

        const snippetUrl =
          `${moduleServerBase}/_vf_modules/_snippets/${hash}.js?ssr=true&v=${hash}`;

        logger.debug("Loading snippet module", {
          snippetUrl,
          moduleServerBase,
          providedUrl: options.moduleServerUrl,
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

        const serverPort = getServerPort(options.moduleServerUrl);
        const snippetConfig = {
          ...options.config,
          dev: {
            ...options.config?.dev,
            hmr: true,
            port: serverPort ?? options.config?.dev?.port,
          },
        };

        const html = await wrapInHTMLShell(bodyHtml, meta, {
          mode: options.mode,
          config: snippetConfig,
          projectDir: options.projectDir,
          nonce: options.nonce,
          studioEmbed: true,
          pagePath: `_snippets/${hash}`,
          pageId: options.pageId,
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
