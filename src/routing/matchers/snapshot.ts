import type { Route, RouteMatch } from "./types.ts";

/** Create an immutable route view without exposing matcher-owned arrays or regex state. */
export function snapshotRoute(route: Route): Route {
  const regex = route.regex
    ? Object.freeze(new RegExp(route.regex.source, route.regex.flags))
    : undefined;
  const paramNames = route.paramNames
    ? Object.freeze([...route.paramNames]) as string[]
    : undefined;

  return Object.freeze({
    pattern: route.pattern,
    page: route.page,
    ...(regex ? { regex } : {}),
    ...(paramNames ? { paramNames } : {}),
    ...(route.isCatchAll === undefined ? {} : { isCatchAll: route.isCatchAll }),
    ...(route.isOptionalCatchAll === undefined
      ? {}
      : { isOptionalCatchAll: route.isOptionalCatchAll }),
  });
}

/** Create the immutable cache value returned from collection matchers. */
export function snapshotRouteMatch(match: RouteMatch): RouteMatch {
  const params: Record<string, string | string[]> = {};
  for (const key of Reflect.ownKeys(match.params)) {
    if (typeof key !== "string") continue;
    const descriptor = Reflect.getOwnPropertyDescriptor(match.params, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) continue;
    const value = descriptor.value;
    Object.defineProperty(params, key, {
      configurable: false,
      enumerable: true,
      value: Array.isArray(value) ? Object.freeze([...value]) as string[] : value,
      writable: false,
    });
  }

  return Object.freeze({
    params: Object.freeze(params),
    route: snapshotRoute(match.route),
  });
}
