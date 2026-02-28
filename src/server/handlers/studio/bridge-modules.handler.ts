/**
 * Studio Bridge Handler
 *
 * Serves the studio bridge script. In compiled binaries, uses a pre-bundled
 * version generated at build time. In dev mode, bundles on-the-fly with esbuild.
 *
 * Route: /_veryfront/studio-bridge.js
 *
 * @module server/handlers/studio/bridge-modules
 */

import { BaseHandler } from "#veryfront/security";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../../handlers/types.ts";
import { HTTP_OK, PRIORITY_HIGH_DEV } from "#veryfront/utils/constants/index.ts";
import { STUDIO_BRIDGE_BUNDLE } from "#veryfront/studio/bridge/bridge-bundle.generated.ts";

/** Cached bundle output. */
let bundleCache: { js: string; etag: string } | null = null;

/** Resolve the bridge source directory from this module's location. */
const BRIDGE_DIR = new URL("../../../studio/bridge/", import.meta.url).pathname;

/**
 * Compute a content hash for ETag.
 */
async function computeEtag(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Bundle the bridge coordinator (and all its imports) into a single JS file.
 * Uses pre-bundled output when available (compiled binary), falls back to
 * esbuild JIT bundling in dev mode.
 */
async function bundleBridge(): Promise<{ js: string; etag: string }> {
  if (bundleCache) return bundleCache;

  // Use pre-bundled output if available (compiled binary / CI builds)
  if (STUDIO_BRIDGE_BUNDLE) {
    const etag = await computeEtag(STUDIO_BRIDGE_BUNDLE);
    bundleCache = { js: STUDIO_BRIDGE_BUNDLE, etag };
    return bundleCache;
  }

  // Dev mode: bundle on-the-fly with esbuild
  const entryPoint = `${BRIDGE_DIR}bridge-coordinator.ts`;
  const source = await Deno.readTextFile(entryPoint);

  const { build } = await import("esbuild");
  const { outputFiles } = await build({
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    stdin: {
      contents: source,
      loader: "ts",
      resolveDir: BRIDGE_DIR,
      sourcefile: entryPoint,
    },
  });

  const js = outputFiles?.[0]?.text ?? "";
  const etag = await computeEtag(js);
  bundleCache = { js, etag };
  return bundleCache;
}

export class StudioBridgeModulesHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "StudioBridgeModulesHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [{ pattern: "/_veryfront/studio-bridge.js", exact: true }],
    enabled: () => true,
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return this.continue();
    }

    const ifNoneMatch = req.headers.get("if-none-match");

    try {
      const { js, etag } = await bundleBridge();

      if (ifNoneMatch === `"${etag}"`) {
        return this.respond(
          new Response(null, {
            status: 304,
            headers: { ETag: `"${etag}"`, "Cache-Control": "no-cache" },
          }),
        );
      }

      return this.respond(
        new Response(js, {
          status: HTTP_OK,
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-cache",
            ETag: `"${etag}"`,
          },
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[StudioBridgeHandler] Bundle error:", message);
      return this.respond(
        new Response(`// Bundle error: ${message}`, {
          status: 500,
          headers: { "Content-Type": "application/javascript; charset=utf-8" },
        }),
      );
    }
  }
}

/**
 * Invalidate the bundle cache.
 * Used by dev file watchers to bust the cache on source changes.
 */
export function invalidateBridgeModuleCache(): void {
  bundleCache = null;
}
