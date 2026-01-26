import * as dntShim from "../../../../_dnt.shims.js";
import type { CORSConfig, CORSHeaderOptions } from "./types.js";
export declare function applyCORSHeaders(options: CORSHeaderOptions): Promise<dntShim.Response | void>;
export declare function applyCORSHeadersSync(options: CORSHeaderOptions): dntShim.Response | void;
export declare function shouldApplyCORS(request: dntShim.Request, config?: boolean | CORSConfig): boolean;
//# sourceMappingURL=headers.d.ts.map