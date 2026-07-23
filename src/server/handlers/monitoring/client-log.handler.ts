import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { isRequestBodyTooLargeError, readBodyWithLimit } from "#veryfront/security/index.ts";
import { serverLogger } from "#veryfront/utils";
import {
  HTTP_BAD_REQUEST,
  HTTP_OK,
  HTTP_UNAUTHORIZED,
  PRIORITY_HIGH_CLIENT_LOG,
} from "#veryfront/utils/constants/index.ts";
import { isAuthorizedDevControlRequest } from "../dev/access-policy.ts";
import { sanitizeErrorContext, sanitizeErrorText } from "#veryfront/errors/sanitization.ts";

const logger = serverLogger.component("client-log-handler");

/** Max body size for client log payloads (64 KB) */
const CLIENT_LOG_MAX_BODY_BYTES = 64 * 1024;

/** Max length of the log message field */
const CLIENT_LOG_MESSAGE_MAX_LENGTH = 5_000;

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

    if (!isAuthorizedDevControlRequest(req, ctx)) {
      return this.respond(
        this.createPrivateResponseBuilder(req, ctx).json(
          { error: "Unauthorized" },
          HTTP_UNAUTHORIZED,
        ),
      );
    }

    try {
      const body = await readBodyWithLimit(req, CLIENT_LOG_MAX_BODY_BYTES);
      const logData = JSON.parse(body);

      const level = typeof logData?.level === "string" ? logData.level : "info";
      const message = typeof logData?.message === "string"
        ? sanitizeErrorText(logData.message, CLIENT_LOG_MESSAGE_MAX_LENGTH)
        : "[invalid message]";
      const details = logData?.details && typeof logData.details === "object"
        ? sanitizeErrorContext(logData.details)
        : undefined;

      const prefix = this.getLogPrefix(level);

      // Use appropriate log level: client errors/warns show as info, client info shows as debug
      if (level === "error" || level === "warn") {
        serverLogger.info(`${prefix} ${message}`, details);
      } else {
        serverLogger.debug(`${prefix} ${message}`, details);
      }
    } catch (e) {
      if (isRequestBodyTooLargeError(e)) {
        logger.warn("Client log body too large, rejected");
        return this.respond(
          this.createPrivateResponseBuilder(req, ctx).json({ error: "Payload too large" }, 413),
        );
      }
      logger.warn("Invalid client log payload", {
        errorName: e instanceof Error ? e.name : typeof e,
      });
      return this.respond(
        this.createPrivateResponseBuilder(req, ctx).json(
          { error: "Invalid client log payload" },
          HTTP_BAD_REQUEST,
        ),
      );
    }

    return this.respond(
      this.createPrivateResponseBuilder(req, ctx).json({ ok: true }, HTTP_OK),
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

  private createPrivateResponseBuilder(req: Request, ctx: HandlerContext) {
    const builder = this.createResponseBuilder(ctx)
      .withCORS(req, ctx.securityConfig?.cors)
      .withCache("no-store")
      .withHeaders({ "X-Content-Type-Options": "nosniff" });
    if (ctx.securityConfig) builder.withSecurity(ctx.securityConfig, req);
    return builder;
  }
}
