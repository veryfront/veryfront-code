/****
 * Pages Router API Handler
 *
 * Handles Pages Router API routes (under /api/ directory).
 */
import { APIRouteHandler } from "../../../../routing/index.js";
import type { HandlerContext } from "../../types.js";
export declare function getApiHandler(ctx: HandlerContext): Promise<APIRouteHandler>;
export declare function resetApiHandler(projectDir?: string): Promise<void>;
//# sourceMappingURL=pages-api-handler.d.ts.map