/**
 * OpenAPI Spec Generator
 *
 * Generates OpenAPI 3.1.0 specification from discovered routes.
 *
 * @module routing/api/openapi/spec-generator
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { ApiRouteMatcher, RouteEntry } from "../api-route-matcher.ts";
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

/** A discovered route paired with the module namespace evaluated for it. */
export interface LoadedOpenAPIRoute {
  pattern: string;
  module: Record<string, unknown> | null;
}

export async function generateOpenAPISpec(
  router: ApiRouteMatcher,
  projectDir: string,
  adapter: RuntimeAdapter,
  config?: VeryfrontConfig,
  options?: GenerateSpecOptions,
): Promise<OpenAPISpec> {
  const spec = createSpec(config, options);
  const tagSet = new Set<string>();

  for (const [pattern, entry] of router.routes) {
    if (!isAPIRoute(pattern, entry)) continue;
    const module = await loadHandlerModule({
      projectDir,
      modulePath: entry.route.page,
      adapter,
      config,
    }) as Record<string, unknown> | null;
    addRouteToSpec(spec, tagSet, pattern, module);
  }

  return finalizeSpec(spec, tagSet);
}

/**
 * Build an OpenAPI document from module namespaces that were evaluated by the
 * caller. The worker isolation boundary uses this entry point so project
 * modules never need to cross back into the host process.
 */
export async function generateOpenAPISpecFromModules(
  routes: Iterable<LoadedOpenAPIRoute> | AsyncIterable<LoadedOpenAPIRoute>,
  config?: VeryfrontConfig,
  options?: GenerateSpecOptions,
): Promise<OpenAPISpec> {
  const spec = createSpec(config, options);
  const tagSet = new Set<string>();

  for await (const { pattern, module } of routes) {
    addRouteToSpec(spec, tagSet, pattern, module);
  }

  return finalizeSpec(spec, tagSet);
}

function createSpec(
  config: VeryfrontConfig | undefined,
  options: GenerateSpecOptions | undefined,
): OpenAPISpec {
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
  return spec;
}

function addRouteToSpec(
  spec: OpenAPISpec,
  tagSet: Set<string>,
  pattern: string,
  module: Record<string, unknown> | null,
): void {
  const pathItem = processRouteModule(pattern, module, tagSet);
  if (!pathItem || Object.keys(pathItem).length === 0) return;
  spec.paths[toOpenAPIPath(pattern)] = pathItem;
}

function finalizeSpec(spec: OpenAPISpec, tagSet: Set<string>): OpenAPISpec {
  spec.tags = Array.from(tagSet)
    .sort()
    .map((name) => ({ name }));

  return spec;
}

function isAPIRoute(pattern: string, entry: RouteEntry): boolean {
  return pattern.startsWith("/api") || entry.route.page.includes("/api/");
}

function processRouteModule(
  pattern: string,
  module: Record<string, unknown> | null,
  tagSet: Set<string>,
): OpenAPIPathItem | null {
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
      required: true,
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
  router: ApiRouteMatcher,
  projectDir: string,
  adapter: RuntimeAdapter,
  config?: VeryfrontConfig,
  options?: GenerateSpecOptions,
): Promise<string> {
  const spec = await generateOpenAPISpec(router, projectDir, adapter, config, options);
  return JSON.stringify(spec, null, 2);
}

export function specToYaml(spec: OpenAPISpec): string {
  return toYaml(spec, 0, new WeakSet());
}

function toYaml(obj: unknown, indent: number, ancestors: WeakSet<object>): string {
  if (indent > 100) throw new RangeError("OpenAPI document nesting exceeds 100 levels");
  const spaces = "  ".repeat(indent);
  const inline = toYamlInline(obj);
  if (inline !== null) return inline;

  if (typeof obj !== "object" || obj === null) {
    throw new TypeError(`Unsupported OpenAPI YAML value: ${typeof obj}`);
  }
  if (ancestors.has(obj)) throw new TypeError("OpenAPI document contains a circular reference");
  ancestors.add(obj);

  try {
    if (Array.isArray(obj)) {
      return obj.map((item) => {
        const itemInline = toYamlInline(item);
        if (itemInline !== null) return `${spaces}- ${itemInline}`;

        const rendered = toYaml(item, indent + 1, ancestors).split("\n");
        const first = rendered.shift()?.trimStart() ?? "{}";
        return `${spaces}- ${first}${rendered.length ? `\n${rendered.join("\n")}` : ""}`;
      }).join("\n");
    }

    return Object.entries(obj)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => {
        const yamlKey = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : JSON.stringify(key);
        const valueInline = toYamlInline(value);
        if (valueInline !== null) return `${spaces}${yamlKey}: ${valueInline}`;
        return `${spaces}${yamlKey}:\n${toYaml(value, indent + 1, ancestors)}`;
      })
      .join("\n");
  } finally {
    ancestors.delete(obj);
  }
}

function toYamlInline(value: unknown): string | null {
  if (value === null) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("OpenAPI YAML numbers must be finite");
    return String(value);
  }
  if (typeof value === "string") return toYamlString(value);
  if (Array.isArray(value) && value.length === 0) return "[]";
  if (
    typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.values(value).every((item) => item === undefined)
  ) return "{}";
  if (typeof value === "object") return null;
  if (value === undefined) return "null";
  throw new TypeError(`Unsupported OpenAPI YAML value: ${typeof value}`);
}

function toYamlString(value: string): string {
  const implicitValue = /^(?:null|true|false|yes|no|on|off|~)$/i.test(value) ||
    /^[-+]?\d/.test(value);
  const safePlain = value.length > 0 && value.trim() === value &&
    /^[A-Za-z_][A-Za-z0-9 _./-]*$/.test(value) && !implicitValue;
  return safePlain ? value : JSON.stringify(value);
}
