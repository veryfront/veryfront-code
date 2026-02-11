import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { serverLogger } from "#veryfront/utils";
import { HTTP_OK, PRIORITY_HIGH_CLIENT_LOG } from "#veryfront/utils/constants/index.ts";
import { getErrorMessage } from "#veryfront/errors/veryfront-error.ts";

const logger = serverLogger.component("client-log-handler");

export class ClientLogHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "ClientLogHandler",
    priority: PRIORITY_HIGH_CLIENT_LOG as HandlerPriority,
    patterns: [{ pattern: "/_veryfront/log", exact: true, method: "POST" }],
    enabled: (ctx) => !!ctx.isLocalProject,
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const { pathname } = new URL(req.url);

    if (!ctx.isLocalProject) return this.continue();

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

      // Use appropriate log level: client errors/warns show as info, client info shows as debug
      if (level === "error" || level === "warn") {
        serverLogger.info(`${prefix} ${message}`, details);
      } else {
        serverLogger.debug(`${prefix} ${message}`, details);
      }
    } catch (e) {
      this.handleParseError(e, body);
    }

    return this.respond(
      ResponseBuilder.json({ ok: true }, req, {
        corsConfig: ctx.securityConfig?.cors,
        status: HTTP_OK,
      }),
    );
  }

  private static readonly LOG_PREFIXES: Record<string, string> = {
    error: "[CLIENT ERROR]",
    warn: "[CLIENT WARN]",
    info: "[CLIENT]",
  } as const;

  private getLogPrefix(level: string): string {
    return ClientLogHandler.LOG_PREFIXES[level] ?? ClientLogHandler.LOG_PREFIXES.info ?? "[CLIENT]";
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
    logger.error("Body length:", body.length);

    // Try to identify the problematic character for SyntaxError
    if (!(e instanceof SyntaxError) || !e.message.includes("position")) {
      return;
    }

    const posStr = e.message.match(/position (\d+)/)?.[1];
    if (!posStr) {
      return;
    }

    const pos = parseInt(posStr, 10);
    const start = Math.max(0, pos - 20);
    const end = Math.min(body.length, pos + 20);

    logger.error("Context around error position:", body.slice(start, end));
    serverLogger.error(
      "[ClientLogHandler] Character at position:",
      body.charCodeAt(pos),
      "which is:",
      body.charAt(pos),
    );
  }
}
