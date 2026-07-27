import type { Context, MiddlewareHandler, Next } from "../types.ts";
import { createError, toError } from "#veryfront/errors";

interface ScopedMiddleware {
  pattern: RegExp;
  use: MiddlewareHandler[];
}

function requireMiddleware(value: MiddlewareHandler, label: string): MiddlewareHandler {
  if (typeof value !== "function") {
    throw new TypeError(`${label} must be a function`);
  }
  return value;
}

function clonePattern(pattern: RegExp): RegExp {
  if (!(pattern instanceof RegExp)) {
    throw new TypeError("Middleware route pattern must be a RegExp");
  }
  return new RegExp(pattern.source, pattern.flags);
}

function matchesPathname(pattern: RegExp, pathname: string): boolean {
  pattern.lastIndex = 0;
  try {
    return pattern.test(pathname);
  } finally {
    pattern.lastIndex = 0;
  }
}

export function composeMiddleware(
  globalMiddlewares: MiddlewareHandler[],
  registry: ScopedMiddleware[],
): MiddlewareHandler {
  const middlewareSnapshot = [...globalMiddlewares].map((middleware, index) =>
    requireMiddleware(middleware, `Middleware at index ${index}`)
  );
  const registrySnapshot = [...registry].map(({ pattern, use }, registryIndex) => ({
    pattern: clonePattern(pattern),
    use: [...use].map((middleware, middlewareIndex) =>
      requireMiddleware(
        middleware,
        `Scoped middleware at registry index ${registryIndex}, handler index ${middlewareIndex}`,
      )
    ),
  }));

  return (context: Context, finalNext: Next): Promise<Response | undefined> => {
    let index = -1;
    const pathname = new URL(context.req.url).pathname;

    const chain: MiddlewareHandler[] = [...middlewareSnapshot];
    for (const { pattern, use } of registrySnapshot) {
      if (matchesPathname(pattern, pathname)) chain.push(...use);
    }

    function dispatch(i: number): Promise<Response | undefined> {
      if (i <= index) {
        throw toError(createError({ type: "api", message: "next() called multiple times" }));
      }

      index = i;

      if (i === chain.length) {
        return Promise.resolve(finalNext());
      }

      const middleware = chain[i]!;
      return Promise.resolve(middleware(context, () => dispatch(i + 1)));
    }

    return dispatch(0);
  };
}
