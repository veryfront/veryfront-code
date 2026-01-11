import { BaseHandler } from "./base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { ResponseBuilder } from "@veryfront/security/index.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  PRIORITY_FALLBACK,
} from "@veryfront/core/constants/index.ts";
import { escapeHtml } from "@veryfront/html/html-escape.ts";

export class NotFoundHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "NotFoundHandler",
    priority: PRIORITY_FALLBACK as HandlerPriority, // FALLBACK priority - runs last
    patterns: [], // Matches everything as fallback
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    try {
      const html = this.generate404Html(pathname);
      const response = ResponseBuilder.html(html, req, {
        securityConfig: ctx.securityConfig ?? undefined,
        corsConfig: ctx.securityConfig?.cors,
        cache: "no-cache",
        status: HTTP_NOT_FOUND,
      });

      return Promise.resolve(this.respond(response));
    } catch (e) {
      this.logDebug("404 fallback error", {
        error: this.getErrorMessage(e),
      }, ctx);

      // Last resort error response
      return Promise.resolve(this.respond(
        ResponseBuilder.error(HTTP_INTERNAL_SERVER_ERROR, "Internal Server Error", req, {
          securityConfig: ctx.securityConfig ?? undefined,
          corsConfig: ctx.securityConfig?.cors,
        }),
      ));
    }
  }

  private generate404Html(pathname: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>404 Not Found</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            margin: 0;
            padding: 40px;
            background: #f5f5f5;
            color: #333;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            box-sizing: border-box;
        }
        .container {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            padding: 40px;
            max-width: 600px;
            text-align: center;
        }
        h1 {
            font-size: 48px;
            margin: 0 0 16px 0;
            color: #000;
        }
        h2 {
            font-size: 24px;
            font-weight: normal;
            margin: 0 0 24px 0;
            color: #666;
        }
        p {
            line-height: 1.6;
            margin: 0 0 32px 0;
            color: #666;
        }
        code {
            background: #f5f5f5;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
            font-size: 14px;
        }
        a {
            color: #0066cc;
            text-decoration: none;
            font-weight: 500;
            transition: color 0.2s;
        }
        a:hover {
            color: #0052a3;
            text-decoration: underline;
        }
        .actions {
            display: flex;
            gap: 16px;
            justify-content: center;
            flex-wrap: wrap;
        }
        .button {
            display: inline-block;
            padding: 12px 24px;
            background: #0066cc;
            color: white;
            border-radius: 6px;
            font-weight: 500;
            transition: background 0.2s;
        }
        .button:hover {
            background: #0052a3;
            text-decoration: none;
        }
        .secondary {
            background: transparent;
            color: #0066cc;
            border: 2px solid #0066cc;
        }
        .secondary:hover {
            background: #0066cc;
            color: white;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>404</h1>
        <h2>Page Not Found</h2>
        <p>
            The path <code>${escapeHtml(pathname)}</code> was not found on this server.
        </p>
        <div class="actions">
            <a href="/" class="button">Go Home</a>
            <a href="javascript:history.back()" class="button secondary">Go Back</a>
        </div>
    </div>
</body>
</html>`;
  }
}
