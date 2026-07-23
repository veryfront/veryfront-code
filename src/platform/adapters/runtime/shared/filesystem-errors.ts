import {
  FILE_NOT_FOUND,
  INVALID_ARGUMENT,
  PERMISSION_DENIED,
  UNKNOWN_ERROR,
} from "#veryfront/errors/error-registry/general.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";

const MISSING_FILE_CODES = new Set(["ENOENT", "ENOTDIR"]);
const MISSING_FILE_NAMES = new Set(["NotFound", "NotADirectory"]);
const PERMISSION_CODES = new Set(["EACCES", "EPERM"]);
const PERMISSION_NAMES = new Set(["NotCapable", "PermissionDenied"]);

export function getSystemErrorCode(error: unknown): string | undefined {
  if ((typeof error !== "object" && typeof error !== "function") || error === null) {
    return undefined;
  }

  try {
    const code = Reflect.get(error, "code");
    return typeof code === "string" && code.length <= 64 ? code : undefined;
  } catch {
    return undefined;
  }
}

export function isFileNotFoundError(error: unknown): boolean {
  const code = getSystemErrorCode(error);
  if (code && MISSING_FILE_CODES.has(code)) return true;

  if ((typeof error !== "object" && typeof error !== "function") || error === null) {
    return false;
  }

  try {
    const name = Reflect.get(error, "name");
    return typeof name === "string" && MISSING_FILE_NAMES.has(name);
  } catch {
    return false;
  }
}

export function createFileOperationError(
  error: unknown,
  operation: "create" | "read" | "stat",
): VeryfrontError {
  if (error instanceof VeryfrontError) return error;

  const operationMessage = operation === "read"
    ? "Unable to read file"
    : operation === "create"
    ? "Unable to create directory"
    : "Unable to stat file";
  if (isFileNotFoundError(error)) {
    return FILE_NOT_FOUND.create({ message: `${operationMessage}: file not found` });
  }

  const code = getSystemErrorCode(error);
  const name = getErrorName(error);
  if ((code && PERMISSION_CODES.has(code)) || (name && PERMISSION_NAMES.has(name))) {
    return PERMISSION_DENIED.create({ message: `${operationMessage}: permission denied` });
  }
  if (code === "EINVAL" || code === "ERR_INVALID_ARG_VALUE" || name === "TypeError") {
    return INVALID_ARGUMENT.create({ message: `${operationMessage}: invalid path` });
  }
  return UNKNOWN_ERROR.create({ message: operationMessage });
}

function getErrorName(error: unknown): string | undefined {
  if ((typeof error !== "object" && typeof error !== "function") || error === null) {
    return undefined;
  }
  try {
    const name = Reflect.get(error, "name");
    return typeof name === "string" && name.length <= 64 ? name : undefined;
  } catch {
    return undefined;
  }
}
