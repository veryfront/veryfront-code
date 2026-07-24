/**
 * Canonical HTTP-method resolution shared by in-process API execution,
 * isolated workers, method-not-allowed responses, and capability discovery.
 */

/** Standard methods advertised for a callable default route export. */
export const STANDARD_ROUTE_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;

const HTTP_METHOD_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Z]+$/;
const MAX_HTTP_METHOD_LENGTH = 64;
const apply = Reflect.apply;
const arrayIncludes = Array.prototype.includes;
const arrayPush = Array.prototype.push;
const arraySort = Array.prototype.sort;
const objectEntries = Object.entries;
const objectHasOwn = Object.hasOwn;
const regexpTest = RegExp.prototype.test;
const stringToUpperCase = String.prototype.toUpperCase;

/** Snapshot one request method as a bounded, canonical HTTP token. */
export function normalizeRouteMethod(method: unknown): string | null {
  if (typeof method !== "string") return null;

  const normalized = apply(stringToUpperCase, method, []) as string;
  if (
    normalized.length === 0 ||
    normalized.length > MAX_HTTP_METHOD_LENGTH ||
    !apply(regexpTest, HTTP_METHOD_TOKEN_PATTERN, [normalized])
  ) {
    return null;
  }
  return normalized;
}

function ownCallableExport(
  routeModule: Record<string, unknown>,
  exportName: string,
): ((...args: unknown[]) => unknown) | undefined {
  if (!apply(objectHasOwn, Object, [routeModule, exportName])) return undefined;
  const candidate = routeModule[exportName];
  return typeof candidate === "function" ? candidate as (...args: unknown[]) => unknown : undefined;
}

/**
 * Resolve the function an API request executes.
 *
 * Compatibility order is intentional: an exact method export wins, then the
 * default export, then GET supplies the conventional HEAD fallback.
 */
export function resolveRouteHandlerExport(
  routeModule: Record<string, unknown>,
  method: unknown,
): ((...args: unknown[]) => unknown) | undefined {
  const normalized = normalizeRouteMethod(method);
  if (!normalized) return undefined;

  return ownCallableExport(routeModule, normalized) ??
    ownCallableExport(routeModule, "default") ??
    (normalized === "HEAD" ? ownCallableExport(routeModule, "GET") : undefined);
}

/**
 * Return the method surface the canonical resolver can execute.
 *
 * OPTIONS is always framework-reachable for a matched route. A default export
 * supports the standard surface plus the one bounded custom method currently
 * being probed (for example, a CORS PROPFIND preflight).
 */
export function resolveExecutableRouteMethods(
  routeModule: Record<string, unknown>,
  requestedMethod?: unknown,
  options: { includeFrameworkOptions?: boolean } = {},
): string[] {
  const methods: string[] = [];
  const addMethod = (method: string): void => {
    if (!apply(arrayIncludes, methods, [method])) {
      apply(arrayPush, methods, [method]);
    }
  };
  const hasDefault = ownCallableExport(routeModule, "default") !== undefined;

  if (hasDefault) {
    for (let index = 0; index < STANDARD_ROUTE_METHODS.length; index++) {
      addMethod(STANDARD_ROUTE_METHODS[index]!);
    }
    const requested = normalizeRouteMethod(requestedMethod);
    if (requested) addMethod(requested);
  } else {
    const entries = apply(objectEntries, Object, [routeModule]) as [string, unknown][];
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!;
      const exportName = entry[0];
      const value = entry[1];
      if (
        exportName === apply(stringToUpperCase, exportName, []) &&
        normalizeRouteMethod(exportName) === exportName &&
        typeof value === "function"
      ) {
        addMethod(exportName);
      }
    }
    if (apply(arrayIncludes, methods, ["GET"])) addMethod("HEAD");
    if (options.includeFrameworkOptions !== false) addMethod("OPTIONS");
  }

  const standard: string[] = [];
  const custom: string[] = [];
  for (let index = 0; index < STANDARD_ROUTE_METHODS.length; index++) {
    const method = STANDARD_ROUTE_METHODS[index]!;
    if (apply(arrayIncludes, methods, [method])) apply(arrayPush, standard, [method]);
  }
  for (let index = 0; index < methods.length; index++) {
    const method = methods[index]!;
    if (!apply(arrayIncludes, STANDARD_ROUTE_METHODS, [method])) {
      apply(arrayPush, custom, [method]);
    }
  }
  apply(arraySort, custom, []);
  for (let index = 0; index < custom.length; index++) {
    apply(arrayPush, standard, [custom[index]!]);
  }
  return standard;
}
