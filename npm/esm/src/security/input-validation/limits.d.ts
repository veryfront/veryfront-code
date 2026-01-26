import * as dntShim from "../../../_dnt.shims.js";
import { type RequestLimits } from "./types.js";
export declare function validateRequestLimits(request: dntShim.Request, limits?: RequestLimits): void;
export declare function readBodyWithLimit(request: dntShim.Request, maxSize?: number): Promise<string>;
//# sourceMappingURL=limits.d.ts.map