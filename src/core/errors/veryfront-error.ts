export interface BuildContext {
  file?: string;
  line?: number;
  column?: number;
  moduleId?: string;
  phase?: "parse" | "transform" | "bundle" | "optimize";
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

export function isBuildError(
  error: VeryfrontError,
): error is Extract<VeryfrontError, { type: "build" }> {
  return error.type === "build";
}

export function isAPIError(
  error: VeryfrontError,
): error is Extract<VeryfrontError, { type: "api" }> {
  return error.type === "api";
}

export function isRenderError(
  error: VeryfrontError,
): error is Extract<VeryfrontError, { type: "render" }> {
  return error.type === "render";
}

export function isConfigError(
  error: VeryfrontError,
): error is Extract<VeryfrontError, { type: "config" }> {
  return error.type === "config";
}

export function isAgentError(
  error: VeryfrontError,
): error is Extract<VeryfrontError, { type: "agent" }> {
  return error.type === "agent";
}

export function isFileError(
  error: VeryfrontError,
): error is Extract<VeryfrontError, { type: "file" }> {
  return error.type === "file";
}

export function isNetworkError(
  error: VeryfrontError,
): error is Extract<VeryfrontError, { type: "network" }> {
  return error.type === "network";
}

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
  if (error && typeof error === "object" && "context" in error) {
    // Safe access after 'in' check
    const context = (error as Record<string, unknown>).context;
    if (
      context &&
      typeof context === "object" &&
      "type" in context &&
      "message" in context
    ) {
      return context as VeryfrontError;
    }
  }
  return null;
}

export function logError(
  error: VeryfrontError,
  logger?: { error: (msg: string, ...args: unknown[]) => void },
): void {
  const log = logger || console;
  const context = "context" in error ? error.context || {} : {};
  log.error(`[${error.type}] ${error.message}`, context);
}
