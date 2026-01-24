/**************************
 * Error Collector for Dev Server
 *
 * Aggregates compilation, bundle, and runtime errors from the dev server
 * for exposure via MCP to coding agents.
 **************************/

export type ErrorType = "compile" | "runtime" | "bundle" | "hmr" | "module";

export interface DevError {
  /** Unique error identifier */
  id: string;
  /** Error category */
  type: ErrorType;
  /** Human-readable error message */
  message: string;
  /** Source file path (if available) */
  file?: string;
  /** Line number (if available) */
  line?: number;
  /** Column number (if available) */
  column?: number;
  /** Full stack trace (if available) */
  stack?: string;
  /** When the error occurred */
  timestamp: number;
  /** Additional context/metadata */
  context?: Record<string, unknown>;
}

export interface ErrorFilter {
  type?: ErrorType | ErrorType[];
  file?: string | RegExp;
  since?: number;
}

export type ErrorSubscriber = (error: DevError) => void;

export class ErrorCollector {
  private errors = new Map<string, DevError>();
  private subscribers = new Set<ErrorSubscriber>();
  private idCounter = 0;
  private maxErrors: number;

  constructor(options: { maxErrors?: number } = {}) {
    this.maxErrors = options.maxErrors ?? 100;
  }

  private generateId(): string {
    return `err_${Date.now()}_${++this.idCounter}`;
  }

  add(error: Omit<DevError, "id" | "timestamp">): DevError {
    const fullError: DevError = {
      ...error,
      id: this.generateId(),
      timestamp: Date.now(),
    };

    if (this.errors.size >= this.maxErrors) {
      const oldestId = this.errors.keys().next().value as string | undefined;
      if (oldestId) this.errors.delete(oldestId);
    }

    this.errors.set(fullError.id, fullError);

    for (const subscriber of this.subscribers) {
      try {
        subscriber(fullError);
      } catch {
        // Ignore subscriber errors
      }
    }

    return fullError;
  }

  addCompileError(
    message: string,
    file?: string,
    line?: number,
    column?: number,
  ): DevError {
    return this.add({ type: "compile", message, file, line, column });
  }

  addRuntimeError(
    message: string,
    stack?: string,
    context?: Record<string, unknown>,
  ): DevError {
    return this.add({ type: "runtime", message, stack, context });
  }

  addBundleError(
    message: string,
    file?: string,
    context?: Record<string, unknown>,
  ): DevError {
    return this.add({ type: "bundle", message, file, context });
  }

  addHMRError(
    message: string,
    file?: string,
    context?: Record<string, unknown>,
  ): DevError {
    return this.add({ type: "hmr", message, file, context });
  }

  addModuleError(
    message: string,
    file?: string,
    context?: Record<string, unknown>,
  ): DevError {
    return this.add({ type: "module", message, file, context });
  }

  getAll(filter?: ErrorFilter): DevError[] {
    let errors = Array.from(this.errors.values());
    if (!filter) return errors;

    const { type, file, since } = filter;

    if (type) {
      const types = Array.isArray(type) ? type : [type];
      errors = errors.filter((e) => types.includes(e.type));
    }

    if (file) {
      if (typeof file === "string") {
        errors = errors.filter((e) => e.file === file);
      } else {
        errors = errors.filter((e) => (e.file ? file.test(e.file) : false));
      }
    }

    if (since) {
      errors = errors.filter((e) => e.timestamp >= since);
    }

    return errors;
  }

  get(id: string): DevError | undefined {
    return this.errors.get(id);
  }

  clearFile(file: string): number {
    return this.clearWhere((error) => error.file === file);
  }

  clearType(type: ErrorType): number {
    return this.clearWhere((error) => error.type === type);
  }

  clear(): void {
    this.errors.clear();
  }

  get count(): number {
    return this.errors.size;
  }

  countByType(): Record<ErrorType, number> {
    const counts: Record<ErrorType, number> = {
      compile: 0,
      runtime: 0,
      bundle: 0,
      hmr: 0,
      module: 0,
    };

    for (const { type } of this.errors.values()) {
      counts[type]++;
    }

    return counts;
  }

  subscribe(callback: ErrorSubscriber): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  toJSON(): DevError[] {
    return this.getAll();
  }

  private clearWhere(predicate: (error: DevError) => boolean): number {
    let cleared = 0;

    for (const [id, error] of this.errors) {
      if (!predicate(error)) continue;
      this.errors.delete(id);
      cleared++;
    }

    return cleared;
  }
}

let globalCollector: ErrorCollector | null = null;

export function getErrorCollector(): ErrorCollector {
  globalCollector ??= new ErrorCollector();
  return globalCollector;
}

export function resetErrorCollector(): void {
  globalCollector?.clear();
  globalCollector = null;
}

export function parseCompileError(output: string): Partial<DevError> | null {
  const tsMatch = output.match(
    /^(.+?)\((\d+),(\d+)\):\s*error\s+\w+:\s*(.+)$/m,
  );
  if (tsMatch) {
    const [, file, line = "0", column = "0", message] = tsMatch;
    return {
      type: "compile",
      file,
      line: parseInt(line, 10),
      column: parseInt(column, 10),
      message,
    };
  }

  const esbuildMatch = output.match(
    /^ERROR:\s*\[([^\]]+):(\d+):(\d+)\]\s*(.+)$/m,
  );
  if (esbuildMatch) {
    const [, file, line = "0", column = "0", message] = esbuildMatch;
    return {
      type: "bundle",
      file,
      line: parseInt(line, 10),
      column: parseInt(column, 10),
      message,
    };
  }

  if (output.includes("error") || output.includes("Error")) {
    return { type: "compile", message: output.trim() };
  }

  return null;
}
