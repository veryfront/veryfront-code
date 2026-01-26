import { ErrorCode, VeryfrontError } from "./types.js";

class SystemError extends VeryfrontError {
  constructor(name: string, message: string, code: ErrorCode, context?: unknown) {
    super(message, code, context);
    this.name = name;
  }
}

export class FileSystemError extends SystemError {
  constructor(message: string, context?: unknown) {
    super("FileSystemError", message, ErrorCode.FILE_NOT_FOUND, context);
  }
}

export class ConfigError extends SystemError {
  constructor(message: string, context?: unknown) {
    super("ConfigError", message, ErrorCode.CONFIG_ERROR, context);
  }
}

export class NetworkError extends SystemError {
  constructor(message: string, context?: unknown) {
    super("NetworkError", message, ErrorCode.NETWORK_ERROR, context);
  }
}

export class PermissionError extends SystemError {
  constructor(message: string, context?: unknown) {
    super("PermissionError", message, ErrorCode.PERMISSION_ERROR, context);
  }
}

export class NotSupportedError extends SystemError {
  constructor(message: string, context?: unknown) {
    super("NotSupportedError", message, ErrorCode.NOT_SUPPORTED, context);
  }
}
