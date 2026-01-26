/**
 * Studio Endpoints Handler
 * Handles studio bridge script and other studio-specific endpoints
 */
import * as dntShim from "../../../../_dnt.shims.js";


import { BaseHandler } from "../../../security/index.js";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../types.js";
import { HTTP_OK, PRIORITY_HIGH_DEV } from "../../../utils/constants/index.js";
import { generateStudioBridgeScript } from "../../../studio/bridge-template.js";

export class StudioEndpointsHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "StudioEndpointsHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [{ pattern: "/_veryfront/studio-bridge.js", exact: true }],
    enabled: () => true, // Always enabled - studio_embed check is in the script
  };

  handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return Promise.resolve(this.continue());
    }

    const url = new URL(req.url);
    if (url.pathname !== "/_veryfront/studio-bridge.js") {
      return Promise.resolve(this.continue());
    }

    const builder = this.createResponseBuilder(ctx);

    const projectId = url.searchParams.get("projectId") ?? "";
    const pageId = url.searchParams.get("pageId") ?? "";
    const pagePath = url.searchParams.get("pagePath") ?? undefined;

    const script = generateStudioBridgeScript({ projectId, pageId, pagePath });
    const response = builder.withCache("no-cache").javascript(script, HTTP_OK);

    return Promise.resolve(this.respond(response));
  }
}
