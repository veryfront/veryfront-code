/**
 * Studio Endpoints Handler
 * Handles studio bridge script and other studio-specific endpoints
 */

import { BaseHandler } from "@veryfront/security";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../../handlers/types.ts";
import { HTTP_OK, PRIORITY_HIGH_DEV } from "@veryfront/core/constants/index.ts";
import { generateStudioBridgeScript } from "../../../studio/bridge-template.ts";

export class StudioEndpointsHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "StudioEndpointsHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [
      { pattern: "/_veryfront/studio-bridge.js", exact: true },
    ],
    enabled: () => true, // Always enabled - studio_embed check is in the script
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (!this.shouldHandle(req, ctx)) {
      return Promise.resolve(this.continue());
    }

    const builder = this.createResponseBuilder(ctx);

    if (pathname === "/_veryfront/studio-bridge.js") {
      const projectId = url.searchParams.get("projectId") || "";
      const pageId = url.searchParams.get("pageId") || "";
      const pagePath = url.searchParams.get("pagePath") || undefined;

      const script = generateStudioBridgeScript({ projectId, pageId, pagePath });
      const response = builder
        .withCache("no-cache")
        .javascript(script, HTTP_OK);
      return Promise.resolve(this.respond(response));
    }

    return Promise.resolve(this.continue());
  }
}
