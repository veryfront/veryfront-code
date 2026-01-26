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
    | "circuit-breaker";
  /** Number of failures (for circuit breaker) */
  failures?: number;
  /** Missing dependencies list */
  missing?: Array<{ specifier: string; fromFile: string; reason: string }>;
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

export type VeryfrontError =
  | { type: "build"; message: string; context?: BuildContext }
  | { type: "api"; message: string; context?: APIContext }
  | { type: "render"; message: string; context?: RenderContext }
  | { type: "config"; message: string; context?: ConfigContext }
  | { type: "agent"; message: string; context?: AgentContext }
  | { type: "file"; message: string; context?: FileContext }
  | { type: "network"; message: string; context?: NetworkContext }
  | { type: "permission"; message: string; context?: FileContext }
  | { type: "not_supported"; message: string; feature?: string };

export function createError(error: VeryfrontError): VeryfrontError {
  return error;
}

/** Type guard factory for VeryfrontError types */
function isErrorType<T extends VeryfrontError["type"]>(
  type: T,
): (error: VeryfrontError) => error is Extract<VeryfrontError, { type: T }> {
  return (error): error is Extract<VeryfrontError, { type: T }> => error.type === type;
}

export const isBuildError = isErrorType("build");
export const isAPIError = isErrorType("api");
export const isRenderError = isErrorType("render");
export const isConfigError = isErrorType("config");
export const isAgentError = isErrorType("agent");
export const isFileError = isErrorType("file");
export const isNetworkError = isErrorType("network");

export function toError(veryfrontError: VeryfrontError): Error {
  const error = new Error(veryfrontError.message);
  error.name = `VeryfrontError[${veryfrontError.type}]`;
  Object.defineProperty(error, "context", {
    value: veryfrontError,
    enumerable: false,
    configurable: true,
  });
  return error;
}

export function fromError(error: unknown): VeryfrontError | null {
  if (!error || typeof error !== "object" || !("context" in error)) return null;

  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== "object") return null;

  if (!("type" in context) || !("message" in context)) return null;

  return context as VeryfrontError;
}

export function logError(
  error: VeryfrontError,
  logger?: { error: (msg: string, ...args: unknown[]) => void },
): void {
  const log = logger ?? console;
  const context = "context" in error ? error.context : {};
  log.error(`[${error.type}] ${error.message}`, context ?? {});
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
