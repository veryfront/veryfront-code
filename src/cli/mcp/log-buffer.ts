/**
 * Log Buffer for Dev Server
 *
 * Buffers server logs for streaming to MCP clients.
 * Supports filtering, tailing, and subscriptions.
 */

// ============================================================================
// Types
// ============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  /** Unique log identifier */
  id: string;
  /** Log severity level */
  level: LogLevel;
  /** Log message */
  message: string;
  /** Additional structured data */
  data?: Record<string, unknown>;
  /** When the log was created */
  timestamp: number;
  /** Log source (e.g., "server", "hmr", "transform") */
  source: string;
}

export interface LogFilter {
  level?: LogLevel | LogLevel[];
  source?: string | string[];
  pattern?: string | RegExp;
  since?: number;
  limit?: number;
}

export type LogSubscriber = (entry: LogEntry) => void;

// ============================================================================
// Log Buffer
// ============================================================================

export class LogBuffer {
  private entries: LogEntry[] = [];
  private subscribers: Set<LogSubscriber> = new Set();
  private idCounter = 0;
  private maxSize: number;

  constructor(options: { maxSize?: number } = {}) {
    this.maxSize = options.maxSize ?? 1000;
  }

  /**
   * Generate a unique log ID
   */
  private generateId(): string {
    return `log_${Date.now()}_${++this.idCounter}`;
  }

  /**
   * Append a log entry
   */
  append(entry: Omit<LogEntry, "id" | "timestamp">): LogEntry {
    const fullEntry: LogEntry = {
      ...entry,
      id: this.generateId(),
      timestamp: Date.now(),
    };

    // Add to buffer
    this.entries.push(fullEntry);

    // Trim if over capacity
    while (this.entries.length > this.maxSize) {
      this.entries.shift();
    }

    // Notify subscribers
    for (const subscriber of this.subscribers) {
      try {
        subscriber(fullEntry);
      } catch {
        // Ignore subscriber errors
      }
    }

    return fullEntry;
  }

  /**
   * Log at debug level
   */
  debug(message: string, source = "server", data?: Record<string, unknown>): LogEntry {
    return this.append({ level: "debug", message, source, data });
  }

  /**
   * Log at info level
   */
  info(message: string, source = "server", data?: Record<string, unknown>): LogEntry {
    return this.append({ level: "info", message, source, data });
  }

  /**
   * Log at warn level
   */
  warn(message: string, source = "server", data?: Record<string, unknown>): LogEntry {
    return this.append({ level: "warn", message, source, data });
  }

  /**
   * Log at error level
   */
  error(message: string, source = "server", data?: Record<string, unknown>): LogEntry {
    return this.append({ level: "error", message, source, data });
  }

  /**
   * Query logs with filtering
   */
  query(filter?: LogFilter): LogEntry[] {
    let results = [...this.entries];

    if (filter) {
      // Filter by level
      if (filter.level) {
        const levels = Array.isArray(filter.level) ? filter.level : [filter.level];
        results = results.filter((e) => levels.includes(e.level));
      }

      // Filter by source
      if (filter.source) {
        const sources = Array.isArray(filter.source) ? filter.source : [filter.source];
        results = results.filter((e) => sources.includes(e.source));
      }

      // Filter by pattern
      if (filter.pattern) {
        if (typeof filter.pattern === "string") {
          const lower = filter.pattern.toLowerCase();
          results = results.filter((e) => e.message.toLowerCase().includes(lower));
        } else {
          results = results.filter((e) =>
            filter.pattern instanceof RegExp && filter.pattern.test(e.message)
          );
        }
      }

      // Filter by time
      if (filter.since) {
        results = results.filter((e) => e.timestamp >= filter.since!);
      }

      // Apply limit
      if (filter.limit && results.length > filter.limit) {
        results = results.slice(-filter.limit);
      }
    }

    return results;
  }

  /**
   * Get the last N entries (tail)
   */
  tail(count = 50): LogEntry[] {
    return this.entries.slice(-count);
  }

  /**
   * Get all entries
   */
  getAll(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Get entry count
   */
  get count(): number {
    return this.entries.length;
  }

  /**
   * Get count by level
   */
  countByLevel(): Record<LogLevel, number> {
    const counts: Record<LogLevel, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
    };

    for (const entry of this.entries) {
      counts[entry.level]++;
    }

    return counts;
  }

  /**
   * Subscribe to new log entries
   */
  subscribe(callback: LogSubscriber): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Convert to JSON-serializable format
   */
  toJSON(): LogEntry[] {
    return this.getAll();
  }

  /**
   * Format entries as plain text (for CLI display)
   */
  format(entries?: LogEntry[]): string {
    const logs = entries ?? this.entries;
    return logs.map((e) => {
      const time = new Date(e.timestamp).toISOString().slice(11, 23);
      const level = e.level.toUpperCase().padEnd(5);
      const source = e.source.padEnd(10);
      return `${time} ${level} [${source}] ${e.message}`;
    }).join("\n");
  }
}

// ============================================================================
// Global Instance
// ============================================================================

let globalBuffer: LogBuffer | null = null;

/**
 * Get or create the global log buffer
 */
export function getLogBuffer(): LogBuffer {
  if (!globalBuffer) {
    globalBuffer = new LogBuffer();
  }
  return globalBuffer;
}

/**
 * Reset the global buffer (for testing)
 */
export function resetLogBuffer(): void {
  globalBuffer?.clear();
  globalBuffer = null;
}

// ============================================================================
// Console Interceptor
// ============================================================================

/**
 * Intercept console output and route to log buffer
 */
export function interceptConsole(buffer: LogBuffer, source = "console"): () => void {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  const formatArgs = (...args: unknown[]): string => {
    return args.map((a) => {
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    }).join(" ");
  };

  console.log = (...args: unknown[]) => {
    buffer.info(formatArgs(...args), source);
    original.log.apply(console, args);
  };

  console.info = (...args: unknown[]) => {
    buffer.info(formatArgs(...args), source);
    original.info.apply(console, args);
  };

  console.warn = (...args: unknown[]) => {
    buffer.warn(formatArgs(...args), source);
    original.warn.apply(console, args);
  };

  console.error = (...args: unknown[]) => {
    buffer.error(formatArgs(...args), source);
    original.error.apply(console, args);
  };

  console.debug = (...args: unknown[]) => {
    buffer.debug(formatArgs(...args), source);
    original.debug.apply(console, args);
  };

  // Return restore function
  return () => {
    Object.assign(console, original);
  };
}
