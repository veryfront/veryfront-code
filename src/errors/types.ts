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
export interface RegisteredError extends ErrorDefinition {
  create(options?: ErrorCreateOptions): VeryfrontError;
}

/**
 * Define an error in the registry
 */
export function defineError(definition: ErrorDefinition): RegisteredError {
  return {
    ...definition,
    create(options?: ErrorCreateOptions): VeryfrontError {
      return new VeryfrontError(options?.detail || definition.title, {
        slug: definition.slug,
        category: definition.category,
        status: options?.status ?? definition.status,
        title: definition.title,
        suggestion: definition.suggestion,
        detail: options?.detail,
        cause: options?.cause,
        instance: options?.instance,
        context: options?.context,
      });
    },
  };
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

/**
 * Veryfront Error class with slug-based error identity
 */
export class VeryfrontError extends Error {
  public slug: string;
  public category: ErrorCategory;
  public status: number;
  public title: string;
  public suggestion?: string;
  public detail?: string;
  public override cause?: unknown;
  public instance?: string;
  public context?: unknown;

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
    return {
      type: `https://veryfront.com/docs/errors/${this.slug}`,
      title: this.title,
      status: this.status,
      detail: this.detail,
      instance: this.instance,
      category: this.category,
      suggestion: this.suggestion,
      cause: typeof this.cause === "string" ? this.cause : undefined,
    };
  }

  /**
   * Get documentation URL for this error
   */
  getDocsUrl(): string {
    return `https://veryfront.com/docs/errors/${this.slug}`;
  }
}
