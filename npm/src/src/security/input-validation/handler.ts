import * as dntShim from "../../../_dnt.shims.js";
import { z } from "zod";
import { ValidationError } from "./errors.js";
import { parseJsonBody, parseQueryParams } from "./parsers.js";
import { type RequestLimits, type ValidatedData } from "./types.js";

export interface ValidatedHandlerConfig<TBody = unknown, TQuery = unknown> {
  body?: z.ZodSchema<TBody>;
  query?: z.ZodSchema<TQuery>;
  limits?: RequestLimits;
}

export type ValidatedHandlerFunction<TBody = unknown, TQuery = unknown> = (
  request: dntShim.Request,
  validated: ValidatedData<TBody, TQuery>,
) => Promise<dntShim.Response> | dntShim.Response;

/** Create a validated API handler wrapper that auto-validates body/query with Zod schemas */
export function createValidatedHandler<TBody = unknown, TQuery = unknown>(
  config: ValidatedHandlerConfig<TBody, TQuery>,
  handler: ValidatedHandlerFunction<TBody, TQuery>,
): (request: dntShim.Request) => Promise<dntShim.Response> {
  return async function validatedHandler(request: dntShim.Request): Promise<dntShim.Response> {
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
      if (!(error instanceof ValidationError)) throw error;

      return new dntShim.Response(
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
  };
}
