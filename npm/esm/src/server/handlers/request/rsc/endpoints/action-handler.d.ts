/**
 * Action request handler with guard checks
 * @module rsc-endpoints/action-handler
 */
import * as dntShim from "../../../../../../_dnt.shims.js";
import type { ActionRequestParams } from "./types.js";
/**
 * Handle action request with guard checks
 * @param params - Action request parameters
 * @returns Response with action result or error
 */
export declare function handleActionRequest({ req, projectDir, adapter }: ActionRequestParams): Promise<dntShim.Response>;
//# sourceMappingURL=action-handler.d.ts.map