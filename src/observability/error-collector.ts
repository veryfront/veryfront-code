/**************************
 * Error Collector for Dev Server
 *
 * Aggregates compilation, bundle, and runtime errors from the dev server
 * for exposure via MCP to coding agents.
 **************************/

import { type ErrorCategory, INVALID_ARGUMENT } from "#veryfront/errors";
import { sanitizeUrlCredentials } from "#veryfront/utils/logger/redact.ts";
import { sanitizeStructuredTelemetryData } from "./telemetry-error.ts";

/** Public API contract for error type. */
export type ErrorType = "compile" | "runtime" | "bundle" | "hmr" | "module";

/**
 * Map ErrorType to ErrorCategory from slug registry
 */
const ERROR_TYPE_TO_CATEGORY: Record<ErrorType, ErrorCategory> = {
  compile: "BUILD",
  runtime: "RUNTIME",
  bundle: "BUILD",
  hmr: "DEV",
  module: "MODULE",
};

function isErrorType(value: unknown): value is ErrorType {
  return typeof value === "string" && Object.hasOwn(ERROR_TYPE_TO_CATEGORY, value);
}

/** Error shape for dev. */
export interface DevError {
  /** Unique error identifier */
  id: string;
  /** Error category from slug registry (BUILD, RUNTIME, DEV, MODULE, etc.) */
  category: ErrorCategory;
  /** Error type */
  type: ErrorType;
  /** Error slug from registry (if available) */
  slug?: string;
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

/** Public API contract for error filter. */
export interface ErrorFilter {
  /** Filter by type */
  type?: ErrorType | ErrorType[];
  /** Filter by error category (BUILD, RUNTIME, DEV, MODULE, etc.) */
  category?: ErrorCategory | ErrorCategory[];
  /** Filter by error slug */
  slug?: string | string[];
  file?: string | RegExp;
  since?: number;
}

/** Public API contract for error subscriber. */
export type ErrorSubscriber = (error: DevError) => void;

function snapshotError(error: DevError): DevError {
  return {
    ...error,
    context: error.context ? sanitizeStructuredTelemetryData(error.context) : error.context,
  };
}

function matchesPattern(pattern: RegExp, value: string): boolean {
  const initialLastIndex = pattern.lastIndex;
  try {
    pattern.lastIndex = 0;
    return pattern.test(value);
  } finally {
    pattern.lastIndex = initialLastIndex;
  }
}

/** Implement error collector. */
export class ErrorCollector {
  private errors = new Map<string, DevError>();
  private subscribers = new Set<ErrorSubscriber>();
  private idCounter = 0;
  private maxErrors: number;

  constructor(options: { maxErrors?: number } = {}) {
    const maxErrors = options.maxErrors ?? 100;
    if (!Number.isSafeInteger(maxErrors) || maxErrors < 0) {
      throw new RangeError("ErrorCollector maxErrors must be a non-negative integer");
    }
    this.maxErrors = maxErrors;
  }

  private generateId(): string {
    return `err_${Date.now()}_${++this.idCounter}`;
  }

  add(error: Omit<DevError, "id" | "timestamp">): DevError {
    const type: unknown = error.type;
    if (!isErrorType(type)) {
      throw INVALID_ARGUMENT.create({
        detail: `ErrorCollector.add() received invalid error type: ${String(type)}`,
      });
    }

    const category: unknown = error.category;
    const expectedCategory = ERROR_TYPE_TO_CATEGORY[type];
    if (category !== expectedCategory) {
      throw INVALID_ARGUMENT.create({
        detail:
          `ErrorCollector.add() received mismatched type/category: ${type} must use ${expectedCategory}, got ${
            String(category)
          }`,
      });
    }

    const fullError: DevError = {
      ...error,
      type,
      category: expectedCategory,
      message: sanitizeUrlCredentials(error.message),
      file: error.file ? sanitizeUrlCredentials(error.file) : error.file,
      stack: error.stack ? sanitizeUrlCredentials(error.stack) : error.stack,
      context: error.context ? sanitizeStructuredTelemetryData(error.context) : error.context,
      slug: error.slug ? sanitizeUrlCredentials(error.slug) : error.slug,
      id: this.generateId(),
      timestamp: Date.now(),
    };

    if (this.maxErrors > 0) {
      if (this.errors.size >= this.maxErrors) {
        const oldestId = this.errors.keys().next().value;
        if (oldestId) this.errors.delete(oldestId);
      }

      this.errors.set(fullError.id, fullError);
    }

    for (const subscriber of this.subscribers) {
      try {
        subscriber(snapshotError(fullError));
      } catch (_) {
        /* expected: subscriber errors must not break error collection */
      }
    }

    return snapshotError(fullError);
  }

  private addTypedError(
    type: ErrorType,
    message: string,
    details: Partial<Pick<DevError, "file" | "line" | "column" | "stack" | "context" | "slug">> =
      {},
  ): DevError {
    const category = ERROR_TYPE_TO_CATEGORY[type];
    return this.add({ type, category, message, ...details });
  }

  /**
   * Add a compile/build error
   * @param message Error message
   * @param file Source file path
   * @param line Line number
   * @param column Column number
   * @param slug Error slug from registry (optional)
   */
  addCompileError(
    message: string,
    file?: string,
    line?: number,
    column?: number,
    slug?: string,
  ): DevError {
    return this.addTypedError("compile", message, { file, line, column, slug });
  }

