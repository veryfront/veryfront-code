import { dirname } from "#veryfront/platform/compat/path/basic-operations.ts";
import { sanitizeErrorContext, sanitizeErrorText } from "#veryfront/errors/sanitization.ts";
import { type FileHandle, mkdir, open, rename, rm, stat } from "node:fs/promises";
import type { LogEntry, LogLevel, LogSubscriber } from "./log-buffer.ts";
import { classifyTelemetryError } from "./telemetry-safety.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

/** Configuration used by file log. */
export interface FileLogConfig {
  /** Whether file logging accepts new entries. */
  enabled: boolean;
  /** Destination file path. */
  path: string;
  /** Rotation threshold in bytes or as a size string. */
  maxSize: number | string;
  /** Maximum number of current and rotated files retained. */
  maxFiles: number;
  /** Minimum severity written to disk. */
  level: LogLevel;
  /** On-disk entry encoding. */
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

const MAX_FILE_SIZE_BYTES = 1024 ** 4;
const MAX_ROTATED_FILES = 100;
const MAX_PENDING_WRITES = 1_024;
const MAX_ENTRY_BYTES = 1024 * 1024;

/** Parse and validate a file rotation size. */
export function parseMaxSize(value: number | string): number {
  let bytes: number;
  if (typeof value === "number") {
    bytes = value;
  } else if (typeof value === "string" && value.length <= 64) {
    const match = value.trim().toLowerCase().match(/^([0-9]+(?:\.[0-9]+)?)\s*(b|kb|mb|gb)?$/);
    if (!match?.[1]) {
      throw new Error("Invalid maxSize value. Expected a number or size string.");
    }
    bytes = Math.floor(Number(match[1]) * (SIZE_UNITS[match[2] ?? "b"] ?? 1));
  } else {
    throw new Error("Invalid maxSize value. Expected a number or size string.");
  }

  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `Invalid maxSize value. Expected a positive safe size up to ${MAX_FILE_SIZE_BYTES} bytes.`,
    );
  }
  return bytes;
}

function sanitizeEntry(entry: LogEntry): LogEntry {
  const data = entry.data ? sanitizeErrorContext(entry.data) : undefined;
  return {
    id: sanitizeErrorText(typeof entry.id === "string" ? entry.id : "log", 128),
    level: entry.level,
    message: sanitizeErrorText(typeof entry.message === "string" ? entry.message : "", 16_384),
    source: sanitizeErrorText(typeof entry.source === "string" ? entry.source : "unknown", 128),
    timestamp: Number.isSafeInteger(entry.timestamp) && entry.timestamp >= 0 &&
        entry.timestamp <= 8_640_000_000_000_000
      ? entry.timestamp
      : Date.now(),
    ...(data ? { data } : {}),
  };
}

function formatEntryText(entry: LogEntry): string {
  const time = new Date(entry.timestamp).toISOString();
  const level = entry.level.toUpperCase().padEnd(5);
  const data = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
  return `${time} ${level} [${entry.source}] ${entry.message}${data}`;
}

function formatEntryJson(entry: LogEntry): string {
  return JSON.stringify(entry);
}

function isErrorCode(error: unknown, code: string): boolean {
  try {
    return !!error && typeof error === "object" &&
      (error as { code?: unknown }).code === code;
  } catch {
    return false;
  }
}

function hasErrorName(error: unknown, names: readonly string[]): boolean {
  try {
    return !!error && typeof error === "object" &&
      names.includes((error as { name?: unknown }).name as string);
  } catch {
    return false;
  }
}

function isNotFound(error: unknown): boolean {
  return isErrorCode(error, "ENOENT") || hasErrorName(error, ["NotFound"]);
}

function isPermissionDenied(error: unknown): boolean {
  return isErrorCode(error, "EACCES") || isErrorCode(error, "EPERM") ||
    hasErrorName(error, ["NotCapable", "PermissionDenied"]);
}

