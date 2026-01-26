import * as dntShim from "../../../_dnt.shims.js";
import type { RouteMatch } from "./api-route-matcher.js";
import type { FileSystemAdapter } from "../../platform/adapters/base.js";
import { parseCookies } from "../../utils/cookie-utils.js";
export { parseCookies };
export interface APIContext {
    request: dntShim.Request;
    req: dntShim.Request;
    params: Record<string, string | string[]>;
    query: URLSearchParams;
    cookies: Record<string, string>;
    headers: dntShim.Headers;
    url: URL;
    json: (data: unknown, init?: dntShim.ResponseInit) => dntShim.Response;
    text: (data: string, init?: dntShim.ResponseInit) => dntShim.Response;
    fs: FileSystemAdapter;
}
export declare function createContext(request: dntShim.Request, match: RouteMatch, fs: FileSystemAdapter): APIContext;
export declare function normalizeParams(params: Record<string, string | string[]>): Record<string, string>;
//# sourceMappingURL=context-builder.d.ts.map