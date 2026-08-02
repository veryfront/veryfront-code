import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { createValidationError, VeryfrontError } from "./errors.ts";
import { sanitizeData } from "./sanitizers.ts";
import {
  readBodyBytesWithLimit,
  readBodyWithLimit,
  validateContentType,
  validateRequestLimits,
} from "./limits.ts";
import {
  type ParseFormOptions,
  type ParseJsonOptions,
  type ParseQueryOptions,
  type RequestLimits,
} from "./types.ts";
import * as nodeBuffer from "node:buffer";

const FileCtor = globalThis.File ??
  (nodeBuffer as typeof nodeBuffer & { File: typeof File }).File;
const PARSE_JSON_OPTION_KEYS = new Set(["limits", "sanitize"]);
const PARSE_FORM_OPTION_KEYS = new Set(["limits"]);
const PARSE_QUERY_OPTION_KEYS = new Set(["limits"]);

function snapshotParserOptions(
  value: unknown,
  label: string,
  allowedKeys: ReadonlySet<string>,
): Readonly<Record<string, unknown>> {
  if (value === undefined) return Object.freeze(Object.create(null));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  let prototype: object | null;
  let keys: Array<string | symbol>;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError(`${label} could not be inspected safely`);
  }
  if (prototype !== null && prototype !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }

  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      throw new TypeError(
        `${label} contains an unsupported ${typeof key === "string" ? `option: ${key}` : "symbol"}`,
      );
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw new TypeError(`${label}.${key} could not be inspected safely`);
    }
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`${label}.${key} must be an own data property`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

/** Parse and validate a JSON request body. */
export async function parseJsonBody<T>(
  request: Request,
  schema: Schema<T>,
  options?: ParseJsonOptions,
): Promise<T> {
  const snapshot = snapshotParserOptions(
    options,
    "JSON body parser options",
    PARSE_JSON_OPTION_KEYS,
  );
  const limits = validateRequestLimits(request, snapshot.limits as RequestLimits | undefined);
  const sanitize = snapshot.sanitize;
  if (sanitize !== undefined && typeof sanitize !== "boolean") {
    throw new TypeError("JSON body parser options.sanitize must be a boolean");
  }

  const result = await parseJsonBodyAfterRequestLimits(
    request,
    schema,
    limits,
  );
  return sanitize === true ? sanitizeData(result) as T : result;
}

/**
 * Parse JSON after the caller has applied `validateRequestLimits()`.
 *
 * @internal This keeps composite request boundaries from repeating the
 * URL/header/content-length checks while preserving `parseJsonBody()` as a
 * safe standalone API.
 */
export async function parseJsonBodyAfterRequestLimits<T>(
  request: Request,
  schema: Schema<T>,
  limits: Required<RequestLimits>,
): Promise<T> {
  validateContentType(request, "application/json");

  let data: unknown;
  try {
    const text = await readBodyWithLimit(request, limits.maxBodySize);
    data = JSON.parse(text);
  } catch (error) {
    if (error instanceof VeryfrontError && error.slug === "input-validation-failed") throw error;

    throw createValidationError("Invalid JSON in request body", {
      error: error instanceof Error ? error.message : "Parse error",
    });
  }

  const snapshot = snapshotBoundedJsonValue(data);
  if (!snapshot.success) {
    throw createValidationError("JSON value exceeds structural limits", {
      path: snapshot.path,
    });
  }

  const result = schema.safeParse(snapshot.value);
  if (result.success) return result.data;

  const issues = result.issues ?? [];
  throw createValidationError("Validation failed", {
    errors: issues.map((e) => ({
      path: e.path.join("."),
      message: e.message,
      code: e.code ?? "custom",
    })),
  });
}

/** Parse and validate multipart or URL-encoded form data. */
export async function parseFormData<T>(
  request: Request,
  schema: Schema<T>,
  options?: ParseFormOptions,
): Promise<T> {
  const snapshot = snapshotParserOptions(
    options,
    "Form body parser options",
    PARSE_FORM_OPTION_KEYS,
  );
  const limits = validateRequestLimits(request, snapshot.limits as RequestLimits | undefined);

  validateContentType(request, ["multipart/form-data", "application/x-www-form-urlencoded"]);

  let formData: FormData;
  try {
    const bytes = await readBodyBytesWithLimit(request, limits.maxBodySize);
    const contentType = request.headers.get("content-type");
    if (!contentType) {
      throw createValidationError("Missing Content-Type header");
    }
    formData = await new Response(new Uint8Array(bytes), {
      headers: { "content-type": contentType },
    }).formData();
  } catch (error) {
    if (error instanceof VeryfrontError && error.slug === "input-validation-failed") throw error;
    throw createValidationError("Invalid form data in request body", {
      error: error instanceof Error ? error.message : "Parse error",
    });
  }

  // Form field names are untrusted property keys. A null-prototype collector
  // keeps special names such as "__proto__" from changing the object's
  // prototype before the schema gets a chance to validate them.
  const data: Record<string, unknown> = Object.create(null);

  for (const [key, value] of formData.entries()) {
    if (value instanceof FileCtor && value.size > limits.maxFileSize) {
      throw createValidationError(`File ${key} too large`, {
        maxSize: limits.maxFileSize,
        actualSize: value.size,
      });
    }
    data[key] = value;
  }

  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const issues = result.issues ?? [];
  throw createValidationError("Form validation failed", {
    errors: issues,
  });
}

/** Parse and validate query parameters from a bounded request URL. */
export function parseQueryParams<T>(
  request: Request,
  schema: Schema<T>,
  options?: ParseQueryOptions,
): T {
  const snapshot = snapshotParserOptions(
    options,
    "Query parser options",
    PARSE_QUERY_OPTION_KEYS,
  );
  validateRequestLimits(request, snapshot.limits as RequestLimits | undefined);
  return parseQueryParamsAfterRequestLimits(request, schema);
}

/**
 * Parse query parameters after the caller has applied `validateRequestLimits()`.
 *
 * @internal Composite request boundaries use this to avoid repeating URL and
 * header validation.
 */
export function parseQueryParamsAfterRequestLimits<T>(request: Request, schema: Schema<T>): T {
  const url = new URL(request.url);
  // Query names are untrusted property keys. In particular, reading then
  // assigning "__proto__" on a normal object can mutate its prototype.
  const params: Record<string, unknown> = Object.create(null);

  for (const [key, value] of url.searchParams) {
    const descriptor = Object.getOwnPropertyDescriptor(params, key);
    const existing = descriptor && "value" in descriptor ? descriptor.value : undefined;

    if (!descriptor) {
      Object.defineProperty(params, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      });
      continue;
    }

    if (Array.isArray(existing)) {
      existing.push(value);
      continue;
    }

    params[key] = [existing, value];
  }

  const result = schema.safeParse(params);
  if (result.success) return result.data;

  const issues = result.issues ?? [];
  throw createValidationError("Query parameter validation failed", {
    errors: issues,
  });
}
