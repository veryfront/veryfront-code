import { redactSensitive } from "#veryfront/utils/logger/redact.ts";
import { sanitizeErrorText } from "#veryfront/errors/sanitization.ts";

const MAX_BUFFER_SIZE = 100_000;
const MAX_LOG_MESSAGE_LENGTH = 16_384;
const MAX_LOG_SOURCE_LENGTH = 128;

/** Public API contract for log level. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Entry shape for log. */
export interface LogEntry {
  /** Process-local entry identifier. */
  id: string;
  /** Severity assigned to the entry. */
  level: LogLevel;
  /** Sanitized human-readable message. */
  message: string;
  /** Optional sanitized structured data. */
  data?: Record<string, unknown>;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
  /** Bounded code-owned source label. */
  source: string;
}
/** Filter options for reading buffered log entries. */
export interface LogFilter {
  /** Include one or more severity levels. */
  level?: LogLevel | LogLevel[];
  /** Include one or more exact source labels. */
  source?: string | string[];
  /** Match entry messages by substring or regular expression. */
  pattern?: string | RegExp;
  /** Include entries captured at or after this Unix timestamp in milliseconds. */
  since?: number;
  /** Maximum number of entries returned. */
  limit?: number;
}

/** Public API contract for log subscriber. */
export type LogSubscriber = (entry: LogEntry) => void;

/** Store bounded, sanitized in-process log snapshots. */
export class LogBuffer {
  private entries: LogEntry[] = [];
  private subscribers = new Set<LogSubscriber>();
  private idCounter = 0;
  private maxSize: number;

  /** Create a buffer with an optional bounded retention limit. */
  constructor(options: { maxSize?: number } = {}) {
    const maxSize = options.maxSize ?? 1000;
    if (!Number.isSafeInteger(maxSize) || maxSize <= 0 || maxSize > MAX_BUFFER_SIZE) {
      throw new TypeError(`maxSize must be a positive safe integer up to ${MAX_BUFFER_SIZE}`);
    }
    this.maxSize = maxSize;
  }

  /** Create a process-local identifier for a buffered entry. */
  private generateId(): string {
    return `log_${Date.now()}_${++this.idCounter}`;
  }

  /** Sanitize, snapshot, and append one log entry. */
  append(entry: Omit<LogEntry, "id" | "timestamp">): LogEntry {
    if (!entry || typeof entry !== "object" || !Object.hasOwn(LOG_LEVEL_SET, entry.level)) {
      throw new TypeError("level must be debug, info, warn, or error");
    }
    if (typeof entry.message !== "string" || typeof entry.source !== "string") {
      throw new TypeError("message and source must be strings");
    }
    const data = sanitizeLogData(entry.data);
    const fullEntry: LogEntry = {
      // Redact credential-like keys before the entry is buffered, surfaced to
      // subscribers, or written to disk by the file subscriber (#1989).
      ...(data ? { data } : {}),
      level: entry.level,
      message: sanitizeLogText(entry.message, MAX_LOG_MESSAGE_LENGTH),
      source: sanitizeLogText(entry.source, MAX_LOG_SOURCE_LENGTH),
      id: this.generateId(),
      timestamp: Date.now(),
    };

    this.entries.push(fullEntry);

    while (this.entries.length > this.maxSize) {
      this.entries.shift();
    }

    for (const subscriber of this.subscribers) {
      try {
        subscriber(cloneEntry(fullEntry));
      } catch (_) {
        /* expected: subscriber errors must not break log buffering */
      }
    }

    return cloneEntry(fullEntry);
  }

  /** Append a debug entry. */
  debug(message: string, source = "server", data?: Record<string, unknown>): LogEntry {
    return this.append({ level: "debug", message, source, data });
  }

  /** Append an informational entry. */
  info(message: string, source = "server", data?: Record<string, unknown>): LogEntry {
    return this.append({ level: "info", message, source, data });
  }

  /** Append a warning entry. */
  warn(message: string, source = "server", data?: Record<string, unknown>): LogEntry {
    return this.append({ level: "warn", message, source, data });
  }

  /** Append an error entry. */
  error(message: string, source = "server", data?: Record<string, unknown>): LogEntry {
    return this.append({ level: "error", message, source, data });
  }

