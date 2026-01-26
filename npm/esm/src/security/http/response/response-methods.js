import * as dntShim from "../../../../_dnt.shims.js";
import { CONTENT_TYPES } from "./constants.js";
function buildResponse(ctx, body, status) {
    return new dntShim.Response(body, {
        status: status ?? ctx.status,
        headers: ctx.headers,
    });
}
function buildWithContentType(ctx, contentType, body, status) {
    ctx.headers.set("content-type", contentType);
    return buildResponse(ctx, body, status);
}
export function json(data, status) {
    return buildWithContentType(this, CONTENT_TYPES.JSON, JSON.stringify(data), status);
}
export function text(body, status) {
    return buildWithContentType(this, CONTENT_TYPES.TEXT, body, status);
}
export function html(body, status) {
    return buildWithContentType(this, CONTENT_TYPES.HTML, body, status);
}
export function javascript(code, status) {
    return buildWithContentType(this, CONTENT_TYPES.JAVASCRIPT, code, status);
}
export function withContentType(contentType, body, status) {
    return buildWithContentType(this, contentType, body, status);
}
export function build(body = null, status) {
    return buildResponse(this, body, status);
}
export function notModified(etag) {
    if (etag)
        this.headers.set("ETag", etag);
    return new dntShim.Response(null, {
        status: 304,
        headers: this.headers,
    });
}
