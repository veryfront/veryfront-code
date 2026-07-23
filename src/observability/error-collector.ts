/**************************
 * Error Collector for Dev Server
 *
 * Aggregates compilation, bundle, and runtime errors from the dev server
 * for exposure via MCP to coding agents.
 **************************/

import { type ErrorCategory, INVALID_ARGUMENT } from "#veryfront/errors";
import { sanitizeErrorContext, sanitizeErrorText } from "#veryfront/errors/sanitization.ts";

const MAX_COLLECTED_ERRORS = 10_000;
const MAX_COMPILER_OUTPUT_LENGTH = 65_536;

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
  /** Match an exact source file or a source-file pattern. */
  file?: string | RegExp;
  /** Include errors captured at or after this Unix timestamp in milliseconds. */
  since?: number;
}

/** Public API contract for error subscriber. */
export type ErrorSubscriber = (error: DevError) => void;

/** Collect bounded, sanitized development errors. */
export class ErrorCollector {
  private errors = new Map<string, DevError>();
  private subscribers = new Set<ErrorSubscriber>();
  private idCounter = 0;
  private maxErrors: number;

  /** Create a collector with an optional bounded retention limit. */
  constructor(options: { maxErrors?: number } = {}) {
    const maxErrors = options.maxErrors ?? 100;
    if (
      !Number.isSafeInteger(maxErrors) || maxErrors <= 0 || maxErrors > MAX_COLLECTED_ERRORS
    ) {
      throw new TypeError(
        `maxErrors must be a positive safe integer up to ${MAX_COLLECTED_ERRORS}`,
      );
    }
    this.maxErrors = maxErrors;
  }

  /** Create a process-local identifier for a collected error. */
  private generateId(): string {
    return `err_${Date.now()}_${++this.idCounter}`;
  }

  /** Add, sanitize, and snapshot one typed development error. */
  add(error: Omit<DevError, "id" | "timestamp">): DevError {
    if (!Object.hasOwn(ERROR_TYPE_TO_CATEGORY, error.type)) {
      throw INVALID_ARGUMENT.create({
        detail: "ErrorCollector.add() received an unsupported type",
      });
    }
    const expectedCategory = ERROR_TYPE_TO_CATEGORY[error.type];
    if (error.category !== expectedCategory) {
      throw INVALID_ARGUMENT.create({
        detail: "ErrorCollector.add() received mismatched type/category",
      });
    }

    const fullError = sanitizeDevError({
      ...error,
      id: this.generateId(),
      timestamp: Date.now(),
    });

    if (this.errors.size >= this.maxErrors) {
      const oldestId = this.errors.keys().next().value;
      if (oldestId) this.errors.delete(oldestId);
    }

    this.errors.set(fullError.id, fullError);

    for (const subscriber of this.subscribers) {
      try {
        subscriber(cloneDevError(fullError));
      } catch (_) {
        /* expected: subscriber errors must not break error collection */
      }
    }

    return cloneDevError(fullError);
  }

  /** Add an error using the category associated with its type. */
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

  /** Add a file-scoped bundle, HMR, or module error. */
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

