/**
 * Studio Bridge Modules Handler
 *
 * Serves the decomposed bridge ESM modules via JIT TypeScript→JS transpilation.
 * Route: /_veryfront/studio-bridge/*.js
 *
 * Each request maps a .js URL to a .ts source file under src/studio/bridge/,
 * transpiles with esbuild, and returns the result with ETag caching.
 */

import { BaseHandler } from "#veryfront/security";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../../handlers/types.ts";
import { HTTP_OK, PRIORITY_HIGH_DEV } from "#veryfront/utils/constants/index.ts";

/** In-memory cache of transpiled JS keyed by module name. */
const transpileCache = new Map<string, { js: string; etag: string }>();

/** Allowed module names (no directory traversal). */
const ALLOWED_MODULES = new Set([
  "bridge-config",
  "bridge-constants",
  "bridge-state",
  "bridge-utils",
  "bridge-styles",
  "bridge-messaging",
  "bridge-console",
  "bridge-inspector",
  "bridge-screenshot",
  "bridge-markdown-core",
  "bridge-markdown-editor",
  "bridge-markdown-yjs",
  "bridge-slash-menu",
  "bridge-inline-toolbar",
  "bridge-block-drag",
  "bridge-selection",
  "bridge-init",
  "bridge-message-handler",
  "bridge-coordinator",
]);

/**
 * Compute a simple content hash for ETag.
 */
async function computeEtag(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Transpile TypeScript source to browser-ready ESM JavaScript.
 */
async function transpileModule(moduleName: string): Promise<{ js: string; etag: string }> {
  const cached = transpileCache.get(moduleName);
  if (cached) return cached;

  // Read the TypeScript source
  const bridgeDir = new URL("../../../studio/bridge/", import.meta.url).pathname;
  const sourcePath = `${bridgeDir}${moduleName}.ts`;

  let source: string;
  try {
    source = await Deno.readTextFile(sourcePath);
  } catch {
    throw new Error(`Bridge module not found: ${moduleName}`);
  }

  // Transpile with esbuild
  const { transform } = await import("esbuild");
  const result = await transform(source, {
    loader: "ts",
    format: "esm",
    target: "es2022",
    sourcemap: false,
    minify: false,
  });

  // Rewrite .ts imports to .js for browser resolution
  let js = result.code;
  js = js.replace(
    /from\s+["'](\.\/.+?)\.ts["']/g,
    'from "./$1.js"',
  );
  // Also handle the case where esbuild already stripped .ts
  // but left bare specifiers — ensure ./bridge-foo → ./bridge-foo.js
  js = js.replace(
    /from\s+["'](\.\/bridge-[a-z-]+)["']/g,
    'from "$1.js"',
  );

  const etag = await computeEtag(js);
  const entry = { js, etag };
  transpileCache.set(moduleName, entry);
  return entry;
}

export class StudioBridgeModulesHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "StudioBridgeModulesHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [{ pattern: "/_veryfront/studio-bridge/", prefix: true }],
    enabled: () => true,
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return this.continue();
    }

    const url = new URL(req.url);
    const pathname = url.pathname;

    // Extract module name from path: /_veryfront/studio-bridge/bridge-foo.js → bridge-foo
    const prefix = "/_veryfront/studio-bridge/";
    if (!pathname.startsWith(prefix) || !pathname.endsWith(".js")) {
      return this.continue();
    }

    const moduleName = pathname.slice(prefix.length, -3); // strip prefix and .js

    // Validate module name (prevent directory traversal)
    if (!ALLOWED_MODULES.has(moduleName)) {
      return this.continue();
    }

    // Check ETag for 304
    const ifNoneMatch = req.headers.get("if-none-match");

    try {
      const { js, etag } = await transpileModule(moduleName);

      if (ifNoneMatch === `"${etag}"`) {
        return this.respond(
          new Response(null, {
            status: 304,
            headers: {
              ETag: `"${etag}"`,
              "Cache-Control": "no-cache",
            },
          }),
        );
      }

      const response = new Response(js, {
        status: HTTP_OK,
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-cache",
          ETag: `"${etag}"`,
        },
      });
      return this.respond(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[StudioBridgeModulesHandler] Transpile error for ${moduleName}:`, message);
      return this.respond(
        new Response(`// Transpile error: ${message}`, {
          status: 500,
          headers: { "Content-Type": "application/javascript; charset=utf-8" },
        }),
      );
    }
  }
}

/**
 * Invalidate the transpile cache for a specific module or all modules.
 * Used by dev file watchers to bust the cache on source changes.
 */
export function invalidateBridgeModuleCache(moduleName?: string): void {
  if (moduleName) {
    transpileCache.delete(moduleName);
  } else {
    transpileCache.clear();
  }
}
