export var ErrorCode;
(function (ErrorCode) {
    ErrorCode["FILE_NOT_FOUND"] = "FILE_NOT_FOUND";
    ErrorCode["BUILD_ERROR"] = "BUILD_ERROR";
    ErrorCode["CONFIG_ERROR"] = "CONFIG_ERROR";
    ErrorCode["COMPILATION_ERROR"] = "COMPILATION_ERROR";
    ErrorCode["NETWORK_ERROR"] = "NETWORK_ERROR";
    ErrorCode["PERMISSION_ERROR"] = "PERMISSION_ERROR";
    ErrorCode["RENDER_ERROR"] = "RENDER_ERROR";
    ErrorCode["INITIALIZATION_ERROR"] = "INITIALIZATION_ERROR";
    ErrorCode["AGENT_ERROR"] = "AGENT_ERROR";
    ErrorCode["AGENT_NOT_FOUND"] = "AGENT_NOT_FOUND";
    ErrorCode["AGENT_TIMEOUT"] = "AGENT_TIMEOUT";
    ErrorCode["AGENT_INTENT_ERROR"] = "AGENT_INTENT_ERROR";
    ErrorCode["ORCHESTRATION_ERROR"] = "ORCHESTRATION_ERROR";
    ErrorCode["NOT_SUPPORTED"] = "NOT_SUPPORTED";
    ErrorCode["SERVICE_OVERLOADED"] = "SERVICE_OVERLOADED";
})(ErrorCode || (ErrorCode = {}));
export class VeryfrontError extends Error {
    code;
    context;
    constructor(message, code, context) {
        super(message);
        this.name = "VeryfrontError";
        this.code = code;
        this.context = context;
    }
}
