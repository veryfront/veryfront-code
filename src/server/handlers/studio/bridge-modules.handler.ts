/**
 * Serves the Studio bridge script at `/_veryfront/studio-bridge.js`.
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
import { serverLogger } from "#veryfront/utils";
import { hasMatchingEtag } from "../utils/etag.ts";
import { loadStudioBridgeBundle, type StudioBridgeBundle } from "./studio-bridge-bundle.ts";

export { resolveStudioBridgeBundle, selectStudioBridgeBundleMode } from "./studio-bridge-bundle.ts";

const logger = serverLogger.component("studio-bridge-handler");
const SCRIPT_HEADERS = {
  "Content-Type": "application/javascript; charset=utf-8",
  "Cache-Control": "no-cache",
  "X-Content-Type-Options": "nosniff",
};

/** Return whether this request is an editable local development runtime. */
export function isLocalStudioBridgeDevelopment(
  ctx: Pick<
    HandlerContext,
    "config" | "isLocalProject" | "requestContext" | "resolvedEnvironment"
  >,
): boolean {
  if (ctx.isLocalProject !== true || ctx.config?.fs?.veryfront?.productionMode === true) {
    return false;
  }
  return (ctx.resolvedEnvironment ?? ctx.requestContext?.mode) !== "production";
}

export class StudioBridgeModulesHandler extends BaseHandler {
  constructor(
    private readonly loadBundle: (
      localDevelopment: boolean,
    ) => Promise<StudioBridgeBundle> = loadStudioBridgeBundle,
  ) {
    super();
  }

  metadata: HandlerMetadata = {
    name: "StudioBridgeModulesHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [
      { pattern: "/_veryfront/studio-bridge.js", exact: true, method: "GET" },
      { pattern: "/_veryfront/studio-bridge.js", exact: true, method: "HEAD" },
    ],
    enabled: () => true,
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return this.continue();

    const method = req.method.toUpperCase();
    try {
      const { js, etag } = await this.loadBundle(isLocalStudioBridgeDevelopment(ctx));
      const responseEtag = `"${etag}"`;

      if (hasMatchingEtag(req, responseEtag)) {
        return this.respond(
          new Response(null, {
            status: 304,
            headers: {
              ETag: responseEtag,
              "Cache-Control": SCRIPT_HEADERS["Cache-Control"],
              "X-Content-Type-Options": SCRIPT_HEADERS["X-Content-Type-Options"],
            },
          }),
        );
      }

      return this.respond(
        new Response(method === "HEAD" ? null : js, {
          status: HTTP_OK,
          headers: { ...SCRIPT_HEADERS, ETag: responseEtag },
        }),
      );
    } catch {
      logger.error("Studio bridge bundle failed");
      return this.respond(
        new Response(method === "HEAD" ? null : "// Studio bridge bundle is unavailable", {
          status: 500,
          headers: { ...SCRIPT_HEADERS, "Cache-Control": "no-store" },
        }),
      );
    }
  }
}
