import type { DataResult } from "./types.ts";

/** Return a redirect result from a data loader. */
export function redirect(destination: string, permanent = false): DataResult {
  return { redirect: { destination, permanent } };
}

/** Return a 404 result from a data loader. */
export function notFound(): DataResult {
  return { notFound: true };
}

/**
 * True when `value` is a control-flow result produced by {@link notFound} or
 * {@link redirect}.
 *
 * These helpers are documented as return values, but `throw notFound()` reads
 * naturally and is what people coming from other frameworks reach for. Thrown,
 * the plain object is not an `Error`, so the SSR error handler stringified it
 * to `[object Object]` and returned a 500 instead of the intended 404 or
 * redirect. Recognising the shape lets a thrown result behave like a returned
 * one.
 */
export function isDataControlResult(value: unknown): value is DataResult {
  if (value === null || typeof value !== "object") return false;
  if (value instanceof Error) return false;

  const candidate = value as { notFound?: unknown; redirect?: unknown };

  if (candidate.notFound === true) return true;

  const destination = (candidate.redirect as { destination?: unknown } | undefined)?.destination;
  return typeof destination === "string";
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
