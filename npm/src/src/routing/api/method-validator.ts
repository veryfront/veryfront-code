import * as dntShim from "../../../_dnt.shims.js";
import { methodNotAllowed } from "../../platform/compat/http/responses.js";
import type { HTTPMethod } from "./module-loader/types.js";

const HTTP_METHODS: HTTPMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export function createAppRouteMethodNotAllowed(handlerModule: Record<string, unknown>): dntShim.Response {
  const allowed = HTTP_METHODS.filter((method) => typeof handlerModule[method] === "function");
  return methodNotAllowed(allowed);
}

export function createPagesRouteMethodNotAllowed(handler: Record<string, unknown>): dntShim.Response {
  const allowed = Object.keys(handler).filter(
    (method) => method !== "default" && typeof handler[method] === "function",
  );
  return methodNotAllowed(allowed);
}
