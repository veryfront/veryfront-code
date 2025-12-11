
import { z } from "zod";
import { ValidationError } from "./errors.ts";
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
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("Invalid JSON in request body", {
      error: error instanceof Error ? error.message : "Parse error",
    });
  }

  try {
    const validated = await schema.parseAsync(data);

    if (options?.sanitize) {
      return sanitizeData(validated) as T;
    }

    return validated;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError("Validation failed", {
        errors: error.errors.map((e) => ({
          path: e.path.join("."),
          message: e.message,
          code: e.code,
        })),
      });
    }
    throw error;
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

    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        const maxFileSize = options?.limits?.maxFileSize || DEFAULT_LIMITS.maxFileSize;
        if (value.size > maxFileSize) {
          throw new ValidationError(`File ${key} too large`, {
            maxSize: maxFileSize,
            actualSize: value.size,
          });
        }
        data[key] = value;
      } else {
        data[key] = value;
      }
    }

    return await schema.parseAsync(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError("Form validation failed", {
        errors: error.errors,
      });
    }
    throw error;
  }
}

export function parseQueryParams<T>(
  request: Request,
  schema: z.ZodSchema<T>,
): T {
  const url = new URL(request.url);
  const params: Record<string, unknown> = {};

  url.searchParams.forEach((value, key) => {
    if (params[key]) {
      if (Array.isArray(params[key])) {
        (params[key] as unknown[]).push(value);
      } else {
        params[key] = [params[key], value];
      }
    } else {
      params[key] = value;
    }
  });

  try {
    return schema.parse(params);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError("Query parameter validation failed", {
        errors: error.errors,
      });
    }
    throw error;
  }
}