  /** Return sanitized entry snapshots matching an optional filter. */
  query(filter?: LogFilter): LogEntry[] {
    if (!filter) return this.entries.map(cloneEntry);

    validateReadLimit(filter.limit, "limit");

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
        let matcher: RegExp;
        try {
          matcher = new RegExp(pattern.source, pattern.flags);
        } catch {
          return [];
        }
        results = results.filter((e) => {
          matcher.lastIndex = 0;
          return matcher.test(e.message);
        });
      }
    }

    if (filter.since != null) {
      const since = filter.since;
      results = results.filter((e) => e.timestamp >= since);
    }

    if (filter.limit != null) {
      results = results.slice(-filter.limit);
    }

    return results.map(cloneEntry);
  }

  /** Return the most recent entry snapshots. */
  tail(count = 50): LogEntry[] {
    validateReadLimit(count, "count");
    return this.entries.slice(-count).map(cloneEntry);
  }

  /** Return snapshots of all retained entries. */
  getAll(): LogEntry[] {
    return this.entries.map(cloneEntry);
  }

  /** Remove every retained entry. */
  clear(): void {
    this.entries = [];
  }

  /** Number of retained entries. */
  get count(): number {
    return this.entries.length;
  }

  /** Count retained entries by severity. */
  countByLevel(): Record<LogLevel, number> {
    const counts: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };

    for (const entry of this.entries) {
      counts[entry.level]++;
    }

    return counts;
  }

  /** Subscribe to snapshots of newly appended entries. */
  subscribe(callback: LogSubscriber): () => void {
    if (typeof callback !== "function") throw new TypeError("subscriber must be a function");
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /** Serialize retained entries as sanitized snapshots. */
  toJSON(): LogEntry[] {
    return this.getAll();
  }

  /** Format entries as bounded human-readable lines. */
  format(entries?: LogEntry[]): string {
    const logs = entries ?? this.entries;

    return logs
      .map((e) => {
        const timestamp = isValidTimestamp(e.timestamp) ? e.timestamp : 0;
        const time = new Date(timestamp).toISOString().slice(11, 23);
        const level = Object.hasOwn(LOG_LEVEL_SET, e.level) ? e.level : "info";
        const source = sanitizeLogText(
          typeof e.source === "string" ? e.source : "unknown",
          MAX_LOG_SOURCE_LENGTH,
        ).padEnd(10);
        const message = sanitizeLogText(
          typeof e.message === "string" ? e.message : "",
          MAX_LOG_MESSAGE_LENGTH,
        );
        return `${time} ${level.toUpperCase().padEnd(5)} [${source}] ${message}`;
      })
      .join("\n");
  }
}

const LOG_LEVEL_SET: Record<LogLevel, true> = {
  debug: true,
  info: true,
  warn: true,
  error: true,
};

function sanitizeLogText(value: string, maxLength: number): string {
  return sanitizeErrorText(value, maxLength).replace(/[\r\n]/g, " ");
}

function cloneEntry(entry: LogEntry): LogEntry {
  const data = sanitizeLogData(entry.data);
  return {
    id: entry.id,
    level: entry.level,
    message: entry.message,
    source: entry.source,
    timestamp: entry.timestamp,
    ...(data ? { data } : {}),
  };
}

function sanitizeLogData(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
    const sanitized = redactSensitive(value);
    return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
      ? sanitized as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 &&
    value <= 8_640_000_000_000_000;
}

function validateReadLimit(value: number | undefined, name: string): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_BUFFER_SIZE) {
    throw new TypeError(`${name} must be a non-negative safe integer up to ${MAX_BUFFER_SIZE}`);
  }
}

let globalBuffer: LogBuffer | null = null;

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
  let active = true;
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
        if (typeof a === "string") return sanitizeLogText(a, MAX_LOG_MESSAGE_LENGTH);

        try {
          // Redact object args before they are folded into the message string,
          // where the per-entry data redaction can no longer reach them (#1989).
          return JSON.stringify(redactSensitive(a)) ?? "[Unserializable]";
        } catch (_) {
          /* expected: circular references or non-serializable values */
          return "[Unserializable]";
        }
      })
      .join(" ");
  }

  function wrap(
    method: keyof typeof original,
    log: (message: string, source: string) => LogEntry,
  ): (...args: unknown[]) => void {
    return (...args: unknown[]) => {
      if (active) {
        try {
          log(formatArgs(...args), source);
        } catch {
          // Buffering must not suppress the original console call.
        }
      }
      original[method].apply(console, args);
    };
  }

  const installed = {
    log: wrap("log", buffer.info.bind(buffer)),
    info: wrap("info", buffer.info.bind(buffer)),
    warn: wrap("warn", buffer.warn.bind(buffer)),
    error: wrap("error", buffer.error.bind(buffer)),
    debug: wrap("debug", buffer.debug.bind(buffer)),
  };

  console.log = installed.log;
  console.info = installed.info;
  console.warn = installed.warn;
  console.error = installed.error;
  console.debug = installed.debug;

  return () => {
    active = false;
    for (const method of Object.keys(original) as (keyof typeof original)[]) {
      if (console[method] === installed[method]) console[method] = original[method];
    }
  };
}
