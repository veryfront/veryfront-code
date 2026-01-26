import * as dntShim from "../../../../../_dnt.shims.js";
import type { HandlerContext } from "../../types.js";
export declare function buildCSP(ctx: HandlerContext): string;
export declare function getSecurityHeader(headerName: string, defaultValue: string, ctx: HandlerContext): string;
export declare function applySecurityHeaders(headers: dntShim.Headers, ctx: HandlerContext): void;
//# sourceMappingURL=security-headers.d.ts.map