/**
 * Tailwind CSS v4 JIT Compiler
 *
 * Unified compiler using Tailwind's native compile() API.
 * Handles @import, @theme, @plugin directives natively.
 * No custom normalization or hacks - trusts Tailwind completely.
 */

import { compile } from "tailwindcss";
import { serverLogger as logger } from "#veryfront/utils";
import { getTailwindCSSUrl } from "#veryfront/utils/constants/cdn.ts";

// =============================================================================
// Types
// =============================================================================

export interface TailwindResult {
  /** Generated CSS */
  css: string;
  /** Error message if compilation failed */
  error?: string;
}

export interface GenerateOptions {
  /** Minify output CSS (for production) */
  minify?: boolean;
}

// =============================================================================
// Caches
// =============================================================================

/** Cached Tailwind base CSS (fetched once from CDN) */
let tailwindBaseCSS: string | null = null;

/** Cached compiler instance */
let compiler: Awaited<ReturnType<typeof compile>> | null = null;

/** Hash of stylesheet used to create current compiler */
let lastStylesheetHash = "";

/** Cache for loaded plugin modules */
const pluginCache = new Map<string, unknown>();

/** Track plugin load errors for error overlay */
const pluginErrors = new Map<string, string>();

/**
 * CSS cache by hash - stores generated CSS for production hashed URLs
 * Key: CSS hash (8 chars), Value: CSS content
 * Limited to 100 entries per project with LRU eviction
 */
const cssCache = new Map<string, string>();
const CSS_CACHE_MAX_SIZE = 100;

// =============================================================================
// Constants
// =============================================================================

/** Default stylesheet when project has none */
const DEFAULT_STYLESHEET = `@import "tailwindcss";`;

// =============================================================================
// Utilities
// =============================================================================

/**
 * Simple hash function for cache keys
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

/**
 * Generate a short hash from CSS content for URLs
 */
export function hashCSS(css: string): string {
  return hashString(css).slice(0, 8);
}

/**
 * Store CSS in cache for later retrieval by hash.
 * Called when generating production HTML with hashed CSS URLs.
 */
export function cacheCSS(css: string): string {
  const hash = hashCSS(css);

  // If already cached, just return hash
  if (cssCache.has(hash)) {
    return hash;
  }

  // LRU eviction - remove oldest entries if at capacity
  if (cssCache.size >= CSS_CACHE_MAX_SIZE) {
    const firstKey = cssCache.keys().next().value;
    if (firstKey) {
      cssCache.delete(firstKey);
    }
  }

  cssCache.set(hash, css);
  return hash;
}

/**
 * Retrieve CSS from cache by hash.
 * Returns undefined if not found (cache miss).
 */
export function getCSSByHash(hash: string): string | undefined {
  const css = cssCache.get(hash);

  // Move to end for LRU (re-insert)
  if (css) {
    cssCache.delete(hash);
    cssCache.set(hash, css);
  }

  return css;
}

/**
 * Clear CSS cache (useful for testing or memory management)
 */
export function clearCSSCache(): void {
  cssCache.clear();
}

// =============================================================================
// Class Extraction
// =============================================================================

/**
 * Extract potential Tailwind class candidates from source content.
 *
 * Uses the same approach as Tailwind: scan as plain text, extract tokens
 * that could be class names. Tailwind's build() filters out invalid ones.
 *
 * This handles:
 * - className="..." strings
 * - cn(), clsx(), cva(), tv() function calls
 * - Template literals (static parts)
 * - Arbitrary values like aspect-[16/9], bg-[#ff0000]
 * - Responsive/state prefixes like sm:, hover:, dark:
 *
 * @param content - Source file content (TSX, JSX, MDX, etc.)
 * @returns Array of unique candidate strings
 */
