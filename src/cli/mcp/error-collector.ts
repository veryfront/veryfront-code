/**
 * Error Collector for Dev Server
 *
 * Aggregates compilation, bundle, and runtime errors from the dev server
 * for exposure via MCP to coding agents.
 */

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Error Collector
// ============================================================================

export class ErrorCollector {
  private errors: Map<string, DevError> = new Map();
  private subscribers: Set<ErrorSubscriber> = new Set();
  private idCounter = 0;
  private maxErrors: number;

  constructor(options: { maxErrors?: number } = {}) {
    this.maxErrors = options.maxErrors ?? 100;
  }

  /**
   * Generate a unique error ID
   */
  private generateId(): string {
    return `err_${Date.now()}_${++this.idCounter}`;
  }

  /**
   * Add a new error
   */
  add(error: Omit<DevError, "id" | "timestamp">): DevError {
    const fullError: DevError = {
      ...error,
      id: this.generateId(),
      timestamp: Date.now(),
    };

    // Remove oldest errors if we're at capacity
    if (this.errors.size >= this.maxErrors) {
      const oldest = this.errors.keys().next();
      if (!oldest.done) {
        this.errors.delete(oldest.value);
      }
    }

    this.errors.set(fullError.id, fullError);

    // Notify subscribers
    for (const subscriber of this.subscribers) {
      try {
        subscriber(fullError);
      } catch {
        // Ignore subscriber errors
      }
    }

    return fullError;
  }

  /**
   * Add a compilation error
   */
  addCompileError(
    message: string,
    file?: string,
    line?: number,
    column?: number,
  ): DevError {
    return this.add({
      type: "compile",
      message,
      file,
      line,
      column,
    });
  }

  /**
   * Add a runtime error
   */
  addRuntimeError(
    message: string,
    stack?: string,
    context?: Record<string, unknown>,
  ): DevError {
    return this.add({
      type: "runtime",
      message,
      stack,
      context,
    });
  }

  /**
   * Add a bundle error
   */
  addBundleError(
    message: string,
    file?: string,
    context?: Record<string, unknown>,
  ): DevError {
    return this.add({
      type: "bundle",
      message,
      file,
      context,
    });
  }

  /**
   * Add an HMR error
   */
  addHMRError(
    message: string,
    file?: string,
    context?: Record<string, unknown>,
  ): DevError {
    return this.add({
      type: "hmr",
      message,
      file,
      context,
    });
  }

  /**
   * Add a module resolution error
   */
  addModuleError(
    message: string,
    file?: string,
    context?: Record<string, unknown>,
  ): DevError {
    return this.add({
      type: "module",
      message,
      file,
      context,
    });
  }

  /**
   * Get all errors, optionally filtered
   */
  getAll(filter?: ErrorFilter): DevError[] {
    let errors = Array.from(this.errors.values());

    if (filter) {
      if (filter.type) {
        const types = Array.isArray(filter.type) ? filter.type : [filter.type];
        errors = errors.filter((e) => types.includes(e.type));
      }

      if (filter.file) {
        if (typeof filter.file === "string") {
          errors = errors.filter((e) => e.file === filter.file);
        } else {
          errors = errors.filter((e) =>
            e.file && filter.file instanceof RegExp && filter.file.test(e.file)
          );
        }
      }

      if (filter.since) {
        errors = errors.filter((e) => e.timestamp >= filter.since!);
      }
    }

    return errors;
  }

  /**
   * Get error by ID
   */
  get(id: string): DevError | undefined {
    return this.errors.get(id);
  }

  /**
   * Clear errors for a specific file (e.g., when file is saved)
   */
  clearFile(file: string): number {
    let cleared = 0;
    for (const [id, error] of this.errors) {
      if (error.file === file) {
        this.errors.delete(id);
        cleared++;
      }
    }
    return cleared;
  }

  /**
   * Clear errors of a specific type
   */
  clearType(type: ErrorType): number {
    let cleared = 0;
    for (const [id, error] of this.errors) {
      if (error.type === type) {
        this.errors.delete(id);
        cleared++;
      }
    }
    return cleared;
  }

  /**
   * Clear all errors
   */
  clear(): void {
    this.errors.clear();
  }

  /**
   * Get error count
   */
  get count(): number {
    return this.errors.size;
  }

  /**
   * Get count by type
   */
  countByType(): Record<ErrorType, number> {
    const counts: Record<ErrorType, number> = {
      compile: 0,
      runtime: 0,
      bundle: 0,
      hmr: 0,
      module: 0,
    };

    for (const error of this.errors.values()) {
      counts[error.type]++;
    }

    return counts;
  }

  /**
   * Subscribe to new errors
   */
  subscribe(callback: ErrorSubscriber): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Convert errors to JSON-serializable format
   */
  toJSON(): DevError[] {
    return this.getAll();
  }
}

// ============================================================================
// Global Instance
// ============================================================================

let globalCollector: ErrorCollector | null = null;

/**
 * Get or create the global error collector
 */
export function getErrorCollector(): ErrorCollector {
  if (!globalCollector) {
    globalCollector = new ErrorCollector();
  }
  return globalCollector;
}

/**
 * Reset the global collector (for testing)
 */
export function resetErrorCollector(): void {
  globalCollector?.clear();
  globalCollector = null;
}

// ============================================================================
// Error Parsing Utilities
// ============================================================================

/**
 * Parse TypeScript/ESBuild error output
 */
export function parseCompileError(output: string): Partial<DevError> | null {
  // Pattern: path/to/file.ts(line,col): error TS1234: Message
  const tsMatch = output.match(/^(.+?)\((\d+),(\d+)\):\s*error\s+\w+:\s*(.+)$/m);
  if (tsMatch) {
    return {
      type: "compile",
      file: tsMatch[1],
      line: parseInt(tsMatch[2]!, 10),
      column: parseInt(tsMatch[3]!, 10),
      message: tsMatch[4]!,
    };
  }

  // Pattern: ERROR: [path/file.ts:line:col] Message
  const esbuildMatch = output.match(/^ERROR:\s*\[([^\]]+):(\d+):(\d+)\]\s*(.+)$/m);
  if (esbuildMatch) {
    return {
      type: "bundle",
      file: esbuildMatch[1],
      line: parseInt(esbuildMatch[2]!, 10),
      column: parseInt(esbuildMatch[3]!, 10),
      message: esbuildMatch[4]!,
    };
  }

  // Generic error
  if (output.includes("error") || output.includes("Error")) {
    return {
      type: "compile",
      message: output.trim(),
    };
  }

  return null;
}
