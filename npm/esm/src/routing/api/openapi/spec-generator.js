/**
 * OpenAPI Spec Generator
 *
 * Generates OpenAPI 3.1.0 specification from discovered routes.
 *
 * @module routing/api/openapi/spec-generator
 */
import { loadHandlerModule } from "../module-loader/loader.js";
import { OPENAPI_METADATA, } from "./types.js";
import { extractPathParams, generateOperationId, toOpenAPIPath } from "./path-utils.js";
import { logger } from "../../../utils/index.js";
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
export async function generateOpenAPISpec(router, projectDir, adapter, config, options) {
    const spec = {
        openapi: "3.1.0",
        info: {
            title: options?.title ?? config?.openapi?.title ?? "API Documentation",
            version: options?.version ?? config?.openapi?.version ?? "1.0.0",
            description: options?.description ?? config?.openapi?.description,
        },
        paths: {},
        tags: [],
    };
    if (options?.servers?.length) {
        spec.servers = options.servers;
    }
    const tagSet = new Set();
    for (const [pattern, entry] of router.routes) {
        if (!pattern.startsWith("/api") && !entry.route.page.includes("/api/"))
            continue;
        try {
            const pathItem = await processRoute(pattern, entry, projectDir, adapter, config, tagSet);
            if (!pathItem || Object.keys(pathItem).length === 0)
                continue;
            spec.paths[toOpenAPIPath(pattern)] = pathItem;
        }
        catch (error) {
            logger.warn(`[OpenAPI] Failed to process route ${pattern}:`, { error: String(error) });
        }
    }
    spec.tags = Array.from(tagSet)
        .sort()
        .map((name) => ({ name }));
    return spec;
}
async function processRoute(pattern, entry, projectDir, adapter, config, tagSet) {
    const module = await loadHandlerModule({
        projectDir,
        modulePath: entry.route.page,
        adapter,
        config,
    });
    if (!module)
        return null;
    const pathParams = extractPathParams(pattern);
    const pathItem = {};
    for (const method of HTTP_METHODS) {
        const handler = module[method];
        if (typeof handler !== "function")
            continue;
        const metadata = handler[OPENAPI_METADATA];
        addTags(metadata, tagSet);
        pathItem[method.toLowerCase()] = buildOperation(method, pattern, metadata, pathParams);
    }
    const defaultHandler = module.default;
    if (typeof defaultHandler !== "function")
        return pathItem;
    const defaultMetadata = defaultHandler[OPENAPI_METADATA];
    addTags(defaultMetadata, tagSet);
    for (const method of HTTP_METHODS) {
        const methodKey = method.toLowerCase();
        if (pathItem[methodKey])
            continue;
        pathItem[methodKey] = buildOperation(method, pattern, defaultMetadata, pathParams);
    }
    return pathItem;
}
function addTags(metadata, tagSet) {
    if (!metadata?.tags?.length)
        return;
    for (const tag of metadata.tags)
        tagSet.add(tag);
}
function buildOperation(method, pattern, metadata, pathParams) {
    const openApiPath = toOpenAPIPath(pattern);
    const operation = {
        operationId: generateOperationId(method, openApiPath),
        summary: metadata?.summary ?? `${method} ${openApiPath}`,
        description: metadata?.description,
        tags: metadata?.tags,
        deprecated: metadata?.deprecated,
        parameters: [],
        responses: {},
    };
    for (const param of pathParams) {
        const paramSchema = metadata?.params?.properties?.[param.name] ?? { type: "string" };
        const parameter = {
            name: param.name,
            in: "path",
            required: param.required,
            schema: paramSchema,
        };
        if (param.catchAll) {
            parameter.description = "Catch-all parameter (matches multiple path segments)";
        }
        operation.parameters.push(parameter);
    }
    const queryProps = metadata?.query?.properties;
    if (queryProps) {
        const required = metadata?.query?.required ?? [];
        for (const [name, schema] of Object.entries(queryProps)) {
            operation.parameters.push({
                name,
                in: "query",
                required: required.includes(name),
                schema,
            });
        }
    }
    const supportsBody = method === "POST" || method === "PUT" || method === "PATCH";
    if (supportsBody && metadata?.body) {
        operation.requestBody = {
            required: true,
            content: {
                "application/json": { schema: metadata.body },
            },
        };
    }
    const responses = metadata?.responses;
    if (responses && Object.keys(responses).length > 0) {
        for (const [statusCode, response] of Object.entries(responses)) {
            operation.responses[statusCode] = {
                ...response,
                description: response.description || getDefaultStatusDescription(Number(statusCode)),
            };
        }
    }
    else {
        operation.responses = { "200": { description: "Successful response" } };
        if (supportsBody) {
            operation.responses["400"] = { description: "Bad request" };
        }
    }
    if (operation.parameters.length === 0)
        delete operation.parameters;
    return operation;
}
export async function generateOpenAPIJson(router, projectDir, adapter, config, options) {
    const spec = await generateOpenAPISpec(router, projectDir, adapter, config, options);
    return JSON.stringify(spec, null, 2);
}
export function specToYaml(spec) {
    return toYaml(spec, 0);
}
function toYaml(obj, indent) {
    const spaces = "  ".repeat(indent);
    if (obj == null)
        return "null";
    if (typeof obj === "string") {
        if (obj.includes(":") || obj.includes("#") || obj.includes("\n") || obj.startsWith("{")) {
            return `"${obj.replace(/"/g, '\\"')}"`;
        }
        return obj;
    }
    if (typeof obj === "number" || typeof obj === "boolean")
        return String(obj);
    if (Array.isArray(obj)) {
        if (obj.length === 0)
            return "[]";
        return obj.map((item) => `\n${spaces}- ${toYaml(item, indent + 1).trimStart()}`).join("");
    }
    if (typeof obj === "object") {
        const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
        if (entries.length === 0)
            return "{}";
        return entries
            .map(([key, value]) => {
            const yamlValue = toYaml(value, indent + 1);
            if (typeof value === "object" && value !== null && !Array.isArray(value)) {
                return `\n${spaces}${key}:${yamlValue}`;
            }
            return `\n${spaces}${key}: ${yamlValue}`;
        })
            .join("");
    }
    return String(obj);
}
function getDefaultStatusDescription(statusCode) {
    const descriptions = {
        200: "Successful response",
        201: "Resource created",
        204: "No content",
        400: "Bad request",
        401: "Unauthorized",
        403: "Forbidden",
        404: "Not found",
        409: "Conflict",
        422: "Unprocessable entity",
        429: "Too many requests",
        500: "Internal server error",
        502: "Bad gateway",
        503: "Service unavailable",
    };
    return descriptions[statusCode] || `Response with status ${statusCode}`;
}