export function extractCandidates(content: string): string[] {
  // Match anything that could be a Tailwind class:
  // - Starts with a letter OR digit (for 2xl:, 3xl: responsive prefixes)
  // - Contains letters, numbers, dashes, colons, slashes, brackets, dots, etc.
  // - Includes special chars for arbitrary values: [], (), %, #, !, '
  const pattern = /[a-zA-Z0-9][a-zA-Z0-9_\-:\/\[\]\.%#,()!']+/g;
  const matches = content.match(pattern) || [];
  return [...new Set(matches)];
}

/**
 * Extract candidates from multiple source files
 */
export function extractCandidatesFromFiles(
  files: Array<{ path: string; content?: string }>,
): Set<string> {
  const candidates = new Set<string>();
  const sourceExtensions = [".tsx", ".jsx", ".ts", ".js", ".mdx"];

  for (const file of files) {
    if (!file.content) continue;
    if (!sourceExtensions.some((ext) => file.path.endsWith(ext))) continue;

    for (const candidate of extractCandidates(file.content)) {
      candidates.add(candidate);
    }
  }

  return candidates;
}

// =============================================================================
// Plugin Loading
// =============================================================================

/**
 * Load a Tailwind plugin from esm.sh (cached)
 * Throws on failure so error propagates to overlay
 */
async function loadPlugin(id: string): Promise<unknown> {
  // Return cached plugin
  if (pluginCache.has(id)) {
    // Check if this was a failed plugin - re-throw the error
    if (pluginErrors.has(id)) {
      throw new Error(pluginErrors.get(id));
    }
    return pluginCache.get(id);
  }

  const url = `https://esm.sh/${id}`;

  try {
    logger.debug("[tailwind] Loading plugin", { id, url });
    const mod = await import(url);
    const plugin = mod.default ?? mod;
    pluginCache.set(id, plugin);
    return plugin;
  } catch (error) {
    const errorMsg = `Failed to load plugin "${id}": ${
      error instanceof Error ? error.message : String(error)
    }`;
    logger.warn(`[tailwind] ${errorMsg}`);

    // Cache the error so we show it consistently
    pluginErrors.set(id, errorMsg);

    // Throw so it propagates to error overlay
    throw new Error(errorMsg);
  }
}

/**
 * Clear plugin cache (useful for retrying after fix)
 */
export function clearPluginCache(id?: string): void {
  if (id) {
    pluginCache.delete(id);
    pluginErrors.delete(id);
  } else {
    pluginCache.clear();
    pluginErrors.clear();
  }
}

// =============================================================================
// Compiler
// =============================================================================

/**
 * Fetch Tailwind base CSS from CDN (cached)
 */
async function getTailwindBaseCSS(): Promise<string> {
  if (tailwindBaseCSS) return tailwindBaseCSS;

  const url = getTailwindCSSUrl();
  logger.debug("[tailwind] Fetching base CSS", { url });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch Tailwind CSS: ${response.status} ${response.statusText}`);
  }

  tailwindBaseCSS = await response.text();
  return tailwindBaseCSS;
}

/**
 * Get or create Tailwind compiler from stylesheet content
 * Handles: @import "tailwindcss", @plugin, @theme, custom CSS
 */
async function getCompiler(stylesheet: string): Promise<Awaited<ReturnType<typeof compile>>> {
  const hash = hashString(stylesheet);

  // Return cached compiler if stylesheet hasn't changed
  if (compiler && hash === lastStylesheetHash) {
    return compiler;
  }

  logger.debug("[tailwind] Creating new compiler", { hash });

  // Fetch Tailwind base CSS
  const tailwindBase = await getTailwindBaseCSS();

  // Create compiler with native Tailwind
  compiler = await compile(stylesheet, {
    base: "/",

    // Handle @import "tailwindcss"
    loadStylesheet: (id: string) => {
      if (id === "tailwindcss") {
        return Promise.resolve({ content: tailwindBase, base: "/", path: "/" });
      }
      // Unknown imports - return empty
      logger.debug("[tailwind] Unknown stylesheet import", { id });
      return Promise.resolve({ content: "", base: "/", path: "/" });
    },

    // Handle @plugin "package-name" (cached)
    loadModule: async (id: string) => {
      const plugin = await loadPlugin(id);
      // deno-lint-ignore no-explicit-any
      return { module: plugin as any, base: "/", path: "/" };
    },
  });

  lastStylesheetHash = hash;
  return compiler;
}

/**
 * Invalidate compiler cache (call when stylesheet changes)
 */
export function invalidateCompiler(): void {
  compiler = null;
  lastStylesheetHash = "";
}

// =============================================================================
// CSS Generation
// =============================================================================

/**
 * Generate Tailwind CSS from stylesheet + class candidates
 *
 * @param stylesheet - Project's stylesheet content (globals.css), or undefined for default
 * @param candidates - Class candidates extracted from source files
 * @param options - Generation options (minify, etc.)
 * @returns Result with CSS and optional error
 */
export async function generateTailwindCSS(
  stylesheet: string | undefined,
  candidates: string[] | Set<string>,
  options?: GenerateOptions,
): Promise<TailwindResult> {
  const css = stylesheet || DEFAULT_STYLESHEET;

  try {
    const comp = await getCompiler(css);

    // Build CSS for all candidates
    // Tailwind filters out invalid classes automatically
    let output = comp.build([...candidates]);

    // Minification: strip extra whitespace for now
    // Future: consider lightningcss for better minification
    if (options?.minify) {
      output = output.replace(/\n\s*\n/g, "\n");
    }

    logger.debug("[tailwind] Generated CSS", {
      candidateCount: candidates instanceof Set ? candidates.size : candidates.length,
      outputLength: output.length,
    });

    return { css: output };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("[tailwind] Compilation failed", { error: errorMessage });

    // Return empty CSS with error message for overlay
    return {
      css: "",
      error: errorMessage,
    };
  }
}

// =============================================================================
// Error Formatting
// =============================================================================

export interface CSSErrorInfo {
  title: string;
  message: string;
  suggestion: string;
}

/**
 * Format CSS compilation error for error overlay
 */
export function formatCSSError(error: Error | string): CSSErrorInfo {
  const msg = typeof error === "string" ? error : error.message;

  // Plugin not found
  if (msg.includes("Could not resolve") || msg.includes("Failed to load plugin")) {
    const pluginMatch = msg.match(/plugin\s*["']([^"']+)["']/i) || msg.match(/"([^"]+)"/);
    const pluginName = pluginMatch?.[1] || "unknown";
    return {
      title: "Plugin Not Found",
      message: `Could not load plugin: ${pluginName}`,
      suggestion: `Check the plugin name is correct. Try: https://esm.sh/${pluginName}`,
    };
  }

  // Invalid @theme syntax
  if (msg.includes("@theme") || msg.includes("Invalid theme")) {
    return {
      title: "Invalid @theme",
      message: msg,
      suggestion: "Check @theme syntax: @theme { --color-name: value; }",
    };
  }

  // CSS syntax error
  if (msg.includes("Unexpected") || msg.includes("Expected")) {
    return {
      title: "CSS Syntax Error",
      message: msg,
      suggestion: "Check for missing semicolons, brackets, or typos",
    };
  }

  // Generic error
  return {
    title: "Tailwind CSS Error",
    message: msg,
    suggestion: "Check your stylesheet for errors",
  };
}

// =============================================================================
// Exports for backwards compatibility
// =============================================================================

/**
 * Generate Tailwind CSS from HTML content.
 * Extracts class candidates from HTML and compiles CSS for them.
 *
 * @deprecated Use generateTailwindCSS with explicit candidates instead
 * @param html - Rendered HTML to extract classes from
 * @returns Generated CSS string
 */
export async function generateTailwind4CSS(html: string): Promise<string> {
  const candidates = extractCandidates(html);
  const result = await generateTailwindCSS(undefined, candidates);
  return result.css;
}

/**
 * Compile globals.css (backwards compatible wrapper)
 * @deprecated Use generateTailwindCSS instead
 */
export async function compileGlobalsCSS(css: string): Promise<string> {
  const result = await generateTailwindCSS(css, []);
  if (result.error) {
    throw new Error(result.error);
  }
  return result.css;
}
