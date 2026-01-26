import * as dntShim from "../../../../_dnt.shims.js";
import { validateOrigin, validateOriginSync } from "./validators.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
function applyValidatedHeaders(validation, options) {
    const { response, headers: headersObj, config } = options;
    if (!validation.allowedOrigin) {
        return response;
    }
    const headers = headersObj ?? (response ? new dntShim.Headers(response.headers) : new dntShim.Headers());
    headers.set("Access-Control-Allow-Origin", validation.allowedOrigin);
    if (validation.allowedOrigin !== "*") {
        const varyValues = headers
            .get("Vary")
            ?.split(",")
            .map((v) => v.trim()) ?? [];
        if (!varyValues.includes("Origin")) {
            varyValues.push("Origin");
            headers.set("Vary", varyValues.join(", "));
        }
    }
    if (validation.allowCredentials && validation.allowedOrigin !== "*") {
        headers.set("Access-Control-Allow-Credentials", "true");
    }
    const corsConfig = typeof config === "object" ? config : null;
    if (corsConfig?.exposedHeaders?.length) {
        headers.set("Access-Control-Expose-Headers", corsConfig.exposedHeaders.join(", "));
    }
    if (!response) {
        return;
    }
    return new dntShim.Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}
export function applyCORSHeaders(options) {
    const origin = options.request.headers.get("origin");
    return withSpan("security.cors.applyHeaders", async () => {
        const validation = await validateOrigin(origin, options.config);
        return applyValidatedHeaders(validation, options);
    }, { "cors.origin": origin ?? "unknown" });
}
export function applyCORSHeadersSync(options) {
    const validation = validateOriginSync(options.request.headers.get("origin"), options.config);
    return applyValidatedHeaders(validation, options);
}
export function shouldApplyCORS(request, config) {
    if (!config) {
        return false;
    }
    if (config === true) {
        return true;
    }
    const origin = request.headers.get("origin");
    if (!origin) {
        return config.origin === "*";
    }
    return true;
}
