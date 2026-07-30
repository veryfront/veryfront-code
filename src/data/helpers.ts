import type { DataContext, DataResult } from "./types.ts";
import {
  MAX_DATA_PARAM_ARRAY_SEGMENTS,
  MAX_DATA_PARAM_KEY_CHARACTERS,
  MAX_DATA_PARAM_PROPERTIES,
  MAX_DATA_PARAM_VALUE_CHARACTERS,
  MAX_DATA_QUERY_CHARACTERS,
  MAX_DATA_SERIALIZED_PARAMS_CHARACTERS,
  MAX_DATA_URL_CHARACTERS,
} from "./data-limits.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";

const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ReflectApply = Reflect.apply;
const ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const ReflectOwnKeys = Reflect.ownKeys;
const URLHrefGetter = Object.getOwnPropertyDescriptor(URL.prototype, "href")?.get;
const URLSearchParamsToString = URLSearchParams.prototype.toString;
const RequestUrlGetter = Object.getOwnPropertyDescriptor(Request.prototype, "url")?.get;
const RequestSignalGetter = Object.getOwnPropertyDescriptor(
  Request.prototype,
  "signal",
)?.get;
const RequestClone = Request.prototype.clone;

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
  if (
    value === null || typeof value !== "object" || isProxyWithoutHooks(value)
  ) return false;

  const descriptor = ReflectGetOwnPropertyDescriptor(
    value,
    DATA_CONTROL_RESULT,
  );
  return descriptor?.enumerable === false && "value" in descriptor &&
    descriptor.value === true;
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

function invalidDataParams(): never {
  throw new TypeError(
    "Data context params must be a plain record of string or dense string-array data properties",
  );
}

function dataParamsLimit(description: string, limit: number): never {
  throw new RangeError(
    `Data context params ${description} limit of ${limit.toLocaleString("en-US")} was exceeded`,
  );
}

function snapshotDataParamArray(value: unknown): string[] {
  if (
    !Array.isArray(value) || isProxyWithoutHooks(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    return invalidDataParams();
  }
  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (!Number.isSafeInteger(length) || (length as number) < 0) {
    return invalidDataParams();
  }
  if ((length as number) > MAX_DATA_PARAM_ARRAY_SEGMENTS) {
    return dataParamsLimit("array-segment", MAX_DATA_PARAM_ARRAY_SEGMENTS);
  }

  const snapshot = new Array<string>(length as number);
  let entries = 0;
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string") return invalidDataParams();
    const index = Number(key);
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= snapshot.length ||
      String(index) !== key ||
      !descriptor?.enumerable ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string"
    ) {
      return invalidDataParams();
    }
    if (descriptor.value.length > MAX_DATA_PARAM_VALUE_CHARACTERS) {
      return dataParamsLimit("value-character", MAX_DATA_PARAM_VALUE_CHARACTERS);
    }
    snapshot[index] = descriptor.value;
    entries++;
  }
  if (entries !== snapshot.length) return invalidDataParams();
  return snapshot;
}

/** Snapshot the exact route-parameter domain used by hooks and cache keys. */
export function snapshotDataParams(
  params: unknown,
): DataContext["params"] {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    return invalidDataParams();
  }
  if (isProxyWithoutHooks(params)) return invalidDataParams();
  const prototype = Object.getPrototypeOf(params);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidDataParams();
  }

  const snapshot: DataContext["params"] = {};
  const keys = ReflectOwnKeys(params);
  if (keys.length > MAX_DATA_PARAM_PROPERTIES) {
    return dataParamsLimit("property", MAX_DATA_PARAM_PROPERTIES);
  }
  let retainedCharacters = 0;
  for (const key of keys) {
    if (typeof key !== "string") return invalidDataParams();
    if (key.length > MAX_DATA_PARAM_KEY_CHARACTERS) {
      return dataParamsLimit("key-character", MAX_DATA_PARAM_KEY_CHARACTERS);
    }
    const descriptor = ReflectGetOwnPropertyDescriptor(params, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      return invalidDataParams();
    }
    const value = descriptor.value;
    if (
      typeof value === "string" &&
      value.length > MAX_DATA_PARAM_VALUE_CHARACTERS
    ) {
      return dataParamsLimit("value-character", MAX_DATA_PARAM_VALUE_CHARACTERS);
    }
    const normalized = typeof value === "string" ? value : snapshotDataParamArray(value);
    retainedCharacters += key.length +
      (typeof normalized === "string"
        ? normalized.length
        : normalized.reduce((total, segment) => total + segment.length, 0));
    if (retainedCharacters > MAX_DATA_SERIALIZED_PARAMS_CHARACTERS) {
      return dataParamsLimit(
        "total-character",
        MAX_DATA_SERIALIZED_PARAMS_CHARACTERS,
      );
    }
    // Preserve `__proto__` as data rather than invoking Object.prototype's
    // legacy setter while keeping the familiar ordinary-object hook contract.
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      value: normalized,
      writable: true,
    });
  }
  return snapshot;
}

