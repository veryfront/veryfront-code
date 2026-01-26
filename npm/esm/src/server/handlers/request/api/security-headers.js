import { applySecurityHeaders as coreApplySecurityHeaders, buildCSP as coreBuildCSP, generateNonce, getSecurityHeader as coreGetSecurityHeader, } from "../../../../security/http/response/security-handler.js";
export function buildCSP(ctx) {
    const isDev = ctx.requestContext?.isLocalDev ?? false;
    return coreBuildCSP(isDev, generateNonce(), ctx.cspUserHeader ?? null, ctx.securityConfig, ctx.adapter);
}
export function getSecurityHeader(headerName, defaultValue, ctx) {
    return coreGetSecurityHeader(headerName, defaultValue, ctx.securityConfig, ctx.adapter);
}
export function applySecurityHeaders(headers, ctx) {
    const isDev = ctx.requestContext?.isLocalDev ?? false;
    coreApplySecurityHeaders(headers, isDev, generateNonce(), ctx.cspUserHeader ?? null, ctx.securityConfig, ctx.adapter, ctx.parsedDomain?.allowIframeEmbed ?? false);
}