  /** Return sanitized snapshots that match an optional filter. */
  getAll(filter?: ErrorFilter): DevError[] {
    const errors = Array.from(this.errors.values());
    if (!filter) return errors.map(cloneDevError);

    const { type, category, slug, file, since } = filter;
    let filePattern: RegExp | undefined;
    if (file instanceof RegExp) {
      try {
        filePattern = new RegExp(file.source, file.flags);
      } catch {
        return [];
      }
    }

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
        } else {
          if (!e.file || !filePattern) return false;
          filePattern.lastIndex = 0;
          if (!filePattern.test(e.file)) return false;
        }
      }

      if (since && e.timestamp < since) return false;

      return true;
    }).map(cloneDevError);
  }

  /** Return a sanitized snapshot for one identifier. */
  get(id: string): DevError | undefined {
    const error = this.errors.get(id);
    return error ? cloneDevError(error) : undefined;
  }

  /** Remove all errors associated with an exact source file. */
  clearFile(file: string): number {
    const sanitized = sanitizeFile(file);
    return sanitized ? this.clearWhere((error) => error.file === sanitized) : 0;
  }

  /** Remove all errors of one type. */
  clearType(type: ErrorType): number {
    return this.clearWhere((error) => error.type === type);
  }

  /** Remove all errors of one category. */
  clearCategory(category: ErrorCategory): number {
    return this.clearWhere((error) => error.category === category);
  }

  /** Remove every collected error. */
  clear(): void {
    this.errors.clear();
  }

  /** Number of retained errors. */
  get count(): number {
    return this.errors.size;
  }

  /** Count retained errors by error type. */
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
      counts[category]++;
    }

    return counts;
  }

  /** Subscribe to sanitized snapshots of newly collected errors. */
  subscribe(callback: ErrorSubscriber): () => void {
    if (typeof callback !== "function") throw new TypeError("subscriber must be a function");
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /** Serialize retained errors as sanitized snapshots. */
  toJSON(): DevError[] {
    return this.getAll();
  }

  /** Remove errors that satisfy a predicate and return the removed count. */
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

function sanitizeFile(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  return sanitizeErrorText(value, 4_096) || undefined;
}

function sanitizePositiveInteger(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value : undefined;
}

function sanitizeDevError(error: DevError): DevError {
  const file = sanitizeFile(error.file);
  const line = sanitizePositiveInteger(error.line);
  const column = sanitizePositiveInteger(error.column);
  return {
    id: sanitizeErrorText(error.id, 128),
    type: error.type,
    category: error.category,
    message: sanitizeErrorText(error.message, 16_384),
    timestamp: error.timestamp,
    ...(typeof error.slug === "string" ? { slug: sanitizeErrorText(error.slug, 128) } : {}),
    ...(file ? { file } : {}),
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
    ...(typeof error.stack === "string" ? { stack: sanitizeErrorText(error.stack, 16_384) } : {}),
    ...(error.context ? { context: sanitizeErrorContext(error.context) } : {}),
  };
}

function cloneDevError(error: DevError): DevError {
  return {
    ...error,
    ...(error.context ? { context: sanitizeErrorContext(error.context) } : {}),
  };
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
  if (typeof output !== "string") return null;
  const boundedOutput = output.slice(0, MAX_COMPILER_OUTPUT_LENGTH);
  const tsMatch = boundedOutput.match(
    /^(.+?)\((\d+),(\d+)\):\s*error\s+\w+:\s*(.+)$/m,
  );
  if (tsMatch && tsMatch[1] && tsMatch[2] && tsMatch[3] && tsMatch[4]) {
    const line = parsePositiveInteger(tsMatch[2]);
    const column = parsePositiveInteger(tsMatch[3]);
    return {
      type: "compile",
      category: "BUILD",
      file: sanitizeFile(tsMatch[1]),
      ...(line !== undefined ? { line } : {}),
      ...(column !== undefined ? { column } : {}),
      message: sanitizeErrorText(tsMatch[4]),
    };
  }

  const esbuildMatch = boundedOutput.match(
    /^ERROR:\s*\[([^\]]+):(\d+):(\d+)\]\s*(.+)$/m,
  );
  if (esbuildMatch && esbuildMatch[1] && esbuildMatch[2] && esbuildMatch[3] && esbuildMatch[4]) {
    const line = parsePositiveInteger(esbuildMatch[2]);
    const column = parsePositiveInteger(esbuildMatch[3]);
    return {
      type: "bundle",
      category: "BUILD",
      file: sanitizeFile(esbuildMatch[1]),
      ...(line !== undefined ? { line } : {}),
      ...(column !== undefined ? { column } : {}),
      message: sanitizeErrorText(esbuildMatch[4]),
    };
  }

  if (/error/i.test(boundedOutput)) {
    return {
      type: "compile",
      category: "BUILD",
      message: sanitizeErrorText(boundedOutput.trim()),
    };
  }

  return null;
}

function parsePositiveInteger(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
