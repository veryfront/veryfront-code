import type { Middleware } from "../types.ts";
import { getRequest } from "../types.ts";
import type { CORSOptions } from "./types.ts";
import { corsSimple as createCorsSimple } from "#veryfront/security";
import type { Context } from "../../core/types.ts";

export function corsSimple(options: CORSOptions | string = "*"): Middleware {
  if (
    typeof options !== "string" &&
    (options === null || typeof options !== "object" || Array.isArray(options))
  ) {
    throw new TypeError("CORS options must be a string or object");
  }
  const origin = typeof options === "string" ? options : options.origin ?? "*";
  if (typeof origin !== "string") {
    throw new TypeError("CORS origin must be a string");
  }
  const middleware = createCorsSimple(origin);
  return (ctx, next) =>
    middleware(
      { req: getRequest(ctx) } as Context,
      next,
    );
}