function invalidDataContext(message: string): never {
  throw new TypeError(message);
}

function requireContextRecord(context: unknown): object {
  if (context === null || typeof context !== "object" || Array.isArray(context)) {
    return invalidDataContext("Data context must be a plain object");
  }
  if (isProxyWithoutHooks(context)) {
    return invalidDataContext("Data context must be a plain object");
  }
  const prototype = ObjectGetPrototypeOf(context);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidDataContext("Data context must be a plain object");
  }
  return context;
}

function readContextField(context: object, key: keyof DataContext): unknown {
  const descriptor = ReflectGetOwnPropertyDescriptor(context, key);
  if (descriptor?.enumerable !== true || !("value" in descriptor)) {
    return invalidDataContext(
      `Data context ${key} must be an own enumerable data property`,
    );
  }
  return descriptor.value;
}

export function snapshotDataUrl(value: unknown): URL {
  if (
    value === null || typeof value !== "object" ||
    isProxyWithoutHooks(value) ||
    ObjectGetPrototypeOf(value) !== URL.prototype || !URLHrefGetter
  ) {
    return invalidDataContext("Data context url must be a URL instance");
  }
  let href: string;
  try {
    href = ReflectApply(URLHrefGetter, value, []) as string;
  } catch {
    return invalidDataContext("Data context url must be a URL instance");
  }
  if (href.length > MAX_DATA_URL_CHARACTERS) {
    throw new RangeError(
      `Data context URL must not exceed ${
        MAX_DATA_URL_CHARACTERS.toLocaleString("en-US")
      } characters`,
    );
  }
  return new URL(href);
}

function snapshotDataQuery(value: unknown): URLSearchParams {
  if (
    value === null || typeof value !== "object" ||
    isProxyWithoutHooks(value) ||
    ObjectGetPrototypeOf(value) !== URLSearchParams.prototype
  ) {
    return invalidDataContext(
      "Data context query must be a URLSearchParams instance",
    );
  }
  let serialized: string;
  try {
    serialized = ReflectApply(URLSearchParamsToString, value, []) as string;
  } catch {
    return invalidDataContext(
      "Data context query must be a URLSearchParams instance",
    );
  }
  if (serialized.length > MAX_DATA_QUERY_CHARACTERS) {
    throw new RangeError(
      `Data context query must not exceed ${
        MAX_DATA_QUERY_CHARACTERS.toLocaleString("en-US")
      } characters`,
    );
  }
  return new URLSearchParams(serialized);
}

function requireDataRequest(value: unknown): Request {
  if (
    value === null || typeof value !== "object" ||
    isProxyWithoutHooks(value) ||
    ObjectGetPrototypeOf(value) !== Request.prototype || !RequestUrlGetter
  ) {
    return invalidDataContext("Data context request must be a Request instance");
  }
  try {
    ReflectApply(RequestUrlGetter, value, []);
  } catch {
    return invalidDataContext("Data context request must be a Request instance");
  }
  return value as Request;
}

/** Read the intrinsic Request signal rather than an own shadowing property. */
export function getDataRequestSignal(request: Request): AbortSignal {
  if (!RequestSignalGetter) {
    throw new TypeError("Data context request must expose an AbortSignal");
  }
  try {
    return ReflectApply(RequestSignalGetter, request, []) as AbortSignal;
  } catch {
    throw new TypeError("Data context request must expose an AbortSignal");
  }
}

/** Give each static hook mutable request-local values, never sibling aliases. */
export function cloneStaticDataContext(
  context: Pick<DataContext, "params" | "url">,
): Omit<DataContext, "request" | "query"> {
  const source = requireContextRecord(context);
  return {
    params: snapshotDataParams(readContextField(source, "params")),
    url: snapshotDataUrl(readContextField(source, "url")),
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
  const source = requireContextRecord(context);
  const request = requireDataRequest(readContextField(source, "request"));
  return {
    params: snapshotDataParams(readContextField(source, "params")),
    query: snapshotDataQuery(readContextField(source, "query")),
    request: options.cloneRequest ? ReflectApply(RequestClone, request, []) as Request : request,
    url: snapshotDataUrl(readContextField(source, "url")),
  };
}
