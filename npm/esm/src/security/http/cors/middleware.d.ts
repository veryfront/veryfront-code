import type { MiddlewareHandler } from "../../../middleware/core/index.js";
import type { CORSConfig } from "./types.js";
export declare function cors(config?: boolean | CORSConfig): MiddlewareHandler;
export declare function corsSimple(origin?: string): MiddlewareHandler;
//# sourceMappingURL=middleware.d.ts.map