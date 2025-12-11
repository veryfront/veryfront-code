
import { z } from "zod";
import { ValidationError } from "./errors.ts";
import { parseJsonBody, parseQueryParams } from "./parsers.ts";
import { type RequestLimits, type ValidatedData } from "./types.ts";

export interface ValidatedHandlerConfig<TBody = unknown, TQuery = unknown> {
  body?: z.ZodSchema<TBody>;
  query?: z.ZodSchema<TQuery>;
  limits?: RequestLimits;
}

export type ValidatedHandlerFunction<TBody = unknown, TQuery = unknown> = (
  request: Request,
  validated: ValidatedData<TBody, TQuery>,
) => Promise<Response> | Response;

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
