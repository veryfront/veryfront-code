/**
 * Request Parsers
 * Functions for parsing and validating different request body types
 */

import { z } from "zod";
import { ValidationError } from "./errors.ts";
import { readBodyWithLimit, validateRequestLimits } from "./limits.ts";
import { sanitizeData } from "./sanitizers.ts";
import { DEFAULT_LIMITS, type ParseFormOptions, type ParseJsonOptions } from "./types.ts";

/**
 * Parse and validate JSON body with schema
 *
 * @param request - Request object with JSON body
 * @param schema - Zod schema to validate against
 * @param options - Optional parsing configuration
 * @returns Validated and optionally sanitized data
 * @throws ValidationError if parsing or validation fails
 *
 * @example
 * ```ts
 * const userSchema = z.object({
 *   name: z.string(),
 *   email: z.string().email()
 * })
 *
 * const user = await parseJsonBody(request, userSchema, { sanitize: true })
 * ```
 */
export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodSchema<T>,
  options?: ParseJsonOptions,
): Promise<T> {
  // Validate request limits first
  validateRequestLimits(request, options?.limits);

  let data: unknown;
  try {
    // Parse JSON with size limit enforcement
    const text = await readBodyWithLimit(request, options?.limits?.maxBodySize);
    data = JSON.parse(text);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("Invalid JSON in request body", {
      error: error instanceof Error ? error.message : "Parse error",
    });
  }

  // Validate against schema
  try {
    const validated = await schema.parseAsync(data);

    // Optional sanitization
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

/**
 * Parse and validate form data
 *
 * @param request - Request object with form data body
 * @param schema - Zod schema to validate against
 * @param options - Optional parsing configuration
 * @returns Validated form data
 * @throws ValidationError if parsing or validation fails
 *
 * @example
 * ```ts
 * const uploadSchema = z.object({
 *   file: z.instanceof(File),
 *   description: z.string()
 * })
 *
 * const data = await parseFormData(request, uploadSchema)
 * ```
 */
export async function parseFormData<T>(
  request: Request,
  schema: z.ZodSchema<T>,
  options?: ParseFormOptions,
): Promise<T> {
  validateRequestLimits(request, options?.limits);

  try {
    const formData = await request.formData();
    const data: Record<string, unknown> = {};

    // Convert FormData to object
    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        // Validate file size
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

/**
 * Parse URL search params with validation
 *
 * @param request - Request object with URL search params
 * @param schema - Zod schema to validate against
 * @returns Validated query parameters
 * @throws ValidationError if validation fails
 *
 * @example
 * ```ts
 * const querySchema = z.object({
 *   page: z.coerce.number(),
 *   search: z.string().optional()
 * })
 *
 * const params = parseQueryParams(request, querySchema)
 * ```
 */
export function parseQueryParams<T>(
  request: Request,
  schema: z.ZodSchema<T>,
): T {
  const url = new URL(request.url);
  const params: Record<string, unknown> = {};

  // Convert URLSearchParams to object
  url.searchParams.forEach((value, key) => {
    // Handle array parameters (e.g., ?tags=a&tags=b)
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
