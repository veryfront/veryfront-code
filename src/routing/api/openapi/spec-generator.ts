/**
 * OpenAPI Spec Generator
 *
 * Generates OpenAPI 3.1.0 specification from discovered routes.
 *
 * @module routing/api/openapi/spec-generator
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { DynamicRouter, RouteEntry } from "../api-route-matcher.ts";
import { loadHandlerModule } from "../module-loader/loader.ts";
import {
  getDefaultStatusDescription,
  OPENAPI_METADATA,
  type OpenAPIOperation,
  type OpenAPIParameter,
  type OpenAPIPathItem,
  type OpenAPIRouteMetadata,
  type OpenAPISpec,
  type WrappedHandler,
} from "./types.ts";
import { extractPathParams, generateOperationId, toOpenAPIPath } from "./path-utils.ts";
import { logger as baseLogger } from "#veryfront/utils";

const logger = baseLogger.component("open-api");

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];
type HttpMethodLower = Lowercase<HttpMethod>;

interface GenerateSpecOptions {
  /** API title for OpenAPI info */
  title?: string;
  /** API version */
  version?: string;
  /** API description */
  description?: string;
  /** Server URLs to include */
  servers?: Array<{ url: string; description?: string }>;
}

export async function generateOpenAPISpec(
  router: DynamicRouter,
  projectDir: string,
  adapter: RuntimeAdapter,
  config?: VeryfrontConfig,
  options?: GenerateSpecOptions,
): Promise<OpenAPISpec> {
  const spec: OpenAPISpec = {
    openapi: "3.1.0",
    info: {
      title: options?.title ?? config?.openapi?.title ?? "API Documentation",
      version: options?.version ?? config?.openapi?.version ?? "1.0.0",
      description: options?.description ?? config?.openapi?.description,
    },
    paths: {},
    tags: [],
  };

  if (options?.servers?.length) spec.servers = options.servers;

  const tagSet = new Set<string>();

  for (const [pattern, entry] of router.routes) {
    if (!pattern.startsWith("/api") && !entry.route.page.includes("/api/")) continue;

    try {
      const pathItem = await processRoute(pattern, entry, projectDir, adapter, config, tagSet);
      if (!pathItem || Object.keys(pathItem).length === 0) continue;

      spec.paths[toOpenAPIPath(pattern)] = pathItem;
    } catch (error) {
      logger.warn(`Failed to process route ${pattern}:`, { error: String(error) });
    }
  }

  spec.tags = Array.from(tagSet)
    .sort()
    .map((name) => ({ name }));

  return spec;
}

async function processRoute(
  pattern: string,
  entry: RouteEntry,
  projectDir: string,
  adapter: RuntimeAdapter,
  config: VeryfrontConfig | undefined,
  tagSet: Set<string>,
): Promise<OpenAPIPathItem | null> {
  const module = await loadHandlerModule({
    projectDir,
    modulePath: entry.route.page,
    adapter,
    config,
  });

  if (!module) return null;

  const pathParams = extractPathParams(pattern);
  const pathItem: OpenAPIPathItem = {};

  for (const method of HTTP_METHODS) {
    const handler = module[method] as WrappedHandler | undefined;
    if (typeof handler !== "function") continue;

    const metadata = handler[OPENAPI_METADATA] as OpenAPIRouteMetadata | undefined;
    addTags(metadata, tagSet);

    pathItem[method.toLowerCase() as HttpMethodLower] = buildOperation(
      method,
      pattern,
      metadata,
      pathParams,
    );
  }

  const defaultHandler = module.default as WrappedHandler | undefined;
  if (typeof defaultHandler !== "function") return pathItem;

  const defaultMetadata = defaultHandler[OPENAPI_METADATA] as OpenAPIRouteMetadata | undefined;
  addTags(defaultMetadata, tagSet);

  for (const method of HTTP_METHODS) {
    const methodKey = method.toLowerCase() as HttpMethodLower;
    if (pathItem[methodKey]) continue;

    pathItem[methodKey] = buildOperation(method, pattern, defaultMetadata, pathParams);
  }

  return pathItem;
}

function addTags(metadata: OpenAPIRouteMetadata | undefined, tagSet: Set<string>): void {
  for (const tag of metadata?.tags ?? []) tagSet.add(tag);
}

function buildOperation(
  method: HttpMethod,
  pattern: string,
  metadata: OpenAPIRouteMetadata | undefined,
  pathParams: Array<{ name: string; required: boolean; catchAll: boolean }>,
): OpenAPIOperation {
  const openApiPath = toOpenAPIPath(pattern);
  const supportsBody = method === "POST" || method === "PUT" || method === "PATCH";

  const parameters: OpenAPIParameter[] = [];

  const operation: OpenAPIOperation = {
    operationId: generateOperationId(method, openApiPath),
    summary: metadata?.summary ?? `${method} ${openApiPath}`,
    description: metadata?.description,
    tags: metadata?.tags,
    deprecated: metadata?.deprecated,
    responses: {},
  };

  for (const param of pathParams) {
    const parameter: OpenAPIParameter = {
      name: param.name,
      in: "path",
      required: param.required,
      schema: metadata?.params?.properties?.[param.name] ?? { type: "string" as const },
    };

    if (param.catchAll) {
      parameter.description = "Catch-all parameter (matches multiple path segments)";
    }

    parameters.push(parameter);
  }

  const queryProps = metadata?.query?.properties;
  if (queryProps) {
    const required = metadata?.query?.required ?? [];
    for (const [name, schema] of Object.entries(queryProps)) {
      parameters.push({
        name,
        in: "query",
        required: required.includes(name),
        schema,
      });
    }
  }

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
  } else {
    operation.responses = { "200": { description: "Successful response" } };
    if (supportsBody) operation.responses["400"] = { description: "Bad request" };
  }

  if (parameters.length > 0) operation.parameters = parameters;

  return operation;
}

export async function generateOpenAPIJson(
  router: DynamicRouter,
  projectDir: string,
  adapter: RuntimeAdapter,
  config?: VeryfrontConfig,
  options?: GenerateSpecOptions,
): Promise<string> {
  const spec = await generateOpenAPISpec(router, projectDir, adapter, config, options);
  return JSON.stringify(spec, null, 2);
}

export function specToYaml(spec: OpenAPISpec): string {
  return toYaml(spec, 0);
}

function toYaml(obj: unknown, indent: number): string {
  const spaces = "  ".repeat(indent);

  if (obj == null) return "null";

  if (typeof obj === "string") {
    if (obj.includes(":") || obj.includes("#") || obj.includes("\n") || obj.startsWith("{")) {
      return `"${obj.replace(/"/g, '\\"')}"`;
    }
    return obj;
  }

  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);

  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj.map((item) => `\n${spaces}- ${toYaml(item, indent + 1).trimStart()}`).join("");
  }

  if (typeof obj === "object") {
    const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";

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
