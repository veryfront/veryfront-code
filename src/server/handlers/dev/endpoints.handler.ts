/****
 * Development Endpoints Handler
 * Handles HMR runtime, error overlay, and other dev-specific endpoints
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { HTTP_OK, PRIORITY_HIGH_DEV } from "#veryfront/utils/constants/index.ts";
import { getHMRScript, getPreviewHMRScript } from "./scripts/hmr-scripts.ts";
import { getErrorOverlay } from "./scripts/error-overlay.ts";
import { getHydrateScript } from "./scripts/dev-loader.ts";

const DEFAULT_HMR_PORT = "3000";

export class DevEndpointsHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "DevEndpointsHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [
      { pattern: "/_veryfront/error-overlay.js", exact: true },
      { pattern: "/_veryfront/hmr.js", exact: true },
      { pattern: "/_veryfront/hydrate.js", exact: true },
      { pattern: "/_veryfront/preview-hmr.js", exact: true },
    ],
    enabled: (ctx) => ctx.isLocalProject || ctx.requestContext?.mode === "preview",
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return Promise.resolve(this.continue());
    }

    const url = new URL(req.url);
    const script = this.getScriptForPath(url.pathname, url);
    if (!script) {
      return Promise.resolve(this.continue());
    }

    const response = this.createResponseBuilder(ctx).withCache("no-cache").javascript(
      script,
      HTTP_OK,
    );
    return Promise.resolve(this.respond(response));
  }

  private getScriptForPath(pathname: string, url: URL): string | null {
    switch (pathname) {
      case "/_veryfront/hmr.js": {
        const port = url.searchParams.get("port") ?? DEFAULT_HMR_PORT;
        return getHMRScript(parseInt(port, 10));
      }
      case "/_veryfront/hydrate.js": {
        const slug = url.searchParams.get("slug") ?? "";
        return getHydrateScript(slug);
      }
      case "/_veryfront/error-overlay.js":
        return getErrorOverlay();
      case "/_veryfront/preview-hmr.js":
        return getPreviewHMRScript();
      default:
        return null;
    }
  }
}
