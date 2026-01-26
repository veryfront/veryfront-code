import * as dntShim from "../../../_dnt.shims.js";
import { parseCookies } from "../../utils/cookie-utils.js";
export { parseCookies };
function createResponse(body, contentType, init) {
    return new dntShim.Response(body, {
        ...init,
        headers: {
            "Content-Type": contentType,
            ...init?.headers,
        },
    });
}
export function createContext(request, match, fs) {
    const url = new URL(request.url);
    return {
        request,
        req: request,
        params: match.params,
        query: url.searchParams,
        cookies: parseCookies(request.headers.get("cookie") ?? ""),
        headers: request.headers,
        url,
        json: (data, init) => createResponse(JSON.stringify(data), "application/json", init),
        text: (data, init) => createResponse(data, "text/plain", init),
        fs,
    };
}
export function normalizeParams(params) {
    const out = {};
    for (const [key, value] of Object.entries(params)) {
        out[key] = Array.isArray(value) ? value.join("/") : value;
    }
    return out;
}
