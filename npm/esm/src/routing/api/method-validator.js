import { methodNotAllowed } from "../../platform/compat/http/responses.js";
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
export function createAppRouteMethodNotAllowed(handlerModule) {
    const allowed = HTTP_METHODS.filter((method) => typeof handlerModule[method] === "function");
    return methodNotAllowed(allowed);
}
export function createPagesRouteMethodNotAllowed(handler) {
    const allowed = Object.keys(handler).filter((method) => method !== "default" && typeof handler[method] === "function");
    return methodNotAllowed(allowed);
}
