import { ErrorCode, VeryfrontError } from "./types.js";
class SystemError extends VeryfrontError {
    constructor(name, message, code, context) {
        super(message, code, context);
        this.name = name;
    }
}
export class FileSystemError extends SystemError {
    constructor(message, context) {
        super("FileSystemError", message, ErrorCode.FILE_NOT_FOUND, context);
    }
}
export class ConfigError extends SystemError {
    constructor(message, context) {
        super("ConfigError", message, ErrorCode.CONFIG_ERROR, context);
    }
}
export class NetworkError extends SystemError {
    constructor(message, context) {
        super("NetworkError", message, ErrorCode.NETWORK_ERROR, context);
    }
}
export class PermissionError extends SystemError {
    constructor(message, context) {
        super("PermissionError", message, ErrorCode.PERMISSION_ERROR, context);
    }
}
export class NotSupportedError extends SystemError {
    constructor(message, context) {
        super("NotSupportedError", message, ErrorCode.NOT_SUPPORTED, context);
    }
}
