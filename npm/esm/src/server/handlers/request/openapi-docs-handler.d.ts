/**
 * OpenAPI Docs Handler
 *
 * Serves interactive API documentation using Scalar UI at /_docs.
 * Scalar provides a modern, fast, and beautiful API explorer.
 *
 * @module server/handlers/request/openapi-docs-handler
 */
import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../types.js";
export declare class OpenAPIDocsHandler extends BaseHandler {
    metadata: HandlerMetadata;
    protected shouldHandle(req: dntShim.Request, ctx: HandlerContext): boolean;
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
    private generateDocsPage;
}
//# sourceMappingURL=openapi-docs-handler.d.ts.map