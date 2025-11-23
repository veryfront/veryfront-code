import { ErrorCode, VeryfrontError } from "./types.ts";

export class FileSystemError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, ErrorCode.FILE_NOT_FOUND, context);
    this.name = "FileSystemError";
  }
}

export class ConfigError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, ErrorCode.CONFIG_ERROR, context);
    this.name = "ConfigError";
  }
}

export class NetworkError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, ErrorCode.NETWORK_ERROR, context);
    this.name = "NetworkError";
  }
}

export class PermissionError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, ErrorCode.PERMISSION_ERROR, context);
    this.name = "PermissionError";
  }
}

export class NotSupportedError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, ErrorCode.NOT_SUPPORTED, context);
    this.name = "NotSupportedError";
  }
}
