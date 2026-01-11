import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { ResponseBuilder } from "@veryfront/security/index.ts";
import { serverLogger } from "@veryfront/utils";
import { HTTP_OK, PRIORITY_HIGH_CLIENT_LOG } from "@veryfront/core/constants/index.ts";
import { getErrorMessage } from "@veryfront/errors/veryfront-error.ts";

export class ClientLogHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "ClientLogHandler",
    priority: PRIORITY_HIGH_CLIENT_LOG as HandlerPriority, // HIGH priority
    patterns: [
      { pattern: "/_veryfront/log", exact: true, method: "POST" },
    ],
    enabled: (ctx) => ctx.mode === "development", // Only in dev mode
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname !== "/_veryfront/log" || req.method !== "POST") {
      return this.continue();
    }

    let body = "";
    try {
      body = await req.text();
      const logData = JSON.parse(body);

      const level = typeof logData?.level === "string" ? logData.level : "info";
      const message = typeof logData?.message === "string"
        ? logData.message.slice(0, 5000)
        : "[invalid message]";
      const details = logData?.details && typeof logData.details === "object"
        ? logData.details
        : undefined;

      const prefix = this.getLogPrefix(level);
      serverLogger.info(`${prefix} ${message}`, details);

      return this.respond(
        ResponseBuilder.json({ ok: true }, req, {
          corsConfig: ctx.securityConfig?.cors,
          status: HTTP_OK,
        }),
      );
    } catch (e) {
      this.handleParseError(e, body);

      return this.respond(
        ResponseBuilder.json({ ok: true }, req, {
          corsConfig: ctx.securityConfig?.cors,
          status: HTTP_OK,
        }),
      );
    }
  }

  private static readonly LOG_PREFIXES: Record<string, string> = {
    error: "❌ [CLIENT]",
    warn: "⚠️  [CLIENT]",
    info: "ℹ️  [CLIENT]",
  } as const;

  private getLogPrefix(level: string): string {
    return ClientLogHandler.LOG_PREFIXES[level] ?? ClientLogHandler.LOG_PREFIXES.info!;
  }

  private handleParseError(e: unknown, body: string): void {
    serverLogger.error(
      "[ClientLogHandler] Failed to parse client log. Error:",
      getErrorMessage(e),
    );
    serverLogger.error(
      "[ClientLogHandler] Raw body received (first 500 chars):",
      body.slice(0, 500),
    );
    serverLogger.error("[ClientLogHandler] Body length:", body.length);

    // Try to identify the problematic character for SyntaxError
    if (e instanceof SyntaxError && e.message.includes("position")) {
      const match = e.message.match(/position (\d+)/);
      if (match && match[1]) {
        const pos = parseInt(match[1], 10);
        const start = Math.max(0, pos - 20);
        const end = Math.min(body.length, pos + 20);
        serverLogger.error(
          "[ClientLogHandler] Context around error position:",
          body.slice(start, end),
        );
        serverLogger.error(
          "[ClientLogHandler] Character at position:",
          body.charCodeAt(pos),
          "which is:",
          body.charAt(pos),
        );
      }
    }
  }
}