  /**
   * Add a runtime error
   * @param message Error message
   * @param stack Stack trace
   * @param context Additional context
   * @param slug Error slug from registry (optional)
   */
  addRuntimeError(
    message: string,
    stack?: string,
    context?: Record<string, unknown>,
    slug?: string,
  ): DevError {
    return this.addTypedError("runtime", message, { stack, context, slug });
  }

  private addFileContextError(
    type: "bundle" | "hmr" | "module",
    message: string,
    file?: string,
    context?: Record<string, unknown>,
    slug?: string,
  ): DevError {
    return this.addTypedError(type, message, { file, context, slug });
  }

  /**
   * Add a bundle error
   * @param message Error message
   * @param file Source file path
   * @param context Additional context
   * @param slug Error slug from registry (optional)
   */
  addBundleError(
    message: string,
    file?: string,
    context?: Record<string, unknown>,
    slug?: string,
  ): DevError {
    return this.addFileContextError("bundle", message, file, context, slug);
  }

  /**
   * Add an HMR error
   * @param message Error message
   * @param file Source file path
   * @param context Additional context
   * @param slug Error slug from registry (optional)
   */
  addHMRError(
    message: string,
    file?: string,
    context?: Record<string, unknown>,
    slug?: string,
  ): DevError {
    return this.addFileContextError("hmr", message, file, context, slug);
  }

  /**
   * Add a module error
   * @param message Error message
   * @param file Source file path
   * @param context Additional context
   * @param slug Error slug from registry (optional)
   */
  addModuleError(
    message: string,
    file?: string,
    context?: Record<string, unknown>,
    slug?: string,
  ): DevError {
    return this.addFileContextError("module", message, file, context, slug);
  }

  getAll(filter?: ErrorFilter): DevError[] {
    const errors = Array.from(this.errors.values());
    if (!filter) return errors.map(snapshotError);

    const { type, category, slug, file, since } = filter;

    return errors.filter((e) => {
      // Filter by type
      if (type) {
        const types = Array.isArray(type) ? type : [type];
        if (!types.includes(e.type)) return false;
      }

      // Filter by category
      if (category) {
        const categories = Array.isArray(category) ? category : [category];
        if (!categories.includes(e.category)) return false;
      }

      // Filter by slug
      if (slug) {
        const slugs = Array.isArray(slug) ? slug : [slug];
        if (!e.slug || !slugs.includes(e.slug)) return false;
      }

      if (file) {
        if (typeof file === "string") {
          if (e.file !== file) return false;
        } else if (!e.file || !matchesPattern(file, e.file)) {
          return false;
        }
      }

      if (since && e.timestamp < since) return false;

      return true;
    }).map(snapshotError);
  }

  get(id: string): DevError | undefined {
    const error = this.errors.get(id);
    return error ? snapshotError(error) : undefined;
  }

  clearFile(file: string): number {
    return this.clearWhere((error) => error.file === file);
  }

  clearType(type: ErrorType): number {
    return this.clearWhere((error) => error.type === type);
  }

  /**
   * Clear all errors of a specific category
   */
  clearCategory(category: ErrorCategory): number {
    return this.clearWhere((error) => error.category === category);
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
      if (isErrorType(type)) counts[type] += 1;
    }

    return counts;
  }

  /**
   * Count errors by category (preferred method)
   */
  countByCategory(): Record<ErrorCategory, number> {
    const counts: Record<ErrorCategory, number> = {
      CONFIG: 0,
      BUILD: 0,
      RUNTIME: 0,
      ROUTE: 0,
      MODULE: 0,
      SERVER: 0,
      BOUNDARY: 0,
      DEV: 0,
      DEPLOY: 0,
      AGENT: 0,
      GENERAL: 0,
    };

    for (const { category } of this.errors.values()) {
      if (typeof category === "string" && Object.hasOwn(counts, category)) {
        counts[category as ErrorCategory] += 1;
      }
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

/** Return error collector. */
export function getErrorCollector(): ErrorCollector {
  globalCollector ??= new ErrorCollector();
  return globalCollector;
}

/** Reset captured runtime errors. */
export function resetErrorCollector(): void {
  globalCollector?.clear();
  globalCollector = null;
}

/** Error shape for parse compile. */
export function parseCompileError(output: string): Partial<DevError> | null {
  const tsMatch = output.match(
    /^(.+?)\((\d+),(\d+)\):\s*error\s+\w+:\s*(.+)$/m,
  );
  if (tsMatch && tsMatch[1] && tsMatch[2] && tsMatch[3] && tsMatch[4]) {
    return {
      type: "compile",
      category: "BUILD",
      file: tsMatch[1],
      line: parseInt(tsMatch[2], 10),
      column: parseInt(tsMatch[3], 10),
      message: tsMatch[4],
    };
  }

  const esbuildMatch = output.match(
    /^ERROR:\s*\[([^\]]+):(\d+):(\d+)\]\s*(.+)$/m,
  );
  if (esbuildMatch && esbuildMatch[1] && esbuildMatch[2] && esbuildMatch[3] && esbuildMatch[4]) {
    return {
      type: "bundle",
      category: "BUILD",
      file: esbuildMatch[1],
      line: parseInt(esbuildMatch[2], 10),
      column: parseInt(esbuildMatch[3], 10),
      message: esbuildMatch[4],
    };
  }

  if (output.includes("error") || output.includes("Error")) {
    return {
      type: "compile",
      category: "BUILD",
      message: output.trim(),
    };
  }

  return null;
}
