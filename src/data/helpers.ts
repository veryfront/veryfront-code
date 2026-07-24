import type { DataResult } from "./types.ts";

/**
 * Brand marking an object as produced by {@link notFound} or {@link redirect}.
 *
 * A registered symbol, so a result built by one copy of this module is
 * recognised by another. Project code and the framework do not always share a
 * module instance, and isolated data fetching crosses a realm boundary.
 *
 * Symbols are dropped by `structuredClone`, so the brand does not survive
 * `postMessage`. Worker-side code normalises a thrown control result before it
 * is posted back, while the object is still in-realm.
 */
const DATA_CONTROL_RESULT = Symbol.for("veryfront.dataControlResult");

/**
 * Mark a result as framework-produced control flow.
 *
 * The brand is non-enumerable, so it stays out of `Object.keys`,
 * `JSON.stringify`, and the `DataResult` schema. A returned control result
 * behaves exactly as it did before the brand existed.
 */
function brandDataControlResult(result: DataResult): DataResult {
  Object.defineProperty(result, DATA_CONTROL_RESULT, { value: true });
  return result;
}

/**
 * Redirect the request from a data loader.
 *
 * Return it or throw it. `throw redirect("/login")` behaves exactly like
 * `return redirect("/login")`.
 */
export function redirect(destination: string, permanent = false): DataResult {
  return brandDataControlResult({ redirect: { destination, permanent } });
}

/**
 * Render the 404 page from a data loader.
 *
 * Return it or throw it. `throw notFound()` behaves exactly like
 * `return notFound()`, which is useful deep inside a helper that has no clean
 * way to return to the loader.
 */
export function notFound(): DataResult {
  return brandDataControlResult({ notFound: true });
}

/**
 * True when `value` is a control-flow result produced by {@link notFound} or
 * {@link redirect}.
 *
 * These helpers are documented as return values, but `throw notFound()` reads
 * naturally and is what people coming from other frameworks reach for. Thrown,
 * the plain object is not an `Error`, so the SSR error handler stringified it
 * to `[object Object]` and returned a 500 instead of the intended 404 or
 * redirect. Recognising the brand lets a thrown result behave like a returned
 * one.
 *
 * The check is on the brand, never on the shape. A loader that does
 * `throw await response.json()` against an upstream answering
 * `{ notFound: true, message: "record locked" }` is reporting a failure, and
 * reading that as a 404 would render the wrong page, log nothing, and cache a
 * 404 the site never asked for.
 */
export function isDataControlResult(value: unknown): value is DataResult {
  if (value === null || typeof value !== "object") return false;

  return (value as Record<symbol, unknown>)[DATA_CONTROL_RESULT] === true;
}

/**
 * Reduce a thrown control result to the shape a returned one produces.
 *
 * Callers apply this inside whatever wraps the data loader, not in an outer
 * `catch`. A 404 is a routing decision, and a circuit breaker that sees it as a
 * failure will open on the fifth legitimate one and fail every later data route
 * for the project.
 */
export function toDataControlResult(result: DataResult): DataResult {
  if (result.redirect) return { redirect: result.redirect };
  return { notFound: true };
}
