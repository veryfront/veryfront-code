
import { CONTENT_TYPES } from "./constants.ts";

export interface ResponseMethodsContext {
  headers: Headers;
  status: number;
}

export function json(
  this: ResponseMethodsContext,
  data: unknown,
  status?: number,
): Response {
  this.headers.set("content-type", CONTENT_TYPES.JSON);
  return new Response(JSON.stringify(data), {
    status: status ?? this.status,
    headers: this.headers,
  });
}

export function text(
  this: ResponseMethodsContext,
  body: string,
  status?: number,
): Response {
  this.headers.set("content-type", CONTENT_TYPES.TEXT);
  return new Response(body, {
    status: status ?? this.status,
    headers: this.headers,
  });
}

export function html(
  this: ResponseMethodsContext,
  body: string,
  status?: number,
): Response {
  this.headers.set("content-type", CONTENT_TYPES.HTML);
  return new Response(body, {
    status: status ?? this.status,
    headers: this.headers,
  });
}

export function javascript(
  this: ResponseMethodsContext,
  code: string,
  status?: number,
): Response {
  this.headers.set("content-type", CONTENT_TYPES.JAVASCRIPT);
  return new Response(code, {
    status: status ?? this.status,
    headers: this.headers,
  });
}

export function withContentType(
  this: ResponseMethodsContext,
  contentType: string,
  body: BodyInit | null,
  status?: number,
): Response {
  this.headers.set("content-type", contentType);
  return new Response(body, {
    status: status ?? this.status,
    headers: this.headers,
  });
}

export function build(
  this: ResponseMethodsContext,
  body: BodyInit | null = null,
  status?: number,
): Response {
  return new Response(body, {
    status: status ?? this.status,
    headers: this.headers,
  });
}

export function notModified(
  this: ResponseMethodsContext,
  etag?: string,
): Response {
  if (etag) {
    this.headers.set("ETag", etag);
  }
  return new Response(null, {
    status: 304,
    headers: this.headers,
  });
}
