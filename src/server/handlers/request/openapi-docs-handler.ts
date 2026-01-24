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
import { HTTP_OK, PRIORITY_HIGH_DEV } from "#veryfront/utils/constants/index.ts";
import { escapeHtml } from "#veryfront/html/html-escape.ts";

/** Default paths */
const DEFAULT_DOCS_PATH = "/_docs";
const DEFAULT_JSON_PATH = "/_openapi.json";

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

    const html = this.generateDocsPage(ctx);
    const isDev = ctx.requestContext?.isLocalDev ?? false;

    const response = this.createResponseBuilder(ctx)
      .withCache(isDev ? "no-cache" : { maxAge: 3600, public: true })
      .withContentType("text/html; charset=utf-8", html, HTTP_OK);

    return Promise.resolve(this.respond(response));
  }

  private generateDocsPage(ctx: HandlerContext): string {
    const specUrl = ctx.config?.openapi?.paths?.json ?? DEFAULT_JSON_PATH;
    const title = escapeHtml(ctx.config?.openapi?.title ?? "API Documentation");
    const description = ctx.config?.openapi?.description
      ? escapeHtml(ctx.config.openapi.description)
      : "";

    const configuration = JSON.stringify({
      theme: "purple",
      layout: "modern",
      hideModels: false,
      hideDownloadButton: false,
      hideTryIt: false,
      hideClientButton: false,
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
  ${description ? `<meta name="description" content="${description}"/>` : ""}
  <style>
    body {
      margin: 0;
      padding: 0;
    }
  </style>
</head>
<body>
  <script
    id="api-reference"
    data-url="${specUrl}"
    data-configuration='${configuration}'
  ></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`;
  }
}
