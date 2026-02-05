import { ErrorCode, VeryfrontError } from "./types.ts";
import type { ErrorCodeType } from "./types.ts";

class SystemError extends VeryfrontError {
  constructor(name: string, message: string, code: ErrorCodeType, context?: unknown) {
    super(message, code, context);
    this.name = name;
  }
}

function createSystemErrorClass(name: string, code: ErrorCodeType) {
  return class extends SystemError {
    constructor(message: string, context?: unknown) {
      super(name, message, code, context);
    }
  };
}

export const FileSystemError = createSystemErrorClass(
  "FileSystemError",
  ErrorCode.FILE_NOT_FOUND,
);

export const ConfigError = createSystemErrorClass("ConfigError", ErrorCode.CONFIG_ERROR);

export const NetworkError = createSystemErrorClass("NetworkError", ErrorCode.NETWORK_ERROR);

export const PermissionError = createSystemErrorClass(
  "PermissionError",
  ErrorCode.PERMISSION_ERROR,
);

export const NotSupportedError = createSystemErrorClass(
  "NotSupportedError",
  ErrorCode.NOT_SUPPORTED,
);
