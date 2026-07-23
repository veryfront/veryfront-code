import { hasUnsafeControlCharacters } from "./text-validation.ts";
import { sanitizeErrorInstance, sanitizeErrorText } from "./sanitization.ts";

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
  /** URI identifying the error type. */
  type: string;
  /** Stable, user-facing summary. */
  title: string;
  /** HTTP status associated with the problem. */
  status: number;
  /** Sanitized occurrence-specific explanation. */
  detail?: string;
  /** URI identifying this occurrence. */
  instance?: string;
  /** Veryfront error category. */
  category: ErrorCategory;
  /** Suggested corrective action. */
  suggestion?: string;
  /**
   * Legacy internal cause text.
   * @deprecated HTTP response helpers omit this field.
   */
  cause?: string;
}

/**
 * Error definition for the registry
 */
export interface ErrorDefinition {
  /** Stable lowercase kebab-case identity. */
  readonly slug: string;
  /** Domain category used for grouping. */
  readonly category: ErrorCategory;
  /** Default HTTP error status, from 400 through 599. */
  readonly status: number;
  /** Stable user-facing summary. */
  readonly title: string;
  /** Optional corrective action. */
  readonly suggestion?: string;
}

/**
 * Options for creating an error instance
 */
export interface ErrorCreateOptions {
  /** Override the error message (defaults to detail or definition title) */
  readonly message?: string;
  /** Occurrence-specific diagnostic text. */
  readonly detail?: string;
  /** Original failure retained for internal error chaining. */
  readonly cause?: unknown;
  /** URI identifying the error occurrence. */
  readonly instance?: string;
  /** Structured internal diagnostic context. */
  readonly context?: unknown;
  /** Override the definition's default HTTP error status, from 400 through 599. */
  readonly status?: number;
}

/**
 * Registered error with factory method
 */
export interface RegisteredError extends ErrorDefinition {
  /** Create an error occurrence from this immutable definition. */
  create(options?: ErrorCreateOptions): VeryfrontError;
}

/** Immutable category fragment used to assemble the central error registry. */
export type ErrorRegistryFragment<TSlug extends string> = Readonly<
  Record<TSlug, RegisteredError>
>;

