/**
 * ResponseBuilder - Fluent methods for configuring response builder state
 */
import * as dntShim from "../../../../_dnt.shims.js";
import { applyCORSHeaders, applyCORSHeadersSync } from "../cors/index.js";
import { buildCacheControl } from "./cache-handler.js";
import { applySecurityHeaders } from "./security-handler.js";
/** Apply CORS headers based on configuration */
export function withCORS(req, corsConfig) {
    applyCORSHeadersSync({
        request: req,
        headers: this.headers,
        config: corsConfig ?? this.securityConfig?.cors,
    });
    return this;
}
/** Apply CORS headers asynchronously */
export function withCORSAsync(req) {
    return applyCORSHeaders({
        request: req,
        headers: this.headers,
        config: this.securityConfig?.cors,
    }).then(() => this);
}
/** Apply security headers (CSP, COOP, CORP, COEP) */
export function withSecurity(config) {
    applySecurityHeaders(this.headers, this.isDev, this.nonce, this.cspUserHeader, config ?? this.securityConfig, this.adapter, this.isVeryfrontDomain);
    return this;
}
/** Apply cache control headers based on strategy */
export function withCache(strategy) {
    this.headers.set("Cache-Control", buildCacheControl(strategy));
    // Add legacy headers for better browser compatibility when preventing caching
    const isNoCacheStrategy = strategy === "no-cache" || strategy === "none" ||
        strategy === "no-store";
    if (isNoCacheStrategy) {
        this.headers.set("Pragma", "no-cache");
        this.headers.set("Expires", "0");
    }
    return this;
}
/** Set ETag header */
export function withETag(etag) {
    this.headers.set("ETag", etag);
    return this;
}
/** Set custom headers */
export function withHeaders(headers) {
    const entries = headers instanceof dntShim.Headers || Array.isArray(headers)
        ? headers
        : Object.entries(headers);
    for (const [key, value] of entries) {
        this.headers.set(key, value);
    }
    return this;
}
/** Set response status */
export function withStatus(status) {
    this.status = status;
    return this;
}
/** Apply Client Hints headers for theme detection */
export function withClientHints() {
    // Tell browser we accept color scheme hints
    this.headers.set("Accept-CH", "Sec-CH-Prefers-Color-Scheme");
    // Vary response by color scheme for correct caching
    const existingVary = this.headers.get("Vary");
    this.headers.set("Vary", existingVary ? `${existingVary}, Sec-CH-Prefers-Color-Scheme` : "Sec-CH-Prefers-Color-Scheme");
    return this;
}
/** Set Allow header for OPTIONS requests */
export function withAllow(methods) {
    const methodStr = Array.isArray(methods) ? methods.join(", ") : methods;
    this.headers.set("Allow", methodStr);
    this.headers.set("Access-Control-Allow-Methods", methodStr);
    return this;
}
