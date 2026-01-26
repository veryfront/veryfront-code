import { zodToJsonSchema } from "./schema/zod-json-schema.js";
import { agentLogger } from "../utils/logger/logger.js";
import { createError, toError } from "../errors/veryfront-error.js";
function hasValidZodTypeName(schema) {
    return (schema !== null &&
        typeof schema === "object" &&
        "_def" in schema &&
        !!schema._def?.typeName);
}
function getSchemaShape(schema) {
    const shape = schema._def?.shape;
    if (!shape)
        return null;
    return typeof shape === "function" ? shape() : shape;
}
function buildSchemaFromShape(shape, additionalProperties = false) {
    const keys = Object.keys(shape);
    const properties = Object.fromEntries(keys.map((key) => [key, { type: "string" }]));
    return {
        type: "object",
        properties,
        required: additionalProperties ? undefined : keys,
        ...(additionalProperties ? { additionalProperties: true } : {}),
    };
}
function convertSchemaToJson(schema, toolId, logPrefix, permissive = false) {
    const fallbackSchema = permissive
        ? { type: "object", properties: {}, additionalProperties: true }
        : { type: "object", properties: {} };
    const formatErrorMessage = (error) => error instanceof Error ? error.message : String(error);
    if (hasValidZodTypeName(schema)) {
        try {
            // deno-lint-ignore no-explicit-any
            const result = zodToJsonSchema(schema);
            agentLogger.info(`[${logPrefix}] Pre-converted schema for "${toolId}": ${Object.keys(result.properties || {}).length} properties`);
            return result;
        }
        catch (error) {
            if (permissive) {
                agentLogger.info(`[${logPrefix}] Using permissive schema for "${toolId}"`);
                return fallbackSchema;
            }
            throw toError(createError({
                type: "agent",
                message: `Tool "${toolId}" input schema conversion failed: ${formatErrorMessage(error)}`,
            }));
        }
    }
    const shape = getSchemaShape(schema);
    if (shape) {
        try {
            const result = buildSchemaFromShape(shape, permissive);
            agentLogger.info(`[${logPrefix}] Introspected schema for "${toolId}" from external zod: ${Object.keys(result.properties || {}).length} properties`);
            return result;
        }
        catch (error) {
            if (permissive) {
                agentLogger.info(`[${logPrefix}] Using permissive schema for "${toolId}"`);
                return fallbackSchema;
            }
            throw toError(createError({
                type: "agent",
                message: `Tool "${toolId}" schema introspection failed: ${formatErrorMessage(error)}`,
            }));
        }
    }
    if (permissive) {
        agentLogger.info(`[${logPrefix}] Using fully dynamic schema for "${toolId}"`);
        return fallbackSchema;
    }
    throw toError(createError({
        type: "agent",
        message: `Tool "${toolId}" input schema is not a valid Zod schema. Use the same Zod instance or set allowUnknownSchema to true.`,
    }));
}
let toolIdCounter = 0;
function generateToolId() {
    return `tool_${Date.now()}_${toolIdCounter++}`;
}
export function tool(config) {
    const id = config.id || generateToolId();
    const inputSchemaJson = convertSchemaToJson(config.inputSchema, id, "TOOL", config.allowUnknownSchema ?? false);
    return {
        id,
        type: "function",
        description: config.description,
        inputSchema: config.inputSchema,
        inputSchemaJson,
        execute: async (input, context) => {
            const schema = config.inputSchema;
            if (typeof schema?.parse === "function") {
                try {
                    schema.parse(input);
                }
                catch (error) {
                    throw toError(createError({
                        type: "agent",
                        message: `Tool "${id}" input validation failed: ${error instanceof Error ? error.message : String(error)}`,
                    }));
                }
            }
            return await config.execute(input, context);
        },
        mcp: config.mcp,
    };
}
export function dynamicTool(config) {
    const id = config.id || generateToolId();
    const inputSchemaJson = convertSchemaToJson(config.inputSchema, id, "DYNAMIC_TOOL", true);
    return {
        id,
        type: "dynamic",
        description: config.description,
        inputSchema: config.inputSchema,
        inputSchemaJson,
        execute: async (input, context) => {
            const result = await config.execute(input, context);
            return config.toModelOutput ? config.toModelOutput(result) : result;
        },
        mcp: config.mcp,
    };
}
