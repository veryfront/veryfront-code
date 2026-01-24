import type { Context, MiddlewareHandler, Next } from "../types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

export function composeMiddleware(
  globalMiddlewares: MiddlewareHandler[],
  registry: Array<{ pattern: RegExp; use: MiddlewareHandler[] }>,
): MiddlewareHandler {
  return (context: Context, finalNext: Next): Promise<Response | undefined> => {
    let index = -1;
    const pathname = new URL(context.req.url).pathname;

    const chain: MiddlewareHandler[] = [...globalMiddlewares];
    for (const { pattern, use } of registry) {
      if (pattern.test(pathname)) chain.push(...use);
    }

    function dispatch(i: number): Promise<Response | undefined> {
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
