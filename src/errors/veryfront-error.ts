export interface BuildContext {
  file?: string;
  line?: number;
  column?: number;
  moduleId?: string;
  phase?:
    | "parse"
    | "transform"
    | "bundle"
    | "optimize"
    | "dependency-resolution"
    | "circuit-breaker"
    | "http-bundle-validation";
  /** Number of failures (for circuit breaker) */
  failures?: number;
  /** Missing dependencies list */
  missing?: Array<{ specifier: string; fromFile: string; reason: string }>;
  /** Failed HTTP bundle specifiers */
  failed?: string[];
  /** Cache directory path */
  cacheDir?: string;
}

export interface APIContext {
  endpoint?: string;
  method?: string;
  statusCode?: number;
  headers?: Record<string, string>;
}

export interface RenderContext {
  component?: string;
  route?: string;
  phase?: "server" | "client" | "hydration";
  props?: unknown;
}

export interface ConfigContext {
  configFile?: string;
  field?: string;
  value?: unknown;
  expected?: string;
}

export interface AgentContext {
  agentId?: string;
  intent?: string;
  timeout?: number;
}

export interface FileContext {
  path?: string;
  operation?: "read" | "write" | "delete" | "mkdir";
  permissions?: string;
}

export interface NetworkContext {
  url?: string;
  timeout?: number;
  retryCount?: number;
}

/**
 * Discriminated union for serializable error data.
 *
 * This represents error DATA (plain objects), not throwable errors.
 * For throwable errors, use `VeryfrontError` class from `./types.ts`.
 */
export type VeryfrontErrorData =
  | { type: "build"; message: string; context?: BuildContext }
  | { type: "api"; message: string; context?: APIContext }
  | { type: "render"; message: string; context?: RenderContext }
  | { type: "config"; message: string; context?: ConfigContext }
  | { type: "agent"; message: string; context?: AgentContext }
  | { type: "file"; message: string; context?: FileContext }
  | { type: "network"; message: string; context?: NetworkContext }
  | { type: "permission"; message: string; context?: FileContext }
  | { type: "not_supported"; message: string; feature?: string }
  | { type: "no_ai_available"; message: string };

export function createError(error: VeryfrontErrorData): VeryfrontErrorData {
  return error;
}

/** Type guard factory for VeryfrontErrorData types */
function isErrorType<T extends VeryfrontErrorData["type"]>(
  type: T,
): (error: VeryfrontErrorData) => error is Extract<VeryfrontErrorData, { type: T }> {
  return (error): error is Extract<VeryfrontErrorData, { type: T }> => error.type === type;
}

export const isBuildError = isErrorType("build");
export const isAPIError = isErrorType("api");
export const isRenderError = isErrorType("render");
export const isConfigError = isErrorType("config");
export const isAgentError = isErrorType("agent");
export const isFileError = isErrorType("file");
export const isNetworkError = isErrorType("network");

/**
 * Convert a VeryfrontErrorData (plain object) to a throwable Error instance.
 *
 * Uses Error.captureStackTrace when available (V8 engines) to exclude toError()
 * from the stack trace, making the stack point to the actual call site.
 *
 * @see plans/architecture-audit/010.3-dual-veryfront-error-definitions.md
 */
export function toError(veryfrontError: VeryfrontErrorData): Error {
  const error = new Error(veryfrontError.message);
  error.name = `VeryfrontError[${veryfrontError.type}]`;

  // Capture stack at call site, excluding toError from the trace
  // This makes debugging easier by showing where createError+toError was called
  if (Error.captureStackTrace) Error.captureStackTrace(error, toError);

  Object.defineProperty(error, "context", {
    value: veryfrontError,
    enumerable: false,
    configurable: true,
  });

  return error;
}

export function fromError(error: unknown): VeryfrontErrorData | null {
  if (!error || typeof error !== "object" || !("context" in error)) return null;

  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== "object") return null;
  if (!("type" in context) || !("message" in context)) return null;

  return context as VeryfrontErrorData;
}

/**
 * Extract error message from any error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Ensure error is an Error instance
 */
export function ensureError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}
