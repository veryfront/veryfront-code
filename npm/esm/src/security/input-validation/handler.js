import * as dntShim from "../../../_dnt.shims.js";
import { ValidationError } from "./errors.js";
import { parseJsonBody, parseQueryParams } from "./parsers.js";
/** Create a validated API handler wrapper that auto-validates body/query with Zod schemas */
export function createValidatedHandler(config, handler) {
    return async function validatedHandler(request) {
        try {
            const validated = {};
            if (config.body) {
                validated.body = await parseJsonBody(request, config.body, { limits: config.limits });
            }
            if (config.query) {
                validated.query = parseQueryParams(request, config.query);
            }
            return await handler(request, validated);
        }
        catch (error) {
            if (!(error instanceof ValidationError))
                throw error;
            return new dntShim.Response(JSON.stringify({
                error: error.message,
                details: error.details,
            }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
    };
}
