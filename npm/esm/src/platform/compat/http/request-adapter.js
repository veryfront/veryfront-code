import * as dntShim from "../../../../_dnt.shims.js";
export function convertNodeRequestToWebRequest(req, url) {
    const method = req.method;
    return new dntShim.Request(url, {
        method,
        headers: req.headers,
        body: method !== "GET" && method !== "HEAD" ? req : undefined,
    });
}
