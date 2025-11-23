import {
  type AgentContext,
  type BuildContext,
  type ConfigContext,
  createError,
  type FileContext,
  toError,
} from "./veryfront-error.ts";

export enum ErrorCode {
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  BUILD_ERROR = "BUILD_ERROR",
  CONFIG_ERROR = "CONFIG_ERROR",
  COMPILATION_ERROR = "COMPILATION_ERROR",
  NETWORK_ERROR = "NETWORK_ERROR",
  PERMISSION_ERROR = "PERMISSION_ERROR",
  RENDER_ERROR = "RENDER_ERROR",
  INITIALIZATION_ERROR = "INITIALIZATION_ERROR",
  AGENT_ERROR = "AGENT_ERROR",
  AGENT_NOT_FOUND = "AGENT_NOT_FOUND",
  AGENT_TIMEOUT = "AGENT_TIMEOUT",
  AGENT_INTENT_ERROR = "AGENT_INTENT_ERROR",
  ORCHESTRATION_ERROR = "ORCHESTRATION_ERROR",
  NOT_SUPPORTED = "NOT_SUPPORTED",
}

export class VeryfrontError extends Error {
  public code: ErrorCode;
  public context?: unknown;

  constructor(message: string, code: ErrorCode, context?: unknown) {
    super(message);
    this.name = "VeryfrontError";
    this.code = code;
    this.context = context;
  }
}

export class CompilationError extends Error {
  constructor(message: string, context?: BuildContext) {
    super(message);
    this.name = "CompilationError";
    const err = createError({ type: "build", message, context });
    Object.setPrototypeOf(this, toError(err));
  }
}

export class BuildError extends Error {
  constructor(message: string, context?: BuildContext) {
    super(message);
    this.name = "BuildError";
    const err = createError({ type: "build", message, context });
    Object.setPrototypeOf(this, toError(err));
  }
}

export class ConfigError extends Error {
  constructor(message: string, context?: ConfigContext) {
    super(message);
    this.name = "ConfigError";
    const err = createError({ type: "config", message, context });
    Object.setPrototypeOf(this, toError(err));
  }
}

export class FileSystemError extends Error {
  constructor(message: string, context?: FileContext) {
    super(message);
    this.name = "FileSystemError";
    const err = createError({ type: "file", message, context });
    Object.setPrototypeOf(this, toError(err));
  }
}

export class NotSupportedError extends Error {
  constructor(message: string, feature?: string) {
    super(message);
    this.name = "NotSupportedError";
    const err = createError({ type: "not_supported", message, feature });
    Object.setPrototypeOf(this, toError(err));
  }
}

export class NetworkError extends Error {
  constructor(message: string, context?: unknown) {
    super(message);
    this.name = "NetworkError";
    const err = createError({
      type: "network",
      message,
      context: { url: "", ...(context as Record<string, unknown>) },
    });
    Object.setPrototypeOf(this, toError(err));
  }
}

export class PermissionError extends Error {
  constructor(message: string, context?: FileContext) {
    super(message);
    this.name = "PermissionError";
    const err = createError({ type: "permission", message, context });
    Object.setPrototypeOf(this, toError(err));
  }
}

export class RenderError extends Error {
  constructor(message: string, context?: unknown) {
    super(message);
    this.name = "RenderError";
    const err = createError({
      type: "render",
      message,
      context: { component: "", ...(context as Record<string, unknown>) },
    });
    Object.setPrototypeOf(this, toError(err));
  }
}

export class RuntimeError extends Error {
  constructor(message: string, context?: unknown) {
    super(message);
    this.name = "RuntimeError";
    const err = createError({
      type: "render",
      message,
      context: { phase: "server", ...(context as Record<string, unknown>) },
    });
    Object.setPrototypeOf(this, toError(err));
  }
}

export class AgentError extends Error {
  constructor(message: string, context?: AgentContext) {
    super(message);
    this.name = "AgentError";
    const err = createError({ type: "agent", message, context });
    Object.setPrototypeOf(this, toError(err));
  }
}

export class AgentNotFoundError extends Error {
  constructor(agentId: string, context?: unknown) {
    const message = `Agent with ID '${agentId}' not found`;
    super(message);
    this.name = "AgentNotFoundError";
    const err = createError({
      type: "agent",
      message,
      context: { agentId, ...(context as Record<string, unknown>) },
    });
    Object.setPrototypeOf(this, toError(err));
  }
}

export class AgentTimeoutError extends Error {
  constructor(message: string, context?: unknown) {
    super(message);
    this.name = "AgentTimeoutError";
    const err = createError({
      type: "agent",
      message,
      context: { timeout: 0, ...(context as Record<string, unknown>) },
    });
    Object.setPrototypeOf(this, toError(err));
  }
}

export class AgentIntentError extends Error {
  constructor(message: string, context?: unknown) {
    super(message);
    this.name = "AgentIntentError";
    const err = createError({
      type: "agent",
      message,
      context: { intent: "", ...(context as Record<string, unknown>) },
    });
    Object.setPrototypeOf(this, toError(err));
  }
}

export class OrchestrationError extends Error {
  constructor(message: string, context?: unknown) {
    super(message);
    this.name = "OrchestrationError";
    const err = createError({
      type: "agent",
      message,
      context: context as AgentContext,
    });
    Object.setPrototypeOf(this, toError(err));
  }
}

export async function handleErrorWithFallback<T>(
  fn: () => T | Promise<T>,
  _fallback: T,
  _logger?: unknown,
): Promise<T> {
  return await fn();
}

export function handleErrorWithFallbackSync<T>(
  fn: () => T,
  _fallback: T,
  _logger?: unknown,
): T {
  return fn();
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  _options?: unknown,
): Promise<T> {
  return await fn();
}

export function wrapError(
  error: unknown,
  message: string,
  _context?: unknown,
): Error {
  const originalError = error instanceof Error ? error : new Error(String(error));
  return new Error(`${message}: ${originalError.message}`);
}

export const ERROR_CATALOG = {};
export const CONFIG_ERROR_CATALOG = {};
export const BUILD_ERROR_CATALOG = {};
export const RUNTIME_ERROR_CATALOG = {};
export const ROUTE_ERROR_CATALOG = {};
export const MODULE_ERROR_CATALOG = {};
export const SERVER_ERROR_CATALOG = {};
export const RSC_ERROR_CATALOG = {};
export const DEV_ERROR_CATALOG = {};
export const DEPLOYMENT_ERROR_CATALOG = {};
export const GENERAL_ERROR_CATALOG = {};

export const getErrorSolution = () => null;
export const searchErrors = () => [];
export const createErrorSolution = () => ({});
export const createSimpleError = (msg: string) => new Error(msg);

export const ERROR_SOLUTIONS = {};
export const formatUserError = (error: unknown) => String(error);
export const identifyError = () => null;
export const wrapErrorHandler = <T extends (...args: unknown[]) => unknown>(fn: T): T => fn;

export type ErrorSolution = unknown;
export type ErrorCatalog = unknown;
export type PartialErrorCatalog = unknown;
export type UserFriendlyErrorSolution = unknown;
export type ErrorCodeType = string;
