import * as dntShim from "../../../_dnt.shims.js";
import { z } from "zod";
import { ValidationError } from "./errors.js";
import { readBodyWithLimit, validateRequestLimits } from "./limits.js";
import { sanitizeData } from "./sanitizers.js";
import { DEFAULT_LIMITS } from "./types.js";
export async function parseJsonBody(request, schema, options) {
    validateRequestLimits(request, options?.limits);
    let data;
    try {
        const text = await readBodyWithLimit(request, options?.limits?.maxBodySize);
        data = JSON.parse(text);
    }
    catch (error) {
        if (error instanceof ValidationError)
            throw error;
        throw new ValidationError("Invalid JSON in request body", {
            error: error instanceof Error ? error.message : "Parse error",
        });
    }
    try {
        const validated = await schema.parseAsync(data);
        if (!options?.sanitize)
            return validated;
        return sanitizeData(validated);
    }
    catch (error) {
        if (!(error instanceof z.ZodError))
            throw error;
        throw new ValidationError("Validation failed", {
            errors: error.errors.map((e) => ({
                path: e.path.join("."),
                message: e.message,
                code: e.code,
            })),
        });
    }
}
export async function parseFormData(request, schema, options) {
    validateRequestLimits(request, options?.limits);
    try {
        const formData = await request.formData();
        const data = {};
        const maxFileSize = options?.limits?.maxFileSize ?? DEFAULT_LIMITS.maxFileSize;
        for (const [key, value] of formData.entries()) {
            if (value instanceof dntShim.File && value.size > maxFileSize) {
                throw new ValidationError(`File ${key} too large`, {
                    maxSize: maxFileSize,
                    actualSize: value.size,
                });
            }
            data[key] = value;
        }
        return await schema.parseAsync(data);
    }
    catch (error) {
        if (!(error instanceof z.ZodError))
            throw error;
        throw new ValidationError("Form validation failed", {
            errors: error.errors,
        });
    }
}
export function parseQueryParams(request, schema) {
    const url = new URL(request.url);
    const params = {};
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
    }
    catch (error) {
        if (!(error instanceof z.ZodError))
            throw error;
        throw new ValidationError("Query parameter validation failed", {
            errors: error.errors,
        });
    }
}
