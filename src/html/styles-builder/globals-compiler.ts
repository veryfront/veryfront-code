/**
 * Globals CSS Compiler
 *
 * Compiles project's globals.css using Tailwind's programmatic API.
 * Handles @theme, @utility, @variant, @plugin directives properly.
 */

import { compile } from "tailwindcss";
import { serverLogger as logger } from "#veryfront/utils";
import { getTailwindCSSUrl } from "#veryfront/utils/constants/cdn.ts";

// Cache for Tailwind base CSS
let tailwindBaseCSS: string | null = null;

// Cache for loaded plugin modules
const pluginCache = new Map<string, unknown>();

/**
 * Fetch Tailwind base CSS (cached)
 */
async function getTailwindBaseCSS(): Promise<string> {
  if (tailwindBaseCSS) return tailwindBaseCSS;

  const url = getTailwindCSSUrl();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch Tailwind CSS: ${response.status}`);
  }
  tailwindBaseCSS = await response.text();
  return tailwindBaseCSS;
}

/**
 * Map plugin names to ESM CDN URLs
 */
function getPluginUrl(id: string): string {
  // Handle scoped packages
  if (id.startsWith("@")) {
    return `https://esm.sh/${id}`;
  }
  return `https://esm.sh/${id}`;
}

/**
 * Load a Tailwind plugin module from ESM CDN
 */
async function loadPlugin(id: string): Promise<unknown> {
  if (pluginCache.has(id)) {
    return pluginCache.get(id);
  }

  try {
    const url = getPluginUrl(id);
    logger.debug("[globals-compiler] Loading plugin:", { id, url });
    const mod = await import(url);
    const plugin = mod.default || mod;
    pluginCache.set(id, plugin);
    return plugin;
  } catch (error) {
    logger.warn("[globals-compiler] Failed to load plugin:", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    // Return empty function as fallback
    return () => {};
  }
}

/**
 * Compile globals.css using Tailwind's programmatic API.
 *
 * This properly processes:
 * - @import "tailwindcss"
 * - @theme { ... }
 * - @utility { ... }
 * - @variant (both inline and block forms)
 * - @plugin (loads from ESM CDN)
 * - :root and [data-theme] CSS variables
 *
 * @param css - Raw globals.css content
 * @returns Compiled CSS ready for browser
 */
export async function compileGlobalsCSS(css: string): Promise<string> {
  try {
    const tailwindBase = await getTailwindBaseCSS();

    const compiler = await compile(css, {
      base: "/",
      loadStylesheet: (id: string) => {
        // Handle @import "tailwindcss"
        if (id === "tailwindcss") {
          return Promise.resolve({ content: tailwindBase, base: "/", path: "/" });
        }
        // Other imports - return empty
        logger.debug("[globals-compiler] Unknown stylesheet import:", { id });
        return Promise.resolve({ content: "", base: "/", path: "/" });
      },
      loadModule: async (id: string) => {
        // Load plugin from ESM CDN
        const plugin = await loadPlugin(id);
        // deno-lint-ignore no-explicit-any
        return { module: plugin as any, base: "/", path: "/" };
      },
    });

    // Build with empty class list - we just want the base CSS with theme variables
    // The actual utility classes are handled by the CDN at runtime
    const compiled = compiler.build([]);

    return compiled;
  } catch (error) {
    logger.error("[globals-compiler] Compilation failed:", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
