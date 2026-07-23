import { INPUT_VALIDATION_FAILED } from "#veryfront/errors";
import {
  getDataContextSchema,
  getDataResultSchema,
  getStaticPathsResultSchema,
} from "./schemas/data.schema.ts";
import type { DataContext, DataResult, StaticPathsResult } from "./types.ts";
import { isDataResultWithinLimit } from "./data-result-limits.ts";

const MAX_DATA_CONTEXT_PARAMS_BYTES = 128 * 1024;
const DATA_CONTEXT_FIELDS = ["params", "query", "request", "url"] as const;

function invalidResult(detail: string, loader: string): Error {
  return INPUT_VALIDATION_FAILED.create({
    detail,
    context: { loader },
  });
}

function hasSafeDataContextProperties(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  try {
    for (const field of DATA_CONTEXT_FIELDS) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, field);
      if (!descriptor || !("value" in descriptor)) return false;
    }
    const params = Reflect.getOwnPropertyDescriptor(value, "params")?.value;
    return isDataResultWithinLimit(params, MAX_DATA_CONTEXT_PARAMS_BYTES);
  } catch {
    return false;
  }
}

/** Validate and snapshot a public data-loader context without exposing its contents. */
export function parseDataContext(
  value: unknown,
  cloneRequest = false,
): DataContext {
  const loader = "data fetch";
  if (!hasSafeDataContextProperties(value)) {
    throw invalidResult("DataFetcher received an invalid data context", loader);
  }
  try {
    const parsed = getDataContextSchema().safeParse(value);
    if (parsed.success) {
      return {
        params: parsed.data.params,
        query: new URLSearchParams(parsed.data.query),
        request: cloneRequest ? parsed.data.request.clone() : parsed.data.request,
        url: new URL(parsed.data.url),
      };
    }
  } catch {
    // Validator failures are normalized below so request data is never echoed.
  }
  throw invalidResult("DataFetcher received an invalid data context", loader);
}

/** Validate an untrusted page loader result without exposing its contents. */
export function parseDataResult(value: unknown, loader: string): DataResult {
  if (!isDataResultWithinLimit(value)) {
    throw invalidResult(`${loader} result exceeds the data result limit`, loader);
  }

  let parsed: ReturnType<ReturnType<typeof getDataResultSchema>["safeParse"]> | undefined;
  try {
    parsed = getDataResultSchema().safeParse(value);
  } catch {
    // Validator failures are normalized below so loader output is never echoed.
  }
  if (!parsed?.success) {
    throw invalidResult(`${loader} returned an invalid data result`, loader);
  }
  if (parsed.data.redirect) return { redirect: parsed.data.redirect };
  if (parsed.data.notFound) return { notFound: true };
  const propsResult: DataResult = { props: parsed.data.props ?? {} };
  if (parsed.data.revalidate !== undefined) {
    propsResult.revalidate = parsed.data.revalidate;
  }
  return propsResult;
}

/** Create an isolated, cache-safe snapshot of a static loader result. */
export function snapshotStaticDataResult(value: DataResult): DataResult {
  try {
    return structuredClone(value);
  } catch {
    throw invalidResult(
      "getStaticData returned a result that is not structured-cloneable",
      "getStaticData",
    );
  }
}

/** Validate an untrusted static-path loader result without exposing its contents. */
export function parseStaticPathsResult(value: unknown): StaticPathsResult {
  const loader = "getStaticPaths";
  if (!isDataResultWithinLimit(value)) {
    throw invalidResult(`${loader} result exceeds the static paths limit`, loader);
  }

  let parsed: ReturnType<ReturnType<typeof getStaticPathsResultSchema>["safeParse"]> | undefined;
  try {
    parsed = getStaticPathsResultSchema().safeParse(value);
  } catch {
    // Validator failures are normalized below so loader output is never echoed.
  }
  if (!parsed?.success) {
    throw invalidResult(`${loader} returned an invalid static paths result`, loader);
  }
  return parsed.data;
}
