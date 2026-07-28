import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { createValidationError, VeryfrontError } from "./errors.ts";
import {
  readBodyBytesWithLimit,
  readBodyWithLimit,
  validateContentType,
  validateRequestLimits,
} from "./limits.ts";
import { sanitizeData } from "./sanitizers.ts";
import { type ParseFormOptions, type ParseJsonOptions, type RequestLimits } from "./types.ts";
import * as nodeBuffer from "node:buffer";

const FileCtor = globalThis.File ??
  (nodeBuffer as typeof nodeBuffer & { File: typeof File }).File;

/** Parse and validate a JSON request body. */
export async function parseJsonBody<T>(
  request: Request,
  schema: Schema<T>,
  options?: ParseJsonOptions,
): Promise<T> {
  const limits = validateRequestLimits(request, options?.limits);

  return await parseJsonBodyAfterRequestLimits(
    request,
    schema,
    limits,
    options?.sanitize,
  );
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
  sanitize = false,
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

  const result = schema.safeParse(data);
  if (result.success) {
    return sanitize ? (sanitizeData(result.data) as T) : result.data;
  }

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
  const limits = validateRequestLimits(request, options?.limits);

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

  const data: Record<string, unknown> = {};

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

/** Parse and validate query parameters from a request URL. */
export function parseQueryParams<T>(request: Request, schema: Schema<T>): T {
  const url = new URL(request.url);
  const params: Record<string, unknown> = {};

  for (const [key, value] of url.searchParams) {
    const existing = params[key];

    if (existing === undefined) {
      params[key] = value;
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
