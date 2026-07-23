import { createSubscriberSet } from "#veryfront/utils/subscriber-set.ts";
import { sanitizeUrlCredentials } from "#veryfront/utils/logger/redact.ts";
import { sanitizeStructuredTelemetryData } from "./telemetry-error.ts";

/** Public API contract for log level. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Entry shape for log. */
export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
  source: string;
}
/** Filter options for reading buffered log entries. */
export interface LogFilter {
  level?: LogLevel | LogLevel[];
  source?: string | string[];
  pattern?: string | RegExp;
  since?: number;
  limit?: number;
}

/** Public API contract for log subscriber. */
export type LogSubscriber = (entry: LogEntry) => void;

function snapshotEntry(entry: LogEntry): LogEntry {
  return {
    ...entry,
    data: entry.data ? sanitizeStructuredTelemetryData(entry.data) : entry.data,
  };
}

/** Implement log buffer. */
export class LogBuffer {
  private entries: LogEntry[] = [];
  private subscribers = createSubscriberSet<[LogEntry]>();
  private idCounter = 0;
  private maxSize: number;

  constructor(options: { maxSize?: number } = {}) {
    const maxSize = options.maxSize ?? 1000;
    if (!Number.isSafeInteger(maxSize) || maxSize < 0) {
      throw new RangeError("LogBuffer maxSize must be a non-negative integer");
    }
    this.maxSize = maxSize;
  }

  private generateId(): string {
    return `log_${Date.now()}_${++this.idCounter}`;
  }

  append(entry: Omit<LogEntry, "id" | "timestamp">): LogEntry {
    const fullEntry: LogEntry = {
      ...entry,
      // Redact credential-like keys before the entry is buffered, surfaced to
      // subscribers, or written to disk by the file subscriber (#1989).
      data: entry.data ? sanitizeStructuredTelemetryData(entry.data) : entry.data,
      message: sanitizeUrlCredentials(entry.message),
      source: sanitizeUrlCredentials(entry.source),
      id: this.generateId(),
      timestamp: Date.now(),
    };

    this.entries.push(fullEntry);

    while (this.entries.length > this.maxSize) {
      this.entries.shift();
    }

    this.subscribers.notify(fullEntry);

    return snapshotEntry(fullEntry);
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
    if (!filter) return this.getAll();

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
        const initialLastIndex = pattern.lastIndex;
        try {
          results = results.filter((e) => {
            pattern.lastIndex = 0;
            return pattern.test(e.message);
          });
        } finally {
          pattern.lastIndex = initialLastIndex;
        }
      }
    }

    if (filter.since != null) {
      results = results.filter((e) => e.timestamp >= filter.since!);
    }

    if (filter.limit != null) {
      const limit = Number.isFinite(filter.limit) ? Math.max(0, Math.floor(filter.limit)) : 0;
      results = limit === 0 ? [] : results.slice(-limit);
    }

    return results.map(snapshotEntry);
  }

  tail(count = 50): LogEntry[] {
    const normalizedCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    return normalizedCount === 0 ? [] : this.entries.slice(-normalizedCount).map(snapshotEntry);
  }

  getAll(): LogEntry[] {
    return this.entries.map(snapshotEntry);
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
    return this.subscribers.subscribe((entry) => callback(snapshotEntry(entry)));
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

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug";
type ConsoleFunction = (...args: unknown[]) => void;

interface ConsoleInterceptOwner {
  readonly generation: number;
  active: boolean;
}

interface ConsoleWrapperMetadata {
  readonly owner: ConsoleInterceptOwner;
  readonly previous: ConsoleFunction;
}

let consoleInterceptGeneration = 0;
const consoleWrapperMetadata = new WeakMap<ConsoleFunction, ConsoleWrapperMetadata>();

function resolveLiveConsoleFunction(candidate: ConsoleFunction): ConsoleFunction {
  let current = candidate;
  const seen = new Set<ConsoleFunction>();
  while (!seen.has(current)) {
    seen.add(current);
    const metadata = consoleWrapperMetadata.get(current);
    if (!metadata || metadata.owner.active) return current;
    current = metadata.previous;
  }
  return candidate;
}

/** Return log buffer. */
export function getLogBuffer(): LogBuffer {
  globalBuffer ??= new LogBuffer();
  return globalBuffer;
}

/** Reset the in-memory log buffer. */
export function resetLogBuffer(): void {
  globalBuffer?.clear();
  globalBuffer = null;
}

/** Capture console output in the log buffer. */
export function interceptConsole(buffer: LogBuffer, source = "console"): () => void {
  const previous: Record<ConsoleMethod, ConsoleFunction> = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  const owner: ConsoleInterceptOwner = {
    generation: ++consoleInterceptGeneration,
    active: true,
  };

  function formatArgs(...args: unknown[]): string {
    return args
      .map((a) => {
        if (typeof a === "string") return a;

        try {
          // Redact object args before they are folded into the message string,
          // where the per-entry data redaction can no longer reach them (#1989).
          return JSON.stringify(sanitizeStructuredTelemetryData(a));
        } catch (_) {
          /* expected: circular references or non-serializable values */
          try {
            return String(a);
          } catch (_) {
            return "[Unserializable]";
          }
        }
      })
      .join(" ");
  }

  function wrap(
    method: ConsoleMethod,
    log: (message: string, source: string) => LogEntry,
  ): ConsoleFunction {
    const wrapper: ConsoleFunction = (...args: unknown[]) => {
      if (owner.active) {
        try {
          log(formatArgs(...args), source);
        } catch (_) {
          /* expected: interception must never block the underlying console */
        }
      }
      Reflect.apply(resolveLiveConsoleFunction(previous[method]), console, args);
    };
    consoleWrapperMetadata.set(wrapper, { owner, previous: previous[method] });
    return wrapper;
  }

  const wrappers: Record<ConsoleMethod, ConsoleFunction> = {
    log: wrap("log", buffer.info.bind(buffer)),
    info: wrap("info", buffer.info.bind(buffer)),
    warn: wrap("warn", buffer.warn.bind(buffer)),
    error: wrap("error", buffer.error.bind(buffer)),
    debug: wrap("debug", buffer.debug.bind(buffer)),
  };

  console.log = wrappers.log;
  console.info = wrappers.info;
  console.warn = wrappers.warn;
  console.error = wrappers.error;
  console.debug = wrappers.debug;

  return () => {
    if (!owner.active) return;
    owner.active = false;
    for (const method of Object.keys(wrappers) as ConsoleMethod[]) {
      if (console[method] !== wrappers[method]) continue;
      console[method] = resolveLiveConsoleFunction(previous[method]);
    }
  };
}
