import type { LogEntry, LogLevel, LogSubscriber } from "./log-buffer.ts";

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

export function parseMaxSize(value: number | string): number {
  if (typeof value === "number") return value;

  const match = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);
  if (!match?.[1]) {
    throw new Error(`Invalid maxSize value: "${value}". Expected a number or string like "10mb".`);
  }

  const num = parseFloat(match[1]);
  const unit = match[2] ?? "b";
  return Math.floor(num * (SIZE_UNITS[unit] ?? 1));
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

export class FileLogSubscriber {
  private file: Deno.FsFile | null = null;
  private currentSize = 0;
  private writeQueue: Promise<void> = Promise.resolve();
  private maxSizeBytes: number;
  private minLevel: number;
  private formatter: (entry: LogEntry) => string;
  private closed = false;
  private permissionFailed = false;
  private config: FileLogConfig;

  constructor(config: FileLogConfig) {
    this.config = config;
    this.maxSizeBytes = parseMaxSize(config.maxSize);
    this.minLevel = LOG_LEVEL_PRIORITY[config.level];
    this.formatter = config.format === "json" ? formatEntryJson : formatEntryText;
  }

  getSubscriber(): LogSubscriber {
    return (entry: LogEntry) => {
      if (this.closed || this.permissionFailed) return;
      if (LOG_LEVEL_PRIORITY[entry.level] < this.minLevel) return;
      this.enqueue(entry);
    };
  }

  private enqueue(entry: LogEntry): void {
    this.writeQueue = this.writeQueue.then(() => this.writeEntry(entry)).catch(() => {});
  }

  private async writeEntry(entry: LogEntry): Promise<void> {
    try {
      if (!this.file) await this.openFile();

      const line = this.formatter(entry) + "\n";
      const bytes = new TextEncoder().encode(line);

      if (this.currentSize + bytes.length > this.maxSizeBytes) {
        await this.rotate();
      }

      await this.file!.write(bytes);
      this.currentSize += bytes.length;
    } catch (err) {
      if (err instanceof Deno.errors.PermissionDenied) {
        this.permissionFailed = true;
        console.error(
          `[FileLogSubscriber] Permission denied writing to ${this.config.path}. File logging disabled.`,
        );
        return;
      }
      throw err;
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
    } catch {
      this.currentSize = 0;
    }
  }

  private async ensureDir(): Promise<void> {
    const dir = this.config.path.substring(0, this.config.path.lastIndexOf("/"));
    if (dir) {
      await Deno.mkdir(dir, { recursive: true });
    }
  }

  private async rotate(): Promise<void> {
    if (this.file) {
      this.file.close();
      this.file = null;
    }

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
    await this.writeQueue;
    if (this.file) {
      try {
        await this.file.sync();
      } catch {
        // file may already be closed
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
    if (this.file) {
      try {
        this.file.close();
      } catch {
        // already closed
      }
      this.file = null;
    }
  }
}

export function createFileLogSubscriber(config: FileLogConfig): FileLogSubscriber {
  return new FileLogSubscriber(config);
}
