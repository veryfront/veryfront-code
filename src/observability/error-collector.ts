/**************************
 * Error Collector for Dev Server
 *
 * Aggregates compilation, bundle, and runtime errors from the dev server
 * for exposure via MCP to coding agents.
 **************************/

import type { ErrorCategory } from "#veryfront/errors/types.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

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
    const expectedCategory = ERROR_TYPE_TO_CATEGORY[error.type];
    if (error.category !== expectedCategory) {
      throw INVALID_ARGUMENT.create({
        detail:
          `ErrorCollector.add() received mismatched type/category: ${error.type} must use ${expectedCategory}, got ${error.category}`,
      });
    }

    const fullError: DevError = {
      ...error,
      id: this.generateId(),
      timestamp: Date.now(),
    };

    if (this.errors.size >= this.maxErrors) {
      const oldestId = this.errors.keys().next().value;
      if (oldestId) this.errors.delete(oldestId);
    }

    this.errors.set(fullError.id, fullError);

    for (const subscriber of this.subscribers) {
      try {
        subscriber(fullError);
      } catch (_) {
        /* expected: subscriber errors must not break error collection */
      }
    }

    return fullError;
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
    return this.addTypedError("bundle", message, { file, context, slug });
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
    return this.addTypedError("hmr", message, { file, context, slug });
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
    return this.addTypedError("module", message, { file, context, slug });
  }

  getAll(filter?: ErrorFilter): DevError[] {
    const errors = Array.from(this.errors.values());
    if (!filter) return errors;

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
        } else if (!e.file || !file.test(e.file)) {
          return false;
        }
      }

      if (since && e.timestamp < since) return false;

      return true;
    });
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
