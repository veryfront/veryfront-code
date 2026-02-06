import { z } from "zod";
import { createValidationError, VeryfrontError } from "./errors.ts";
import { readBodyWithLimit, validateRequestLimits } from "./limits.ts";
import { sanitizeData } from "./sanitizers.ts";
import { DEFAULT_LIMITS, type ParseFormOptions, type ParseJsonOptions } from "./types.ts";

export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodSchema<T>,
  options?: ParseJsonOptions,
): Promise<T> {
  validateRequestLimits(request, options?.limits);

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

  try {
    const validated = await schema.parseAsync(data);
    return options?.sanitize ? (sanitizeData(validated) as T) : validated;
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;

    throw createValidationError("Validation failed", {
      errors: error.errors.map((e) => ({
        path: e.path.join("."),
        message: e.message,
        code: e.code,
      })),
    });
  }
}

export async function parseFormData<T>(
  request: Request,
  schema: z.ZodSchema<T>,
  options?: ParseFormOptions,
): Promise<T> {
  validateRequestLimits(request, options?.limits);

  try {
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

    return await schema.parseAsync(data);
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;

    throw createValidationError("Form validation failed", {
      errors: error.errors,
    });
  }
}

export function parseQueryParams<T>(request: Request, schema: z.ZodSchema<T>): T {
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

  try {
    return schema.parse(params);
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;

    throw createValidationError("Query parameter validation failed", {
      errors: error.errors,
    });
  }
}
