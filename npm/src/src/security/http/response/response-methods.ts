import * as dntShim from "../../../../_dnt.shims.js";
import { CONTENT_TYPES } from "./constants.js";

export interface ResponseMethodsContext {
  headers: dntShim.Headers;
  status: number;
}

function buildResponse(
  ctx: ResponseMethodsContext,
  body: dntShim.BodyInit | null,
  status?: number,
): dntShim.Response {
  return new dntShim.Response(body, {
    status: status ?? ctx.status,
    headers: ctx.headers,
  });
}

function buildWithContentType(
  ctx: ResponseMethodsContext,
  contentType: string,
  body: dntShim.BodyInit | null,
  status?: number,
): dntShim.Response {
  ctx.headers.set("content-type", contentType);
  return buildResponse(ctx, body, status);
}

export function json(
  this: ResponseMethodsContext,
  data: unknown,
  status?: number,
): dntShim.Response {
  return buildWithContentType(this, CONTENT_TYPES.JSON, JSON.stringify(data), status);
}

export function text(
  this: ResponseMethodsContext,
  body: string,
  status?: number,
): dntShim.Response {
  return buildWithContentType(this, CONTENT_TYPES.TEXT, body, status);
}

export function html(
  this: ResponseMethodsContext,
  body: string,
  status?: number,
): dntShim.Response {
  return buildWithContentType(this, CONTENT_TYPES.HTML, body, status);
}

export function javascript(
  this: ResponseMethodsContext,
  code: string,
  status?: number,
): dntShim.Response {
  return buildWithContentType(this, CONTENT_TYPES.JAVASCRIPT, code, status);
}

export function withContentType(
  this: ResponseMethodsContext,
  contentType: string,
  body: dntShim.BodyInit | null,
  status?: number,
): dntShim.Response {
  return buildWithContentType(this, contentType, body, status);
}

export function build(
  this: ResponseMethodsContext,
  body: dntShim.BodyInit | null = null,
  status?: number,
): dntShim.Response {
  return buildResponse(this, body, status);
}

export function notModified(
  this: ResponseMethodsContext,
  etag?: string,
): dntShim.Response {
  if (etag) this.headers.set("ETag", etag);

  return new dntShim.Response(null, {
    status: 304,
    headers: this.headers,
  });
}
