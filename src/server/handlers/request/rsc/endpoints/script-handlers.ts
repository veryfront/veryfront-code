/**
 * Script endpoint handlers (client.js, dom.js)
 * @module rsc-endpoints/script-handlers
 */

import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { serverLogger } from "@veryfront/utils";

/**
 * Handle client.js endpoint
 * @returns Response with client boot script
 */
/**
 * Handle client.js endpoint
 * @returns Response with client boot script
 */
export async function handleClientScript(
  adapter: RuntimeAdapter,
): Promise<Response> {
  const p = new URL(
    "../../../../../rendering/rsc/client-boot.ts",
    import.meta.url,
  ).pathname;
  let esbuild: typeof import("esbuild/mod.js") | null = null;
  try {
    esbuild = await import("esbuild/mod.js");
    const src = await adapter.fs.readFile(p);
    const result = await esbuild.build({
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2020",
      stdin: {
        contents: src,
        loader: "ts",
        resolveDir: p.substring(0, p.lastIndexOf("/")),
        sourcefile: p,
      },
      // We need to externalize the dynamic imports that are expected to be available at runtime
      // or handled by the browser (like CDN imports)
      external: [
        "https://esm.sh/*",
        "/_veryfront/*",
      ],
    });
    const out = result.outputFiles?.[0]?.text ?? src;

    return new Response(out, {
      headers: { "content-type": "application/javascript" },
    });
  } catch (error) {
    // Fallback for npm build where esbuild/fs might not be available
    // CLIENT_BOOT_BUNDLE will be injected by the build script
    if (CLIENT_BOOT_BUNDLE) {
      return new Response(CLIENT_BOOT_BUNDLE, {
        headers: { "content-type": "application/javascript" },
      });
    }

    serverLogger.debug(
      "[ScriptHandlers] Build failed, serving raw TypeScript",
      error,
    );
    const src = await adapter.fs.readFile(p);
    return new Response(src, {
      headers: { "content-type": "application/typescript" },
    });
  } finally {
    try {
      esbuild?.stop?.();
    } catch (stopError) {
      serverLogger.debug("[ScriptHandlers] esbuild stop failed", stopError);
    }
  }
}

// Placeholder for build-time injection
export const CLIENT_BOOT_BUNDLE = "";

/**
 * Handle dom.js endpoint - provides DOM utilities for RSC streaming
 * Inlined to avoid file system dependencies in npm package context
 * @returns Response with DOM utilities
 */
export async function handleDomScript(
  adapter: RuntimeAdapter,
): Promise<Response> {
  const p = new URL(
    "../../../../../rendering/rsc/client-dom.ts",
    import.meta.url,
  ).pathname;
  let esbuild: typeof import("esbuild/mod.js") | null = null;
  try {
    // Use native esbuild for proper file system access during bundling
    // In npm build, this will be replaced by the injected bundle
    esbuild = await import("esbuild/mod.js");
    const src = await adapter.fs.readFile(p);
    const result = await esbuild.build({
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2020",
      stdin: {
        contents: src,
        loader: "ts",
        resolveDir: p.substring(0, p.lastIndexOf("/")),
        sourcefile: p,
      },
    });
    const out = result.outputFiles?.[0]?.text ?? src;

    return new Response(out, {
      headers: { "content-type": "application/javascript" },
    });
  } catch (error) {
    // Fallback for npm build where esbuild/fs might not be available
    // CLIENT_DOM_BUNDLE will be injected by the build script
    if (CLIENT_DOM_BUNDLE) {
      return new Response(CLIENT_DOM_BUNDLE, {
        headers: { "content-type": "application/javascript" },
      });
    }

    serverLogger.debug(
      "[ScriptHandlers] Build failed, serving raw TypeScript",
      error,
    );
    const src = await adapter.fs.readFile(p);
    return new Response(src, {
      headers: { "content-type": "application/typescript" },
    });
  } finally {
    try {
      esbuild?.stop?.();
    } catch (stopError) {
      serverLogger.debug("[ScriptHandlers] esbuild stop failed", stopError);
    }
  }
}

// Placeholder for build-time injection
export const CLIENT_DOM_BUNDLE = "";