const ERROR_CATEGORIES: ReadonlySet<string> = new Set<ErrorCategory>([
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
const ERROR_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertString(
  value: unknown,
  name: string,
  maximumLength: number,
  allowEmpty = false,
  allowFormattingWhitespace = false,
): string {
  if (
    typeof value !== "string" || value.length > maximumLength ||
    (!allowEmpty && value.trim().length === 0) ||
    hasUnsafeControlCharacters(value, allowFormattingWhitespace)
  ) {
    throw new TypeError(`${name} must be a valid string`);
  }
  return value;
}

function assertStatus(value: unknown, name = "status"): number {
  if (!Number.isInteger(value) || (value as number) < 400 || (value as number) > 599) {
    throw new TypeError(`${name} must be an integer between 400 and 599`);
  }
  return value as number;
}

function assertCategory(value: unknown): ErrorCategory {
  if (typeof value !== "string" || !ERROR_CATEGORIES.has(value)) {
    throw new TypeError("category is invalid");
  }
  return value as ErrorCategory;
}

function snapshotDefinition(definition: ErrorDefinition): Readonly<ErrorDefinition> {
  try {
    if (!definition || typeof definition !== "object") {
      throw new TypeError("definition must be an object");
    }
    const slugValue = definition.slug;
    const categoryValue = definition.category;
    const statusValue = definition.status;
    const titleValue = definition.title;
    const suggestionValue = definition.suggestion;
    const slug = assertString(slugValue, "slug", 128);
    if (!ERROR_SLUG_PATTERN.test(slug)) {
      throw new TypeError("slug must use lowercase kebab case");
    }
    const suggestion = suggestionValue === undefined
      ? undefined
      : assertString(suggestionValue, "suggestion", 4_096, true);
    return Object.freeze({
      slug,
      category: assertCategory(categoryValue),
      status: assertStatus(statusValue),
      title: assertString(titleValue, "title", 512),
      suggestion,
    });
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("Invalid error definition");
  }
}

function snapshotCreateOptions(options?: ErrorCreateOptions): ErrorCreateOptions {
  if (options === undefined) return {};
  try {
    if (!options || typeof options !== "object") {
      throw new TypeError("options must be an object");
    }
    const message = options.message;
    const detail = options.detail;
    const cause = options.cause;
    const instance = options.instance;
    const context = options.context;
    const status = options.status;
    return {
      message: message === undefined
        ? undefined
        : assertString(message, "message", 4_096, true, true),
      detail: detail === undefined ? undefined : assertString(detail, "detail", 16_384, true, true),
      cause,
      instance: instance === undefined
        ? undefined
        : assertString(instance, "instance", 4_096, true),
      context,
      status: status === undefined ? undefined : assertStatus(status),
    };
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("Invalid error options");
  }
}

/**
 * Define an error in the registry
 */
export function defineError(definition: ErrorDefinition): RegisteredError {
  const snapshot = snapshotDefinition(definition);
  return Object.freeze({
    ...snapshot,
    create(options?: ErrorCreateOptions): VeryfrontError {
      const createOptions = snapshotCreateOptions(options);
      return new VeryfrontError(
        createOptions.message || createOptions.detail || snapshot.title,
        {
          slug: snapshot.slug,
          category: snapshot.category,
          status: createOptions.status ?? snapshot.status,
          title: snapshot.title,
          suggestion: snapshot.suggestion,
          detail: createOptions.detail,
          cause: createOptions.cause,
          instance: createOptions.instance,
          context: createOptions.context,
        },
      );
    },
  });
}

/**
 * Options for VeryfrontError constructor
 */
export interface VeryfrontErrorOptions extends ErrorCreateOptions {
  /** Stable lowercase kebab-case identity. */
  readonly slug: string;
  /** Domain category used for grouping. */
  readonly category: ErrorCategory;
  /** HTTP error status from 400 through 599. */
  readonly status: number;
  /** Stable user-facing summary. */
  readonly title: string;
  /** Optional corrective action. */
  readonly suggestion?: string;
}

function snapshotVeryfrontErrorOptions(
  options: VeryfrontErrorOptions,
): VeryfrontErrorOptions {
  try {
    if (!options || typeof options !== "object") {
      throw new TypeError("options must be an object");
    }
    const slug = options.slug;
    const category = options.category;
    const status = options.status;
    const title = options.title;
    const suggestion = options.suggestion;
    const detail = options.detail;
    const cause = options.cause;
    const instance = options.instance;
    const context = options.context;
    const validatedSlug = assertString(slug, "slug", 128);
    if (!ERROR_SLUG_PATTERN.test(validatedSlug)) {
      throw new TypeError("slug must use lowercase kebab case");
    }
    return {
      slug: validatedSlug,
      category: assertCategory(category),
      status: assertStatus(status),
      title: assertString(title, "title", 512),
      suggestion: suggestion === undefined
        ? undefined
        : assertString(suggestion, "suggestion", 4_096, true),
      detail: detail === undefined ? undefined : assertString(detail, "detail", 16_384, true, true),
      cause,
      instance: instance === undefined
        ? undefined
        : assertString(instance, "instance", 4_096, true),
      context,
    };
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("Invalid error options");
  }
}

/**
 * Veryfront Error class with slug-based error identity
 */
export class VeryfrontError extends Error {
  /** Stable lowercase kebab-case identity. */
  slug: string;
  /** Domain category used for grouping. */
  category: ErrorCategory;
  /** HTTP error status from 400 through 599. */
  status: number;
  /** Stable user-facing summary. */
  title: string;
  /** Optional corrective action. */
  suggestion?: string;
  /** Occurrence-specific diagnostic text. */
  detail?: string;
  /** Original internal failure. */
  override cause?: unknown;
  /** URI identifying the error occurrence. */
  instance?: string;
  /** Structured internal diagnostic context. */
  context?: unknown;

  /** Create a validated Veryfront error. */
  constructor(message: string, options: VeryfrontErrorOptions) {
    const validatedMessage = assertString(message, "message", 16_384, true, true);
    const snapshot = snapshotVeryfrontErrorOptions(options);
    super(validatedMessage);
    this.name = "VeryfrontError";

    this.slug = snapshot.slug;
    this.category = snapshot.category;
    this.status = snapshot.status;
    this.title = snapshot.title;
    this.suggestion = snapshot.suggestion;
    this.detail = snapshot.detail;
    this.cause = snapshot.cause;
    this.instance = snapshot.instance;
    this.context = snapshot.context;
  }

  /**
   * Convert to RFC 9457 Problem Details format
   */
  toRFC9457(): RFC9457Response {
    try {
      const slug = assertString(this.slug, "slug", 128);
      if (!ERROR_SLUG_PATTERN.test(slug)) throw new TypeError("Invalid error slug");
      const title = assertString(this.title, "title", 512);
      const detail = this.detail;
      const suggestion = this.suggestion;
      const instance = this.instance;
      const cause = this.cause;
      return {
        type: `https://veryfront.com/docs/errors/${slug}`,
        title: sanitizeErrorText(title, 512),
        status: assertStatus(this.status),
        detail: typeof detail === "string" ? sanitizeErrorText(detail, 16_384) : undefined,
        instance: typeof instance === "string" ? sanitizeErrorInstance(instance) : undefined,
        category: assertCategory(this.category),
        suggestion: typeof suggestion === "string"
          ? sanitizeErrorText(suggestion, 4_096)
          : undefined,
        cause: typeof cause === "string" ? sanitizeErrorText(cause, 4_096) : undefined,
      };
    } catch {
      return {
        type: "https://veryfront.com/docs/errors/unknown-error",
        title: "Unknown/unclassified error",
        status: 500,
        category: "GENERAL",
        suggestion: "Check logs for more details",
      };
    }
  }

  /**
   * Get documentation URL for this error
   */
  getDocsUrl(): string {
    try {
      const slug = assertString(this.slug, "slug", 128);
      if (!ERROR_SLUG_PATTERN.test(slug)) throw new TypeError("Invalid error slug");
      return `https://veryfront.com/docs/errors/${slug}`;
    } catch {
      return "https://veryfront.com/docs/errors/unknown-error";
    }
  }
}
