import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { createValidationError, VeryfrontError } from "./errors.ts";
import { readBodyWithLimit, validateContentType, validateRequestLimits } from "./limits.ts";
import { sanitizeData } from "./sanitizers.ts";
import { DEFAULT_LIMITS, type ParseFormOptions, type ParseJsonOptions } from "./types.ts";
// `File` is a global only on Node 20+; import from `node:buffer` for Node 18
// compatibility (engines.node >= 18.0.0).
import { File } from "node:buffer";

export async function parseJsonBody<T>(
  request: Request,
  schema: Schema<T>,
  options?: ParseJsonOptions,
): Promise<T> {
  validateRequestLimits(request, options?.limits);
  validateContentType(request, "application/json");

  let data: unknown;
  try {
    const text = await readBodyWithLimit(request, options?.limits?.maxBodySize);
    data = JSON.parse(text);
  } catch (error) {
    if (error instanceof VeryfrontError && error.slug === "input-validation-failed") throw error;

    throw createValidationError("Invalid JSON in request body", {
      error: error instanceof Error ? error.message : "Parse error",
    });
  }

  const result = schema.safeParse(data);
  if (result.success) {
    return options?.sanitize ? (sanitizeData(result.data) as T) : result.data;
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

export async function parseFormData<T>(
  request: Request,
  schema: Schema<T>,
  options?: ParseFormOptions,
): Promise<T> {
  validateRequestLimits(request, options?.limits);

  validateContentType(request, ["multipart/form-data", "application/x-www-form-urlencoded"]);

  const formData = await request.formData();
  const data: Record<string, unknown> = {};
  const maxFileSize = options?.limits?.maxFileSize ?? DEFAULT_LIMITS.maxFileSize;

  for (const [key, value] of formData.entries()) {
    if (value instanceof File && value.size > maxFileSize) {
      throw createValidationError(`File ${key} too large`, {
        maxSize: maxFileSize,
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
