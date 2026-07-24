import { buildErrorDocsUrl, sanitizeBoundedDiagnosticText } from "./diagnostic-policy.ts";

/**
 * Error categories for domain-based grouping and handling
 */
export type ErrorCategory =
  | "CONFIG"
  | "BUILD"
  | "RUNTIME"
  | "ROUTE"
  | "MODULE"
  | "SERVER"
  | "BOUNDARY"
  | "DEV"
  | "DEPLOY"
  | "AGENT"
  | "GENERAL";

/**
 * RFC 9457 Problem Details response shape
 */
export interface RFC9457Response {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  category: ErrorCategory;
  suggestion?: string;
  cause?: string;
}

/**
 * Error definition for the registry
 */
export interface ErrorDefinition {
  slug: string;
  category: ErrorCategory;
  status: number;
  title: string;
  suggestion?: string;
}

/**
 * Options for creating an error instance
 */
export interface ErrorCreateOptions {
  /** Override the error message (defaults to detail or definition title) */
  message?: string;
  detail?: string;
  cause?: unknown;
  instance?: string;
  context?: unknown;
  /** Override the definition's default HTTP status (e.g., for per-request status codes) */
  status?: number;
}

/**
 * Registered error with factory method
 */
export interface RegisteredError {
  readonly slug: string;
  readonly category: ErrorCategory;
  readonly status: number;
  readonly title: string;
  readonly suggestion?: string;
  readonly create: (options?: ErrorCreateOptions) => VeryfrontError;
}

const ERROR_CATEGORIES: ReadonlySet<ErrorCategory> = new Set([
  "CONFIG",
  "BUILD",
  "RUNTIME",
  "ROUTE",
  "MODULE",
  "SERVER",
  "BOUNDARY",
  "DEV",
  "DEPLOY",
  "AGENT",
  "GENERAL",
]);

/**
 * Define an error in the registry
 */
export function defineError(definition: ErrorDefinition): RegisteredError {
  const snapshot: ErrorDefinition = { ...definition };

  const registered: RegisteredError = {
    ...snapshot,
    create(options?: ErrorCreateOptions): VeryfrontError {
      const status = options?.status ?? snapshot.status;

      return new VeryfrontError(options?.message || options?.detail || snapshot.title, {
        slug: snapshot.slug,
        category: snapshot.category,
        status,
        title: snapshot.title,
        suggestion: snapshot.suggestion,
        detail: options?.detail,
        cause: options?.cause,
        instance: options?.instance,
        context: options?.context,
      });
    },
  };

  return Object.freeze(registered);
}

/**
 * Options for VeryfrontError constructor
 */
export interface VeryfrontErrorOptions extends ErrorCreateOptions {
  slug: string;
  category: ErrorCategory;
  status: number;
  title: string;
  suggestion?: string;
}

/** Data-only snapshot used at logging, HTTP, CLI, and telemetry boundaries. */
export interface VeryfrontErrorSnapshot {
  readonly slug: string;
  readonly category: ErrorCategory;
  readonly status: number;
  readonly title: string;
  readonly message: string;
  readonly suggestion?: string;
  readonly detail?: string;
  readonly cause?: unknown;
  readonly instance?: string;
  readonly context?: unknown;
  readonly stack?: string;
}

/**
 * Veryfront Error class with slug-based error identity
 */
export class VeryfrontError extends Error {
  slug: string;
  category: ErrorCategory;
  status: number;
  title: string;
  suggestion?: string;
  detail?: string;
  override cause?: unknown;
  instance?: string;
  context?: unknown;

  constructor(message: string, options: VeryfrontErrorOptions) {
    super(message);
    this.name = "VeryfrontError";

    this.slug = options.slug;
    this.category = options.category;
    this.status = options.status;
    this.title = options.title;
    this.suggestion = options.suggestion;
    this.detail = options.detail;
    this.cause = options.cause;
    this.instance = options.instance;
    this.context = options.context;
  }

  /**
   * Convert to RFC 9457 Problem Details format
   */
  toRFC9457(): RFC9457Response {
    const snapshot = snapshotVeryfrontError(this);
    if (!snapshot) {
      return {
        type: buildErrorDocsUrl("unknown-error"),
        title: "Unknown/unclassified error",
        status: 500,
        category: "GENERAL",
      };
    }

    return {
      type: buildErrorDocsUrl(snapshot.slug),
      title: sanitizeBoundedDiagnosticText(snapshot.title),
      status: snapshot.status,
      detail: snapshot.detail === undefined
        ? undefined
        : sanitizeBoundedDiagnosticText(snapshot.detail),
      instance: snapshot.instance === undefined
        ? undefined
        : sanitizeBoundedDiagnosticText(snapshot.instance),
      category: snapshot.category,
      suggestion: snapshot.suggestion === undefined
        ? undefined
        : sanitizeBoundedDiagnosticText(snapshot.suggestion),
      cause: typeof snapshot.cause === "string"
        ? sanitizeBoundedDiagnosticText(snapshot.cause)
        : undefined,
    };
  }

  /**
   * Get documentation URL for this error
   */
  getDocsUrl(): string {
    const snapshot = snapshotVeryfrontError(this);
    return buildErrorDocsUrl(snapshot?.slug ?? "unknown-error");
  }
}

/** Runtime-safe VeryfrontError guard for values caught from untrusted code. */
export function isVeryfrontErrorInstance(error: unknown): error is VeryfrontError {
  try {
    return error instanceof VeryfrontError;
  } catch {
    return false;
  }
}

/**
 * Read a VeryfrontError once into plain data.
 *
 * A proxy can pass `instanceof VeryfrontError` and still throw from any field
 * getter. Boundary code must use this snapshot instead of repeatedly reading
 * the original object.
 */
export function snapshotVeryfrontError(error: unknown): VeryfrontErrorSnapshot | null {
  if (!isVeryfrontErrorInstance(error)) return null;
  return snapshotKnownVeryfrontError(error);
}

/**
 * Snapshot a value that has already been classified as a VeryfrontError.
 *
 * Keeping classification separate lets boundary code avoid a second
 * `instanceof`/proxy-prototype inspection after it has committed to this
 * branch.
 */
export function snapshotKnownVeryfrontError(
  error: VeryfrontError,
): VeryfrontErrorSnapshot | null {
  try {
    const slug = error.slug;
    const category = error.category;
    const status = error.status;
    const title = error.title;
    const message = error.message;
    const suggestion = error.suggestion;
    const detail = error.detail;
    const cause = error.cause;
    const instance = error.instance;
    const context = error.context;
    const stack = error.stack;

    if (
      typeof slug !== "string" ||
      !ERROR_CATEGORIES.has(category) ||
      typeof status !== "number" ||
      !Number.isFinite(status) ||
      typeof title !== "string" ||
      typeof message !== "string" ||
      (suggestion !== undefined && typeof suggestion !== "string") ||
      (detail !== undefined && typeof detail !== "string") ||
      (instance !== undefined && typeof instance !== "string") ||
      (stack !== undefined && typeof stack !== "string")
    ) {
      return null;
    }

    return {
      slug,
      category,
      status,
      title,
      message,
      suggestion,
      detail,
      cause,
      instance,
      context,
      stack,
    };
  } catch {
    return null;
  }
}