/** Write every byte, including on runtimes that return partial writes. */
async function writeAll(file: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset, null);
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) {
      throw new Error("File log write made no progress");
    }
    offset += bytesWritten;
  }
}

/** Persist buffered log entries with bounded asynchronous rotation. */
export class FileLogSubscriber {
  private file: FileHandle | null = null;
  private currentSize = 0;
  private writeQueue: Promise<void> = Promise.resolve();
  private pendingWrites = 0;
  private readonly maxSizeBytes: number;
  private readonly minLevel: number;
  private readonly formatter: (entry: LogEntry) => string;
  private closed = false;
  private permissionFailed = false;
  private closePromise: Promise<void> | null = null;
  private queueWarningReported = false;
  private writeFailureReported = false;
  private reportingFailure = false;
  private readonly config: Readonly<FileLogConfig>;
  private readonly encoder = new TextEncoder();

  /** Validate and snapshot a file-log configuration. */
  constructor(config: FileLogConfig) {
    if (typeof config.enabled !== "boolean") throw new TypeError("enabled must be a boolean");
    if (
      typeof config.path !== "string" || config.path.length === 0 || config.path.length > 4_096 ||
      hasUnsafeControlCharacters(config.path)
    ) {
      throw new TypeError("path must be a non-empty file path up to 4096 characters");
    }
    if (
      !Number.isSafeInteger(config.maxFiles) || config.maxFiles <= 0 ||
      config.maxFiles > MAX_ROTATED_FILES
    ) {
      throw new TypeError(
        `maxFiles must be a positive safe integer up to ${MAX_ROTATED_FILES}`,
      );
    }
    if (!Object.hasOwn(LOG_LEVEL_PRIORITY, config.level)) {
      throw new TypeError("level must be debug, info, warn, or error");
    }
    if (config.format !== "json" && config.format !== "text") {
      throw new TypeError("format must be json or text");
    }

    this.config = Object.freeze({ ...config });
    this.maxSizeBytes = parseMaxSize(config.maxSize);
    this.minLevel = LOG_LEVEL_PRIORITY[config.level];
    this.formatter = config.format === "json" ? formatEntryJson : formatEntryText;
  }

  /** Return the callback used to receive buffered log entries. */
  getSubscriber(): LogSubscriber {
    return (entry: LogEntry) => {
      if (!this.config.enabled || this.closed || this.permissionFailed || this.reportingFailure) {
        return;
      }
      if (!Object.hasOwn(LOG_LEVEL_PRIORITY, entry.level)) return;
      if (LOG_LEVEL_PRIORITY[entry.level] < this.minLevel) return;
      this.enqueue(sanitizeEntry(entry));
    };
  }

  /** Queue a bounded asynchronous write or drop it when the queue is full. */
  private enqueue(entry: LogEntry): void {
    if (this.pendingWrites >= MAX_PENDING_WRITES) {
      if (!this.queueWarningReported) {
        this.queueWarningReported = true;
        this.reportFailure("[FileLogSubscriber] File log queue is full. New entries are dropped.");
      }
      return;
    }

    this.pendingWrites++;
    this.writeQueue = this.writeQueue
      .then(() => this.writeEntry(entry))
      .catch((error) => {
        if (!this.writeFailureReported) {
          this.writeFailureReported = true;
          this.reportFailure(
            "[FileLogSubscriber] File write failed. File logging will continue.",
            error,
          );
        }
      })
      .finally(() => {
        this.pendingWrites--;
      });
  }

  /** Report a classified sink failure without recursing into this subscriber. */
  private reportFailure(message: string, error?: unknown): void {
    if (this.reportingFailure) return;
    this.reportingFailure = true;
    try {
      if (error === undefined) console.error(message);
      else console.error(message, { failure_category: classifyTelemetryError(error) });
    } catch {
      // A diagnostic sink failure must not affect application logging.
    } finally {
      this.reportingFailure = false;
    }
  }

