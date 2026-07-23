import type {
  Context,
  MiddlewareHandler,
  RuntimeMiddlewareHandler,
  RuntimeNext,
} from "../types.ts";
import { createError, toError } from "#veryfront/errors";
import type { RuntimeResponse } from "#veryfront/platform/adapters/base.ts";

function matchesPath(pattern: RegExp, pathname: string): boolean {
  const previousLastIndex = pattern.lastIndex;
  pattern.lastIndex = 0;
  try {
    return pattern.test(pathname);
  } finally {
    pattern.lastIndex = previousLastIndex;
  }
}

function assertMiddleware(value: unknown): asserts value is RuntimeMiddlewareHandler {
  if (typeof value !== "function") {
    throw new TypeError("middleware must be a function");
  }
}

export function composeMiddleware(
  globalMiddlewares: MiddlewareHandler[],
  registry: Array<{ pattern: RegExp; use: MiddlewareHandler[] }>,
): MiddlewareHandler;
export function composeMiddleware(
  globalMiddlewares: RuntimeMiddlewareHandler[],
  registry: Array<{ pattern: RegExp; use: RuntimeMiddlewareHandler[] }>,
): RuntimeMiddlewareHandler;
export function composeMiddleware(
  globalMiddlewares: Array<MiddlewareHandler | RuntimeMiddlewareHandler>,
  registry: Array<{
    pattern: RegExp;
    use: Array<MiddlewareHandler | RuntimeMiddlewareHandler>;
  }>,
): MiddlewareHandler | RuntimeMiddlewareHandler {
  if (!Array.isArray(globalMiddlewares) || !Array.isArray(registry)) {
    throw new TypeError("middleware and registry inputs must be arrays");
  }
  const globalSnapshot = globalMiddlewares.map((middleware) => {
    assertMiddleware(middleware);
    return middleware;
  });
  const registrySnapshot = registry.map((entry) => {
    if (!(entry?.pattern instanceof RegExp)) {
      throw new TypeError("middleware pattern must be a RegExp");
    }
    if (!Array.isArray(entry.use)) {
      throw new TypeError("scoped middleware must be an array");
    }
    const use = entry.use.map((middleware) => {
      assertMiddleware(middleware);
      return middleware;
    });
    return { pattern: new RegExp(entry.pattern.source, entry.pattern.flags), use };
  });

  return (context: Context, finalNext: RuntimeNext): Promise<RuntimeResponse | undefined> => {
    let index = -1;
    const pathname = new URL(context.req.url).pathname;

    const chain: RuntimeMiddlewareHandler[] = globalSnapshot.map((middleware) =>
      middleware as RuntimeMiddlewareHandler
    );
    for (const { pattern, use } of registrySnapshot) {
      if (matchesPath(pattern, pathname)) {
        chain.push(...use.map((middleware) => middleware as RuntimeMiddlewareHandler));
      }
    }

    function dispatch(i: number): Promise<RuntimeResponse | undefined> {
      if (i <= index) {
        throw toError(createError({ type: "api", message: "next() called multiple times" }));
      }

      index = i;

      if (i === chain.length) {
        return Promise.resolve(finalNext());
      }

      const middleware = chain[i];
      if (!middleware) return Promise.resolve(undefined);

      return Promise.resolve(middleware(context, () => dispatch(i + 1)));
    }

    return dispatch(0);
  };
}
