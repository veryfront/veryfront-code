import { ErrorCode } from "../error-codes.js";
import { createSimpleError } from "./factory.js";
export const GENERAL_ERROR_CATALOG = {
    [ErrorCode.UNKNOWN_ERROR]: createSimpleError(ErrorCode.UNKNOWN_ERROR, "Unknown error", "An unexpected error occurred.", [
        "Check error details above",
        "Run 'veryfront doctor' to diagnose",
        "Try restarting the operation",
        "Check GitHub issues for similar problems",
    ]),
    [ErrorCode.PERMISSION_DENIED]: createSimpleError(ErrorCode.PERMISSION_DENIED, "Permission denied", "Insufficient permissions to perform operation.", [
        "Check file/directory permissions",
        "Run with appropriate permissions",
        "Verify user has write access",
    ]),
    [ErrorCode.FILE_NOT_FOUND]: createSimpleError(ErrorCode.FILE_NOT_FOUND, "File not found", "Required file does not exist.", [
        "Check that file path is correct",
        "Verify file exists in project",
        "Check for typos in file name",
    ]),
    [ErrorCode.INVALID_ARGUMENT]: createSimpleError(ErrorCode.INVALID_ARGUMENT, "Invalid argument", "Command received invalid argument.", [
        "Check command syntax",
        "Verify argument values",
        "Run 'veryfront help <command>' for usage",
    ]),
    [ErrorCode.TIMEOUT_ERROR]: createSimpleError(ErrorCode.TIMEOUT_ERROR, "Operation timed out", "Operation took too long to complete.", [
        "Check network connectivity",
        "Try increasing timeout if available",
        "Check for very large files",
    ]),
};
