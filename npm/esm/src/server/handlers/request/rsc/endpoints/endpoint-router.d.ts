/**
 * RSC endpoint router and orchestrator
 * @module rsc-endpoints/endpoint-router
 */
import * as dntShim from "../../../../../../_dnt.shims.js";
import type { RSCEndpointParams } from "./types.js";
/**
 * Handle RSC endpoints
 * @param params - RSC endpoint parameters
 * @returns Response or null if not an RSC endpoint
 */
export declare function handleRSCEndpoint({ req, pathname, projectDir, adapter, config }: RSCEndpointParams): Promise<dntShim.Response | null>;
//# sourceMappingURL=endpoint-router.d.ts.map