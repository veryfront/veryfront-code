import * as dntShim from "../../../../_dnt.shims.js";
import type { Context, MiddlewareHandler, Next } from "../types.js";
import { createError, toError } from "../../../errors/veryfront-error.js";

export function composeMiddleware(
  globalMiddlewares: MiddlewareHandler[],
  registry: Array<{ pattern: RegExp; use: MiddlewareHandler[] }>,
): MiddlewareHandler {
  return (context: Context, finalNext: Next): Promise<dntShim.Response | undefined> => {
    let index = -1;
    const pathname = new URL(context.req.url).pathname;

    const chain: MiddlewareHandler[] = [...globalMiddlewares];
    for (const { pattern, use } of registry) {
      if (pattern.test(pathname)) chain.push(...use);
    }

    function dispatch(i: number): Promise<dntShim.Response | undefined> {
      if (i <= index) {
        throw toError(createError({ type: "api", message: "next() called multiple times" }));
      }

      index = i;

      if (i === chain.length) {
        const result = finalNext();
        return result instanceof Promise ? result : Promise.resolve(result);
      }

      const middleware = chain[i];
      if (!middleware) return Promise.resolve(undefined);

      const result = middleware(context, () => dispatch(i + 1));
      return result instanceof Promise ? result : Promise.resolve(result);
    }

    return dispatch(0);
  };
}
