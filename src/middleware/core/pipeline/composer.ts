import type { Context, MiddlewareHandler, Next } from "../types.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

export function composeMiddleware(
  globalMiddlewares: MiddlewareHandler[],
  registry: Array<{ pattern: RegExp; use: MiddlewareHandler[] }>,
): MiddlewareHandler {
  return (context: Context, finalNext: Next): Promise<Response | undefined> => {
    let index = -1;

    const url = new URL(context.req.url);
    const pathname = url.pathname;

    const scoped: MiddlewareHandler[] = [];
    for (const entry of registry) {
      if (entry.pattern.test(pathname)) {
        scoped.push(...entry.use);
      }
    }
    const chain = [...globalMiddlewares, ...scoped];

    const dispatch = async (i: number): Promise<Response | undefined> => {
      if (i <= index) {
        throw toError(createError({ type: "api", message: "next() called multiple times" }));
      }

      index = i;

      if (i === chain.length) {
        return finalNext();
      }

      const middleware = chain[i]!;
      return await middleware(context, () => dispatch(i + 1));
    };

    return dispatch(0);
  };
}
