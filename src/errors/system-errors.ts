import { VeryfrontError } from "./types.ts";
import type { RegisteredError } from "./types.ts";
import {
  FILE_NOT_FOUND,
  CONFIG_INVALID,
  NETWORK_ERROR,
  PERMISSION_DENIED,
  NOT_SUPPORTED,
} from "./error-registry.ts";

function createSystemErrorClass(name: string, errorDef: RegisteredError) {
  return class extends VeryfrontError {
    constructor(message: string, context?: unknown) {
      super(message, {
        slug: errorDef.slug,
        category: errorDef.category,
        status: errorDef.status,
        title: errorDef.title,
        suggestion: errorDef.suggestion,
        detail: message,
        context,
      });
      this.name = name;
    }
  };
}

export const FileSystemError = createSystemErrorClass("FileSystemError", FILE_NOT_FOUND);

export const ConfigError = createSystemErrorClass("ConfigError", CONFIG_INVALID);

export const NetworkError = createSystemErrorClass("NetworkError", NETWORK_ERROR);

export const PermissionError = createSystemErrorClass("PermissionError", PERMISSION_DENIED);

export const NotSupportedError = createSystemErrorClass("NotSupportedError", NOT_SUPPORTED);
