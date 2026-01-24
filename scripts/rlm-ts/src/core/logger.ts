/**
 * RLM Logger
 *
 * Structured logging for RLM operations with configurable levels and outputs
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: Record<string, unknown>;
  traceId?: string;
}

export interface LoggerConfig {
  level: LogLevel;
  format?: "json" | "pretty";
  output?: (entry: LogEntry) => void;
  traceId?: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

export class Logger {
  private config: LoggerConfig;
  private traceId?: string;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: config.level ?? "info",
      format: config.format ?? "pretty",
      output: config.output,
      traceId: config.traceId,
    };
    this.traceId = config.traceId;
  }

  /**
   * Create a child logger with additional context
   */
  child(context: { traceId?: string }): Logger {
    return new Logger({
      ...this.config,
      traceId: context.traceId ?? this.traceId,
    });
  }

  /**
   * Set the trace ID for correlation
   */
  setTraceId(traceId: string): void {
    this.traceId = traceId;
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  /**
   * Log an info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log("warn", message, context);
  }

  /**
   * Log an error message
   */
  error(message: string, context?: Record<string, unknown>): void {
    this.log("error", message, context);
  }

  /**
   * Log an iteration start
   */
  iteration(index: number, context?: Record<string, unknown>): void {
    this.info(`[Iteration ${index}] Starting`, context);
  }

  /**
   * Log code execution
   */
  codeExecution(
    code: string,
    result: { success: boolean; output?: string; error?: string }
  ): void {
    const truncatedCode =
      code.length > 200 ? code.substring(0, 200) + "..." : code;

    if (result.success) {
      this.debug("Code executed successfully", {
        code: truncatedCode,
        output: result.output,
      });
    } else {
      this.warn("Code execution failed", {
        code: truncatedCode,
        error: result.error,
      });
    }
  }

  /**
   * Log LLM completion
   */
  completion(
    model: string,
    tokens: { input: number; output: number },
    latencyMs: number
  ): void {
    this.debug("LLM completion", {
      model,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      latencyMs,
    });
  }

  /**
   * Log nested RLM call
   */
  nestedCall(depth: number, query: string): void {
    this.info(`[Depth ${depth}] Nested RLM call`, {
      queryPreview: query.substring(0, 100),
    });
  }

  /**
   * Log final answer found
   */
  finalAnswer(answer: string): void {
    this.info("Final answer found", {
      answerPreview: answer.substring(0, 200),
    });
  }

  /**
   * Core logging implementation
   */
  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>
  ): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.config.level]) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      context,
      traceId: this.traceId,
    };

    if (this.config.output) {
      this.config.output(entry);
    } else {
      this.defaultOutput(entry);
    }
  }

  /**
   * Default console output
   */
  private defaultOutput(entry: LogEntry): void {
    if (this.config.format === "json") {
      console.log(JSON.stringify(entry));
      return;
    }

    const timestamp = entry.timestamp.toISOString();
    const prefix = entry.traceId ? `[${entry.traceId.substring(0, 8)}]` : "";
    const levelTag = `[${entry.level.toUpperCase()}]`;

    let output = `${timestamp} ${levelTag}${prefix} ${entry.message}`;

    if (entry.context && Object.keys(entry.context).length > 0) {
      output += ` ${JSON.stringify(entry.context)}`;
    }

    switch (entry.level) {
      case "debug":
        console.debug(output);
        break;
      case "info":
        console.info(output);
        break;
      case "warn":
        console.warn(output);
        break;
      case "error":
        console.error(output);
        break;
    }
  }
}

/**
 * Create a logger instance
 */
export function createLogger(config?: Partial<LoggerConfig>): Logger {
  return new Logger(config);
}

/**
 * No-op logger for silent operation
 */
export const silentLogger = new Logger({ level: "silent" });

/**
 * Default logger instance
 */
export const defaultLogger = new Logger({ level: "info" });
