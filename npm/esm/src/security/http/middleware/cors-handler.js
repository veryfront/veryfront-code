import { validateOriginSync } from "../cors/validators.js";
export function setCors(headers, req, securityConfig) {
    const validation = validateOriginSync(req.headers.get("origin"), securityConfig?.cors);
    const allowedOrigin = validation.allowedOrigin;
    if (!allowedOrigin)
        return;
    headers.set("Access-Control-Allow-Origin", allowedOrigin);
    if (allowedOrigin !== "*") {
        headers.set("Vary", "Origin");
    }
}
