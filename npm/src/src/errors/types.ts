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
  SERVICE_OVERLOADED = "SERVICE_OVERLOADED",
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
