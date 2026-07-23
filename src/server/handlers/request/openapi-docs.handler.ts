/**
 * OpenAPI Docs Handler
 *
 * Serves interactive API documentation using Scalar UI at /_docs.
 * Scalar provides a modern, fast, and beautiful API explorer.
 *
 * @module server/handlers/request/openapi-docs-handler
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import {
  HTTP_METHOD_NOT_ALLOWED,
  HTTP_OK,
  PRIORITY_HIGH_DEV,
} from "#veryfront/utils/constants/index.ts";
import { buildAttributes, buildNonceAttribute, escapeHtml } from "#veryfront/html/html-escape.ts";

/** Default paths */
const DEFAULT_DOCS_PATH = "/_docs";
const DEFAULT_JSON_PATH = "/_openapi.json";

/** Cache duration for production docs pages (1 hour) */
const DOCS_CACHE_MAX_AGE_SECONDS = 3_600;
const SCALAR_RUNTIME_URL =
  "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.62.9/dist/browser/standalone.js";
const SCALAR_RUNTIME_INTEGRITY =
  "sha384-M2q8qmoFqvFoje8xUBOg9V0BWq2IMHZ+mwBaRX37gxfX7ylWBqFViltxRDglnu7le";

export class OpenAPIDocsHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "OpenAPIDocsHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [{ pattern: DEFAULT_DOCS_PATH, exact: true }],
    enabled: (ctx) => ctx.config?.openapi?.enabled !== false && ctx.config?.openapi?.docs !== false,
  };

  protected override shouldHandle(req: Request, ctx: HandlerContext): boolean {
    const url = new URL(req.url);
    const docsPath = ctx.config?.openapi?.paths?.docs ?? DEFAULT_DOCS_PATH;
    return url.pathname === docsPath;
  }

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return Promise.resolve(this.continue());

    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      const response = this.createResponseBuilder(ctx)
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req)
        .withCache("no-store")
        .withAllow(["GET", "HEAD"])
        .text("Method Not Allowed", HTTP_METHOD_NOT_ALLOWED);
      return Promise.resolve(this.respond(response));
    }

    const isDev = !!ctx.isLocalProject;
    const builder = this.createResponseBuilder(ctx);
    const html = this.generateDocsPage(ctx, builder.nonce);

    const response = builder
      .withCache(isDev ? "no-cache" : { maxAge: DOCS_CACHE_MAX_AGE_SECONDS, public: true })
      .withSecurity(ctx.securityConfig ?? undefined, req)
      .withContentType("text/html; charset=utf-8", method === "HEAD" ? null : html, HTTP_OK);

    return Promise.resolve(this.respond(response));
  }

  private generateDocsPage(ctx: HandlerContext, nonce?: string): string {
    const specUrl = ctx.config?.openapi?.paths?.json ?? DEFAULT_JSON_PATH;
    const title = escapeHtml(ctx.config?.openapi?.title ?? "API Documentation");
    const description = escapeHtml(ctx.config?.openapi?.description ?? "");
    const nonceAttr = buildNonceAttribute(nonce);

    const configuration = JSON.stringify({
      theme: "purple",
      layout: "modern",
      hideModels: false,
      hideDownloadButton: false,
      hideTryIt: false,
      hideClientButton: false,
    });
    const apiReferenceAttributes = buildAttributes({
      id: "api-reference",
      "data-url": specUrl,
      "data-configuration": configuration,
      ...(nonce ? { nonce } : {}),
    });
    const runtimeAttributes = buildAttributes({
      src: SCALAR_RUNTIME_URL,
      integrity: SCALAR_RUNTIME_INTEGRITY,
      crossorigin: "anonymous",
      ...(nonce ? { nonce } : {}),
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
  ${description ? `<meta name="description" content="${description}"/>` : ""}
  <style${nonceAttr}>
    body {
      margin: 0;
      padding: 0;
    }
  </style>
</head>
<body>
  <script ${apiReferenceAttributes}></script>
  <script ${runtimeAttributes}></script>
</body>
</html>`;
  }
}
