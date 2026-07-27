import type { DataContext, DataResult } from "./types.ts";

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

/** Validate a project hook result before dependency health records success. */
export function validateDataResult(
  value: unknown,
  hookName: "getServerData" | "getStaticData",
): DataResult {
  const fail = (): never => {
    throw new TypeError(`${hookName} must return a valid data result object`);
  };
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return fail();
  }
  const result = value as Record<string, unknown>;
  // Read every application-controlled property once. Returning this original
  // container would leave accessors or proxies able to change the selected
  // outcome after validation and make server/static paths disagree.
  const props = result.props;
  const redirect = result.redirect;
  const notFound = result.notFound;
  const revalidate = result.revalidate;
  let redirectDestination: string | undefined;
  let redirectPermanent: boolean | undefined;

  if (
    redirect !== undefined &&
    (redirect === null ||
      typeof redirect !== "object" ||
      Array.isArray(redirect))
  ) {
    return fail();
  }
  if (redirect !== undefined) {
    const redirectRecord = redirect as Record<string, unknown>;
    const destination = redirectRecord.destination;
    const permanent = redirectRecord.permanent;
    if (
      typeof destination !== "string" ||
      (permanent !== undefined && typeof permanent !== "boolean")
    ) {
      return fail();
    }
    redirectDestination = destination;
    redirectPermanent = permanent as boolean | undefined;
  }
  if (notFound !== undefined && typeof notFound !== "boolean") {
    return fail();
  }
  if (
    revalidate !== undefined &&
    revalidate !== false &&
    (typeof revalidate !== "number" ||
      !Number.isFinite(revalidate) ||
      revalidate < 0)
  ) {
    return fail();
  }

  const activeOutcomes = Number(props !== undefined) +
    Number(redirect !== undefined) +
    Number(notFound === true);
  if (activeOutcomes > 1) return fail();

  const normalized: DataResult = {};
  if (props !== undefined) normalized.props = props;
  if (redirectDestination !== undefined) {
    normalized.redirect = {
      destination: redirectDestination,
      ...(redirectPermanent !== undefined ? { permanent: redirectPermanent } : {}),
    };
  }
  if (notFound !== undefined) normalized.notFound = notFound as boolean;
  if (revalidate !== undefined) {
    normalized.revalidate = revalidate as number | false;
  }
  return normalized;
}

function cloneDataParams(
  params: DataContext["params"],
): DataContext["params"] {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : value,
    ]),
  );
}

/** Give each static hook mutable request-local values, never sibling aliases. */
export function cloneStaticDataContext(
  context: DataContext,
): Omit<DataContext, "request" | "query"> {
  return {
    params: cloneDataParams(context.params),
    url: new URL(context.url),
  };
}

/**
 * Clone mutable context fields for one server hook invocation.
 *
 * Direct hooks receive a Request clone so concurrent page/layout loaders have
 * independent headers and body readers. Isolated execution deliberately
 * retains the original Request because its bounded body preparation is shared
 * once before dispatching either worker job.
 */
export function cloneServerDataContext(
  context: DataContext,
  options: { cloneRequest?: boolean } = {},
): DataContext {
  return {
    params: cloneDataParams(context.params),
    query: new URLSearchParams(context.query),
    request: options.cloneRequest ? context.request.clone() : context.request,
    url: new URL(context.url),
  };
}
