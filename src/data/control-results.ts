import type { DataResult } from "./types.ts";

/**
 * Brand marking an object as produced by {@link notFound} or {@link redirect}.
 *
 * A registered symbol lets project and framework module instances recognize
 * the same control result before realm transfer drops symbol properties.
 *
 * @internal
 */
export const DATA_CONTROL_RESULT = Symbol.for("veryfront.dataControlResult");

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
