/**
 * Validated Handler Factory
 * Higher-order function for creating validated API handlers
 */

import { z } from "zod";
import { ValidationError } from "./errors.ts";
import { parseJsonBody, parseQueryParams } from "./parsers.ts";
import { type RequestLimits, type ValidatedData } from "./types.ts";

/**
 * Configuration for validated handler
 */
export interface ValidatedHandlerConfig<TBody = unknown, TQuery = unknown> {
  body?: z.ZodSchema<TBody>;
  query?: z.ZodSchema<TQuery>;
  limits?: RequestLimits;
}

/**
 * Handler function type that receives validated data
 */
export type ValidatedHandlerFunction<TBody = unknown, TQuery = unknown> = (
  request: Request,
  validated: ValidatedData<TBody, TQuery>,
) => Promise<Response> | Response;

/**
 * Create a validated API handler wrapper
 *
 * This higher-order function wraps an API handler to automatically validate
 * request body and query parameters according to provided Zod schemas.
 * Validation errors are automatically converted to 400 responses.
 *
 * @param config - Configuration specifying validation schemas and limits
 * @param handler - Handler function that receives validated data
 * @returns Wrapped handler that performs automatic validation
 *
 * @example
 * ```ts
 * const createUserHandler = createValidatedHandler(
 *   {
 *     body: z.object({
 *       name: z.string(),
 *       email: z.string().email()
 *     }),
 *     query: z.object({
 *       sendEmail: z.coerce.boolean().optional()
 *     })
 *   },
 *   async (request, { body, query }) => {
 *     // body and query are fully typed and validated
 *     const user = await createUser(body)
 *     if (query?.sendEmail) {
 *       await sendWelcomeEmail(user.email)
 *     }
 *     return new Response(JSON.stringify(user), { status: 201 })
 *   }
 * )
 * ```
 */
export function createValidatedHandler<TBody = unknown, TQuery = unknown>(
  config: ValidatedHandlerConfig<TBody, TQuery>,
  handler: ValidatedHandlerFunction<TBody, TQuery>,
) {
  return async (request: Request): Promise<Response> => {
    try {
      const validated: ValidatedData<TBody, TQuery> = {};

      if (config.body) {
        validated.body = await parseJsonBody(request, config.body, { limits: config.limits });
      }

      if (config.query) {
        validated.query = parseQueryParams(request, config.query);
      }

      return await handler(request, validated);
    } catch (error) {
      if (error instanceof ValidationError) {
        return new Response(
          JSON.stringify({
            error: error.message,
            details: error.details,
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      throw error;
    }
  };
}
