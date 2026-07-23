import { dirname } from "@std/path";
import { sanitizeUrlCredentials } from "#veryfront/utils/logger/redact.ts";
import type { LogEntry, LogLevel, LogSubscriber } from "./log-buffer.ts";
import { sanitizeStructuredTelemetryData } from "./telemetry-error.ts";

/** Configuration used by file log. */
export interface FileLogConfig {
  enabled: boolean;
  path: string;
  maxSize: number | string;
  maxFiles: number;
  level: LogLevel;
  format: "json" | "text";
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
};

/** Parses max size. */
export function parseMaxSize(value: number | string): number {
  if (typeof value === "number") {
    const bytes = Math.floor(value);
    if (!Number.isFinite(value) || bytes <= 0) {
      throw new RangeError("File log maxSize must be a positive finite number");
    }
    return bytes;
  }

  const match = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);
  if (!match?.[1]) {
    throw new Error(`Invalid maxSize value: "${value}". Expected a number or string like "10mb".`);
  }

  const num = parseFloat(match[1]);
  const unit = match[2] ?? "b";
  const bytes = Math.floor(num * (SIZE_UNITS[unit] ?? 1));
  if (!Number.isFinite(bytes) || bytes <= 0) {
    throw new RangeError("File log maxSize must be a positive finite number");
  }
  return bytes;
}

function formatEntryText(entry: LogEntry): string {
  const time = new Date(entry.timestamp).toISOString();
  const level = entry.level.toUpperCase().padEnd(5);
  const data = entry.data ? ` ${safeJsonStringify(entry.data)}` : "";
  return `${time} ${level} [${entry.source}] ${entry.message}${data}`;
}

function formatEntryJson(entry: LogEntry): string {
  return safeJsonStringify(entry);
}

function safeJsonStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, child) => typeof child === "bigint" ? child.toString() : child,
  ) ?? "";
}

function sanitizeEntry(entry: LogEntry): LogEntry {
  return {
    ...entry,
    message: sanitizeUrlCredentials(entry.message),
    source: sanitizeUrlCredentials(entry.source),
    data: entry.data ? sanitizeStructuredTelemetryData(entry.data) : entry.data,
  };
}

function isPermissionDenied(error: unknown): boolean {
  try {
    return error instanceof Deno.errors.PermissionDenied;
  } catch (_) {
    return false;
  }
}

function describeFailure(error: unknown): string {
  try {
    if (error instanceof Error && typeof error.message === "string") return error.message;
  } catch (_) {
    // Fall through to the guarded string conversion.
  }
  try {
    return String(error);
  } catch (_) {
    return "Unknown file logging failure";
  }
}

/** Writes every byte, including when the underlying writer makes partial progress. */
export async function writeAll(
  writer: { write(bytes: Uint8Array): Promise<number> },
  bytes: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const remaining = bytes.subarray(offset);
    const written = await writer.write(remaining);
    if (!Number.isSafeInteger(written) || written <= 0 || written > remaining.length) {
      if (written === 0) {
        throw new Error("File write made zero bytes of progress");
      }
      throw new Error(`File write returned an invalid byte count: ${written}`);
    }
    offset += written;
  }
}

/** Implement file log subscriber. */
export class FileLogSubscriber {
  private file: Deno.FsFile | null = null;
  private currentSize = 0;
  private writeQueue: Promise<void> = Promise.resolve();
  private pendingFailures: unknown[] = [];
  private closePromise: Promise<void> | null = null;
  private maxSizeBytes: number;
  private minLevel: number;
  private formatter: (entry: LogEntry) => string;
  private closed = false;
  private permissionFailed = false;
  private reportingFailure = false;
  private config: FileLogConfig;
  private readonly encoder = new TextEncoder();

  constructor(config: FileLogConfig) {
    if (!config.path.trim()) {
      throw new TypeError("File log path must not be empty");
    }
    if (!Number.isSafeInteger(config.maxFiles) || config.maxFiles <= 0) {
      throw new RangeError("File log maxFiles must be a positive integer");
    }
    if (!(config.level in LOG_LEVEL_PRIORITY)) {
      throw new TypeError(`Invalid file log level: ${String(config.level)}`);
    }
    if (config.format !== "json" && config.format !== "text") {
      throw new TypeError(`Invalid file log format: ${String(config.format)}`);
    }

    this.config = { ...config };
    this.maxSizeBytes = parseMaxSize(this.config.maxSize);
    this.minLevel = LOG_LEVEL_PRIORITY[this.config.level];
    this.formatter = this.config.format === "json" ? formatEntryJson : formatEntryText;
  }

  getSubscriber(): LogSubscriber {
    return (entry: LogEntry) => {
      try {
        if (
          !this.config.enabled || this.closed || this.permissionFailed || this.reportingFailure
        ) return;
        if (LOG_LEVEL_PRIORITY[entry.level] < this.minLevel) return;
        this.enqueue(sanitizeEntry(entry));
      } catch (error) {
        this.reportFailure(
          `[FileLogSubscriber] Failed to accept a log entry for ${this.config.path}.`,
          describeFailure(error),
        );
      }
    };
  }

