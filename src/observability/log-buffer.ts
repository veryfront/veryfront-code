export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
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

export class LogBuffer {
  private entries: LogEntry[] = [];
  private subscribers = new Set<LogSubscriber>();
  private idCounter = 0;
  private maxSize: number;

  constructor(options: { maxSize?: number } = {}) {
    this.maxSize = options.maxSize ?? 1000;
  }

  private generateId(): string {
    return `log_${Date.now()}_${++this.idCounter}`;
  }

  append(entry: Omit<LogEntry, "id" | "timestamp">): LogEntry {
    const fullEntry: LogEntry = {
      ...entry,
      id: this.generateId(),
      timestamp: Date.now(),
    };

    this.entries.push(fullEntry);

    while (this.entries.length > this.maxSize) {
      this.entries.shift();
    }

    for (const subscriber of this.subscribers) {
      try {
        subscriber(fullEntry);
      } catch (_) {
        /* expected: subscriber errors must not break log buffering */
      }
    }

    return fullEntry;
  }

  debug(message: string, source = "server", data?: Record<string, unknown>): LogEntry {
    return this.append({ level: "debug", message, source, data });
  }

  info(message: string, source = "server", data?: Record<string, unknown>): LogEntry {
    return this.append({ level: "info", message, source, data });
  }

  warn(message: string, source = "server", data?: Record<string, unknown>): LogEntry {
    return this.append({ level: "warn", message, source, data });
  }

  error(message: string, source = "server", data?: Record<string, unknown>): LogEntry {
    return this.append({ level: "error", message, source, data });
  }

  query(filter?: LogFilter): LogEntry[] {
    if (!filter) return [...this.entries];

    let results = [...this.entries];

    if (filter.level) {
      const levels = Array.isArray(filter.level) ? filter.level : [filter.level];
      results = results.filter((e) => levels.includes(e.level));
    }

    if (filter.source) {
      const sources = Array.isArray(filter.source) ? filter.source : [filter.source];
      results = results.filter((e) => sources.includes(e.source));
    }

    if (filter.pattern) {
      const { pattern } = filter;

      if (typeof pattern === "string") {
        const lower = pattern.toLowerCase();
        results = results.filter((e) => e.message.toLowerCase().includes(lower));
      } else {
        results = results.filter((e) => pattern.test(e.message));
      }
    }

    if (filter.since != null) {
      results = results.filter((e) => e.timestamp >= filter.since!);
    }

    if (filter.limit != null) {
      results = results.slice(-filter.limit);
    }

    return results;
  }

  tail(count = 50): LogEntry[] {
    return this.entries.slice(-count);
  }

  getAll(): LogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }

  get count(): number {
    return this.entries.length;
  }

  countByLevel(): Record<LogLevel, number> {
    const counts: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };

    for (const entry of this.entries) {
      counts[entry.level]++;
    }

    return counts;
  }

  subscribe(callback: LogSubscriber): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  toJSON(): LogEntry[] {
    return this.getAll();
  }

  format(entries?: LogEntry[]): string {
    const logs = entries ?? this.entries;

    return logs
      .map((e) => {
        const time = new Date(e.timestamp).toISOString().slice(11, 23);
        const level = e.level.toUpperCase().padEnd(5);
        const source = e.source.padEnd(10);
        return `${time} ${level} [${source}] ${e.message}`;
      })
      .join("\n");
  }
}

let globalBuffer: LogBuffer | null = null;

export function getLogBuffer(): LogBuffer {
  globalBuffer ??= new LogBuffer();
  return globalBuffer;
}

export function resetLogBuffer(): void {
  globalBuffer?.clear();
  globalBuffer = null;
}

export function interceptConsole(buffer: LogBuffer, source = "console"): () => void {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  function formatArgs(...args: unknown[]): string {
    return args
      .map((a) => {
        if (typeof a === "string") return a;

        try {
          return JSON.stringify(a);
        } catch (_) {
          /* expected: circular references or non-serializable values */
          return String(a);
        }
      })
      .join(" ");
  }

  function wrap(
    method: keyof typeof original,
    log: (message: string, source: string) => LogEntry,
  ): (...args: unknown[]) => void {
    return (...args: unknown[]) => {
      log(formatArgs(...args), source);
      original[method].apply(console, args);
    };
  }

  console.log = wrap("log", buffer.info.bind(buffer));
  console.info = wrap("info", buffer.info.bind(buffer));
  console.warn = wrap("warn", buffer.warn.bind(buffer));
  console.error = wrap("error", buffer.error.bind(buffer));
  console.debug = wrap("debug", buffer.debug.bind(buffer));

  return () => {
    Object.assign(console, original);
  };
}
