import { dirname } from "veryfront/platform/path";
import { MAX_STRING_DISPLAY_LENGTH } from "#veryfront/utils/constants/index.ts";
import { MAX_FILE_LOG_FILES } from "#veryfront/utils/config-resource-limits.ts";
import { sanitizeUrlCredentials } from "#veryfront/utils/logger/redact.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import type { LogEntry, LogLevel, LogSubscriber } from "./log-buffer.ts";
import {
  MAX_FILE_LOG_PENDING_WRITES,
  MAX_FILE_LOG_RETAINED_FAILURES,
  MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH,
  MAX_OBSERVABILITY_NAME_LENGTH,
} from "./limits.ts";
import { sanitizeStructuredTelemetryData, sanitizeTelemetryText } from "./telemetry-error.ts";

/** Configuration used by file log. */
export interface FileLogConfig {
  enabled: boolean;
  path: string;
  maxSize: number | string;
  /** Total retained files, including the active log file. */
  maxFiles: number;
  level: LogLevel;
  format: "json" | "text";
}

interface FileLogFlushState {
  readonly owner: symbol;
  readonly queueGeneration: number;
  readonly result: Promise<void>;
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
  if (typeof value !== "string") {
    throw new TypeError("File log maxSize must be a number or string");
  }
  if (value.length > MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH) {
    throw new RangeError(
      `File log maxSize text must not exceed ${MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH} characters`,
    );
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
  if (entry === null || typeof entry !== "object") {
    throw new TypeError("File log entry must be an object");
  }
  if (!Object.hasOwn(LOG_LEVEL_PRIORITY, entry.level)) {
    throw new TypeError(`Invalid file log entry level: ${String(entry.level)}`);
  }
  if (
    typeof entry.id !== "string" || typeof entry.message !== "string" ||
    typeof entry.source !== "string"
  ) {
    throw new TypeError("File log entry id, message, and source must be strings");
  }
  if (
    typeof entry.timestamp !== "number" ||
    !Number.isFinite(new Date(entry.timestamp).getTime())
  ) {
    throw new RangeError("File log entry timestamp must be a valid date");
  }

  return {
    id: sanitizeTelemetryText(entry.id, MAX_OBSERVABILITY_NAME_LENGTH),
    level: entry.level,
    message: sanitizeTelemetryText(entry.message, MAX_STRING_DISPLAY_LENGTH),
    data: entry.data === undefined ? undefined : sanitizeStructuredTelemetryData(entry.data),
    timestamp: entry.timestamp,
    source: sanitizeTelemetryText(
      entry.source,
      MAX_OBSERVABILITY_NAME_LENGTH,
    ),
  };
}

function isPermissionDenied(error: unknown): boolean {
  try {
    if (error instanceof Deno.errors.PermissionDenied) return true;
    if (error instanceof AggregateError) {
      return error.errors.some((failure) => isPermissionDenied(failure));
    }
    return false;
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
  private pendingWrites = 0;
  private omittedFailureCount = 0;
  private queueGeneration = 0;
  private activeFlush: FileLogFlushState | null = null;
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
    if (config === null || typeof config !== "object") {
      throw new TypeError("File log config must be an object");
    }
    if (
      typeof config.path !== "string" || !config.path.trim() ||
      config.path.length > MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH
    ) {
      throw new TypeError(
        `File log path must contain between 1 and ${MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH} characters`,
      );
    }
    if (typeof config.enabled !== "boolean") {
      throw new TypeError("File log enabled must be a boolean");
    }
    if (
      !Number.isSafeInteger(config.maxFiles) ||
      config.maxFiles <= 0 ||
      config.maxFiles > MAX_FILE_LOG_FILES
    ) {
      throw new RangeError(
        `File log maxFiles must be an integer between 1 and ${MAX_FILE_LOG_FILES}`,
      );
    }
    if (!Object.hasOwn(LOG_LEVEL_PRIORITY, config.level)) {
      throw new TypeError(`Invalid file log level: ${String(config.level)}`);
    }
    if (config.format !== "json" && config.format !== "text") {
      throw new TypeError(`Invalid file log format: ${String(config.format)}`);
    }

    this.config = {
      enabled: config.enabled,
      path: config.path,
      maxSize: config.maxSize,
      maxFiles: config.maxFiles,
      level: config.level,
      format: config.format,
    };
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
          error,
        );
      }
    };
  }

  private enqueue(entry: LogEntry): void {
    if (this.pendingWrites >= MAX_FILE_LOG_PENDING_WRITES) {
      const error = new RangeError(
        `File log pending-write capacity of ${MAX_FILE_LOG_PENDING_WRITES} was reached`,
      );
      this.recordFailure(error);
      this.reportFailure(
        `FileLogSubscriber: dropped an entry for ${this.config.path} because the write queue reached capacity`,
        error,
      );
      return;
    }

    this.queueGeneration++;
    this.pendingWrites++;
    this.writeQueue = this.writeQueue
      .then(() => this.writeEntry(entry))
      .catch((error) => {
        this.recordFailure(error);
        if (this.disableForPermissionFailure(error)) {
          this.reportFailure(
            `FileLogSubscriber: permission denied writing to ${this.config.path}, file logging disabled`,
            error,
          );
        } else {
          this.reportFailure(
            `FileLogSubscriber: failed writing to ${this.config.path}, file logging will continue`,
            error,
          );
        }
      })
      .finally(() => {
        this.pendingWrites--;
      });
  }

  private recordFailure(error: unknown): void {
    if (this.pendingFailures.length < MAX_FILE_LOG_RETAINED_FAILURES) {
      this.pendingFailures.push(error);
    } else {
      this.omittedFailureCount++;
    }
  }

  private async writeEntry(entry: LogEntry): Promise<void> {
    try {
      if (this.permissionFailed) return;
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
      } catch (error) {
        this.disableForPermissionFailure(error);
        const recoveryFailure = await this.rollbackPartialRecord(file, recordStart);
        if (recoveryFailure !== undefined) {
          throw new AggregateError(
            [error, recoveryFailure],
            "File write failed and its partial record could not be rolled back",
          );
        }
        throw error;
      }
    } catch (error) {
      if (this.disableForPermissionFailure(error)) {
        this.closeCurrentFileQuietly();
        this.currentSize = 0;
      }
      throw error;
    }
  }

  private disableForPermissionFailure(error: unknown): boolean {
    if (!isPermissionDenied(error)) return false;
    this.permissionFailed = true;
    return true;
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

  private reportFailure(message: string, error?: unknown): void {
    if (this.reportingFailure) return;
    this.reportingFailure = true;
    try {
      const normalizedError = error === undefined
        ? undefined
        : error instanceof Error
        ? error
        : new Error(describeFailure(error));
      serverLogger.error(
        sanitizeUrlCredentials(message),
        ...(normalizedError ? [{ error: normalizedError }] : []),
      );
    } catch {
      // Diagnostics must never break the logging queue or application code.
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

  flush(): Promise<void> {
    const queueGeneration = this.queueGeneration;
    const activeFlush = this.activeFlush;
    if (activeFlush?.queueGeneration === queueGeneration) return activeFlush.result;

    const queueSnapshot = this.writeQueue;
    const attempt = this.performFlush(queueSnapshot);
    const owner = Symbol("file-log-flush");
    const result = attempt.then(
      () => {
        if (this.activeFlush?.owner === owner) this.activeFlush = null;
      },
      (error) => {
        if (this.activeFlush?.owner === owner) this.activeFlush = null;
        throw error;
      },
    );
    const barrier = result.catch(() => undefined);
    const flushState = { owner, queueGeneration, result };
    this.activeFlush = flushState;
    // Writes accepted after this call wait for its durability sync. A later
    // flush therefore captures a distinct queue snapshot instead of resolving
    // with an older in-flight flush.
    this.writeQueue = barrier;
    return result;
  }

  private async performFlush(queueSnapshot: Promise<void>): Promise<void> {
    const failures: unknown[] = [];
    try {
      await queueSnapshot;
    } catch (error) {
      // Defensive compatibility for an already-rejected queue created by an
      // older owner or an injected adapter.
      failures.push(error);
    }
    failures.push(...this.pendingFailures.splice(0));
    if (this.omittedFailureCount > 0) {
      failures.push(
        new Error(
          `${this.omittedFailureCount} additional file-log failures were omitted`,
        ),
      );
      this.omittedFailureCount = 0;
    }
    if (this.file) {
      try {
        await this.file.sync();
      } catch (error) {
        this.disableForPermissionFailure(error);
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
    const trackedClose = closeAttempt.catch((error) => {
      this.closePromise = null;
      throw error;
    });
    this.closePromise = trackedClose;
    return await trackedClose;
  }

  private throwFailures(failures: readonly unknown[], message: string): void {
    if (failures.length === 0) return;
    if (failures.length === 1) throw failures[0];
    throw new AggregateError(failures, message);
  }
}

Object.freeze(FileLogSubscriber.prototype);

/** Create file log subscriber. */
export function createFileLogSubscriber(config: FileLogConfig): FileLogSubscriber {
  return new FileLogSubscriber(config);
}
