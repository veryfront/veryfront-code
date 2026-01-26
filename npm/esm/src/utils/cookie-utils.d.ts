/** Parse a cookie header string into key-value pairs */
import * as dntShim from "../../_dnt.shims.js";
export declare function parseCookies(cookieHeader: string): Record<string, string>;
/** Parse cookies from request headers */
export declare function parseCookiesFromHeaders(headers: dntShim.Headers): Record<string, string>;
//# sourceMappingURL=cookie-utils.d.ts.map