import { getTraceContext } from "./tracing.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  traceId?: string;
  spanId?: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

function isProduction(): boolean {
  return Deno.env.get("NODE_ENV") === "production";
}

function getLogFormat(): "json" | "text" {
  const format = Deno.env.get("LOG_FORMAT");
  if (format === "json" || format === "text") return format;
  return isProduction() ? "json" : "text";
}

function serializeError(err: unknown): LogEntry["error"] | undefined {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  if (err !== undefined && err !== null) {
    return { name: "UnknownError", message: String(err) };
  }
  return undefined;
}

class ProxyLogger {
  private format = getLogFormat();

  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: unknown,
  ): void {
    if (this.format === "json") {
      const traceCtx = getTraceContext();
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        service: "proxy",
        message,
        ...(traceCtx.traceId && { traceId: traceCtx.traceId, spanId: traceCtx.spanId }),
      };
      if (context && Object.keys(context).length > 0) {
        entry.context = context;
      }
      const serializedError = serializeError(error);
      if (serializedError) {
        entry.error = serializedError;
      }
      console.log(JSON.stringify(entry));
    } else {
      const prefix = level === "info" ? "" : ` ${level.toUpperCase()}:`;
      if (context && Object.keys(context).length > 0) {
        console.log(`[PROXY]${prefix} ${message}`, context);
      } else if (error) {
        console.log(`[PROXY]${prefix} ${message}`, error);
      } else {
        console.log(`[PROXY]${prefix} ${message}`);
      }
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log("warn", message, context);
  }

  error(message: string, error?: unknown): void;
  error(
    message: string,
    context: Record<string, unknown>,
    error?: unknown,
  ): void;
  error(
    message: string,
    contextOrError?: Record<string, unknown> | unknown,
    error?: unknown,
  ): void {
    if (contextOrError instanceof Error || error !== undefined) {
      const ctx = contextOrError instanceof Error
        ? undefined
        : contextOrError as Record<string, unknown>;
      const err = contextOrError instanceof Error ? contextOrError : error;
      this.log("error", message, ctx, err);
    } else {
      this.log("error", message, contextOrError as Record<string, unknown>);
    }
  }

  /**
   * Create a child logger with bound context.
   */
  child(context: Record<string, unknown>): ChildProxyLogger {
    return new ChildProxyLogger(this, context);
  }
}

class ChildProxyLogger {
  constructor(
    private parent: ProxyLogger,
    private boundContext: Record<string, unknown>,
  ) {}

  private merge(ctx?: Record<string, unknown>): Record<string, unknown> {
    return { ...this.boundContext, ...ctx };
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.parent.debug(message, this.merge(context));
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.parent.info(message, this.merge(context));
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.parent.warn(message, this.merge(context));
  }

  error(message: string, error?: unknown): void;
  error(
    message: string,
    context: Record<string, unknown>,
    error?: unknown,
  ): void;
  error(
    message: string,
    contextOrError?: Record<string, unknown> | unknown,
    error?: unknown,
  ): void {
    if (contextOrError instanceof Error || error !== undefined) {
      const ctx = contextOrError instanceof Error
        ? this.boundContext
        : this.merge(contextOrError as Record<string, unknown>);
      const err = contextOrError instanceof Error ? contextOrError : error;
      this.parent.error(message, ctx, err);
    } else {
      this.parent.error(
        message,
        this.merge(contextOrError as Record<string, unknown>),
      );
    }
  }

  child(context: Record<string, unknown>): ChildProxyLogger {
    return new ChildProxyLogger(this.parent, this.merge(context));
  }
}

export const proxyLogger = new ProxyLogger();