  /** Encode one entry and bound its serialized size. */
  private encodeEntry(entry: LogEntry): Uint8Array {
    let line = this.formatter(entry) + "\n";
    let bytes = this.encoder.encode(line);
    if (bytes.length <= MAX_ENTRY_BYTES) return bytes;

    const boundedEntry: LogEntry = {
      ...entry,
      message: `${entry.message.slice(0, 8_192)}[TRUNCATED]`,
      data: { truncated: true },
    };
    line = this.formatter(boundedEntry) + "\n";
    bytes = this.encoder.encode(line);
    return bytes;
  }

  /** Persist one entry, rotating the destination when required. */
  private async writeEntry(entry: LogEntry): Promise<void> {
    if (this.permissionFailed) return;
    try {
      if (!this.file) await this.openFile();

      const bytes = this.encodeEntry(entry);
      if (this.currentSize > 0 && this.currentSize + bytes.length > this.maxSizeBytes) {
        await this.rotate();
      }

      if (!this.file) throw new Error("File log is not open");
      await writeAll(this.file, bytes);
      this.currentSize += bytes.length;
      this.writeFailureReported = false;
    } catch (error) {
      if (isPermissionDenied(error)) {
        this.permissionFailed = true;
        this.reportFailure(
          "[FileLogSubscriber] File permission denied. File logging disabled.",
        );
        return;
      }
      throw error;
    }
  }

  /** Open the destination for append and load its current size. */
  private async openFile(): Promise<void> {
    await this.ensureDir();
    this.file = await open(this.config.path, "a");
    try {
      const stat = await this.file.stat();
      this.currentSize = stat.size;
    } catch {
      this.currentSize = 0;
    }
  }

  /** Create the destination directory when required. */
  private async ensureDir(): Promise<void> {
    const directory = dirname(this.config.path);
    if (directory !== "." && directory !== this.config.path) {
      await mkdir(directory, { recursive: true });
    }
  }

  /** Close the current file handle if one is open. */
  private async closeFile(): Promise<void> {
    const file = this.file;
    this.file = null;
    if (!file) return;
    try {
      await file.close();
    } catch {
      // The file may already be closed after an I/O failure.
    }
  }

  /** Remove a path when it exists. */
  private async removeIfPresent(path: string): Promise<void> {
    try {
      await rm(path);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  /** Rename an existing path without manufacturing an empty source. */
  private async renameIfPresent(from: string, to: string): Promise<void> {
    try {
      await stat(from);
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }

    try {
      await this.removeIfPresent(to);
      await rename(from, to);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  /** Rotate retained files and open a fresh destination. */
  private async rotate(): Promise<void> {
    await this.closeFile();

    for (let i = this.config.maxFiles - 1; i >= 1; i--) {
      const from = i === 1 ? this.config.path : `${this.config.path}.${i - 1}`;
      const to = `${this.config.path}.${i}`;
      await this.renameIfPresent(from, to);
    }

    if (this.config.maxFiles <= 1) await this.removeIfPresent(this.config.path);

    this.file = await open(this.config.path, "w");
    this.currentSize = 0;
  }

  /** Wait for queued writes and synchronize the current file. */
  async flush(): Promise<void> {
    await this.writeQueue;
    if (this.file) {
      try {
        await this.file.sync();
      } catch {
        // The file may already be closed after an I/O failure.
      }
    }
  }

  /** Stop accepting entries, flush queued writes, and close the file. */
  async close(): Promise<void> {
    if (this.closePromise) return await this.closePromise;
    this.closed = true;
    this.closePromise = (async () => {
      await this.flush();
      await this.closeFile();
    })();
    await this.closePromise;
  }
}

/** Create file log subscriber. */
export function createFileLogSubscriber(config: FileLogConfig): FileLogSubscriber {
  return new FileLogSubscriber(config);
}