  private enqueue(entry: LogEntry): void {
    this.writeQueue = this.writeQueue.then(() => this.writeEntry(entry)).catch((error) => {
      this.pendingFailures.push(error);
      this.reportFailure(
        `[FileLogSubscriber] Failed writing to ${this.config.path}. File logging will continue.`,
        describeFailure(error),
      );
    });
  }

  private async writeEntry(entry: LogEntry): Promise<void> {
    if (!this.file) await this.openFile();

    const line = this.formatter(entry) + "\n";
    const bytes = this.encoder.encode(line);

    if (this.currentSize + bytes.length > this.maxSizeBytes) {
      await this.rotate();
    }

    const file = this.file!;
    const recordStart = this.currentSize;
    try {
      await writeAll(file, bytes);
      this.currentSize += bytes.length;
    } catch (err) {
      const recoveryFailure = await this.rollbackPartialRecord(file, recordStart);
      if (isPermissionDenied(err)) {
        this.permissionFailed = true;
        this.reportFailure(
          `[FileLogSubscriber] Permission denied writing to ${this.config.path}. File logging disabled.`,
        );
      }
      if (recoveryFailure !== undefined) {
        throw new AggregateError(
          [err, recoveryFailure],
          "File write failed and its partial record could not be rolled back",
        );
      }
      throw err;
    }
  }

  private async rollbackPartialRecord(
    file: Deno.FsFile,
    recordStart: number,
  ): Promise<unknown | undefined> {
    try {
      await file.truncate(recordStart);
      await file.seek(0, Deno.SeekMode.End);
      this.currentSize = recordStart;
      return undefined;
    } catch (error) {
      this.closeCurrentFileQuietly();
      this.currentSize = 0;
      return error;
    }
  }

  private async openFile(): Promise<void> {
    await this.ensureDir();
    this.file = await Deno.open(this.config.path, {
      write: true,
      create: true,
      append: true,
    });
    try {
      const stat = await this.file.stat();
      this.currentSize = stat.size;
    } catch (error) {
      this.closeCurrentFileQuietly();
      throw error;
    }
  }

  private async ensureDir(): Promise<void> {
    const dir = dirname(this.config.path);
    if (dir !== ".") {
      await Deno.mkdir(dir, { recursive: true });
    }
  }

  private reportFailure(message: string, detail?: string): void {
    if (this.reportingFailure) return;
    this.reportingFailure = true;
    try {
      try {
        console.error(
          sanitizeUrlCredentials(message),
          detail === undefined ? undefined : sanitizeUrlCredentials(detail),
        );
      } catch {
        // Diagnostics must never break the logging queue or application code.
      }
    } finally {
      this.reportingFailure = false;
    }
  }

  private closeCurrentFile(): void {
    const file = this.file;
    this.file = null;
    if (!file) return;
    file.close();
  }

  private closeCurrentFileQuietly(): void {
    try {
      this.closeCurrentFile();
    } catch (_) {
      /* expected: recovery retains the primary I/O failure */
    }
  }

  private closeCurrentFileForShutdown(): void {
    const file = this.file;
    if (!file) return;
    // A failed shutdown close is retryable, so retain ownership until close succeeds.
    file.close();
    if (this.file === file) this.file = null;
  }

  private async rotate(): Promise<void> {
    this.closeCurrentFile();

    for (let i = this.config.maxFiles - 1; i >= 1; i--) {
      const from = i === 1 ? this.config.path : `${this.config.path}.${i - 1}`;
      const to = `${this.config.path}.${i}`;
      try {
        await Deno.rename(from, to);
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) throw err;
      }
    }

    if (this.config.maxFiles <= 1) {
      try {
        await Deno.remove(this.config.path);
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) throw err;
      }
    }

    this.file = await Deno.open(this.config.path, {
      write: true,
      create: true,
      truncate: true,
    });
    this.currentSize = 0;
  }

  async flush(): Promise<void> {
    const failures: unknown[] = [];
    try {
      await this.writeQueue;
    } catch (error) {
      // Defensive compatibility for an already-rejected queue created by an
      // older owner or an injected adapter.
      failures.push(error);
    }
    failures.push(...this.pendingFailures.splice(0));
    if (this.file) {
      try {
        await this.file.sync();
      } catch (error) {
        failures.push(error);
      }
    }
    this.throwFailures(failures, "File log flush failed");
  }

  async close(): Promise<void> {
    if (this.closePromise) return await this.closePromise;
    this.closed = true;
    const closeAttempt = (async () => {
      const failures: unknown[] = [];
      try {
        await this.flush();
      } catch (error) {
        failures.push(error);
      }
      try {
        this.closeCurrentFileForShutdown();
      } catch (error) {
        failures.push(error);
      }
      this.throwFailures(failures, "File log close failed");
    })();
    this.closePromise = closeAttempt;

    try {
      return await closeAttempt;
    } catch (error) {
      if (this.closePromise === closeAttempt) this.closePromise = null;
      throw error;
    }
  }

  private throwFailures(failures: readonly unknown[], message: string): void {
    if (failures.length === 0) return;
    if (failures.length === 1) throw failures[0];
    throw new AggregateError(failures, message);
  }
}

/** Create file log subscriber. */
export function createFileLogSubscriber(config: FileLogConfig): FileLogSubscriber {
  return new FileLogSubscriber(config);
}
