/**
 * OpenAPI MCP Tools Generator
 *
 * Auto-generates MCP tools from OpenAPI specification, allowing AI agents
 * to call API endpoints directly.
 *
 * @module routing/api/openapi/mcp-tools
 */

import { dynamicTool } from "#veryfront/tool";
import type { Tool, ToolExecutionContext } from "#veryfront/tool";
import { logger as baseLogger } from "#veryfront/utils";
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { Schema, SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import type { OpenAPIOperation, OpenAPIParameter, OpenAPISpec } from "./types.ts";
import { generateOperationId } from "./path-utils.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";

const logger = baseLogger.component("open-api-mcp");

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const MAX_API_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024 - 1;
const MAX_API_REDIRECTS = 5;
const FORBIDDEN_CALLER_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
type HttpMethod = (typeof HTTP_METHODS)[number];

function isHttpMethod(method: string): method is HttpMethod {
  return HTTP_METHODS.includes(method as HttpMethod);
}

/**
 * Configuration for MCP tools generation.
 */
export interface MCPToolsConfig {
  /** Base URL for API calls (e.g., "http://localhost:3000") */
  baseUrl: string;
  /** Tool naming prefix (default: "api") */
  toolPrefix?: string;
  /** Additional headers to include in requests */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (default: 15000) */
  timeoutMs?: number;
  /** Maximum response body size in bytes (default: 5242880) */
  maxResponseBytes?: number;
}

interface NormalizedMCPToolsConfig {
  baseUrl: URL;
  headers: Headers;
  maxResponseBytes: number;
  timeoutMs: number;
  toolPrefix: string;
}

/**
 * Generate MCP tools from an OpenAPI specification.
 *
 * Each API endpoint becomes a callable tool that AI agents can invoke.
 */
export function generateMCPToolsFromSpec(spec: OpenAPISpec, config: MCPToolsConfig): Tool[] {
  const tools: Tool[] = [];
  const normalizedConfig = normalizeConfig(config);
  const toolIds = new Set<string>();

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem) continue;

    for (const [method, operationValue] of Object.entries(pathItem)) {
      if (!isHttpMethod(method)) continue;

      const operation = operationValue as OpenAPIOperation | undefined;
      if (!operation) continue;
      const operationId = operation.operationId?.trim() || generateOperationId(method, path);
      if (!/^[A-Za-z0-9_.-]+$/.test(operationId)) {
        throw new TypeError(`Invalid OpenAPI operation id: ${operationId}`);
      }
      const toolId = `${normalizedConfig.toolPrefix}:${operationId}`;
      if (toolId.length > 128) {
        throw new TypeError("Generated OpenAPI tool id exceeds 128 characters");
      }
      if (toolIds.has(toolId)) {
        throw new TypeError(`Duplicate OpenAPI operation id: ${operationId}`);
      }
      toolIds.add(toolId);

      const operationSnapshot = structuredClone({ ...operation, operationId });

      tools.push(
        dynamicTool({
          id: toolId,
          description: buildToolDescription(operationSnapshot, method, path),
          inputSchema: buildInputSchema(operationSnapshot),
          execute: (input, context?) =>
            executeAPICall(
              normalizedConfig,
              method,
              path,
              input as Record<string, unknown>,
              operationSnapshot,
              context,
            ),
          mcp: { enabled: true },
        }),
      );
    }
  }

  logger.debug("Generated tools", { count: tools.length });
  return tools;
}

function normalizeConfig(config: MCPToolsConfig): NormalizedMCPToolsConfig {
  const baseUrl = new URL(config.baseUrl);
  if (
    (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") || baseUrl.username ||
    baseUrl.password || baseUrl.search || baseUrl.hash ||
    (baseUrl.pathname !== "/" && baseUrl.pathname !== "")
  ) {
    throw new TypeError("OpenAPI MCP baseUrl must be an HTTP(S) origin without credentials");
  }

  const toolPrefix = config.toolPrefix ?? "api";
  if (!/^[A-Za-z0-9_.-]+$/.test(toolPrefix) || toolPrefix.length > 64) {
    throw new TypeError(
      "OpenAPI MCP toolPrefix must contain only letters, numbers, dot, dash, or underscore",
    );
  }

  const timeoutMs = config.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_API_TIMEOUT_MS) {
    throw new RangeError(`OpenAPI MCP timeoutMs must be between 1 and ${MAX_API_TIMEOUT_MS}`);
  }
  const maxResponseBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (
    !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 ||
    maxResponseBytes > MAX_RESPONSE_BYTES
  ) {
    throw new RangeError(
      `OpenAPI MCP maxResponseBytes must be between 1 and ${MAX_RESPONSE_BYTES}`,
    );
  }

  return {
    baseUrl,
    headers: new Headers(config.headers),
    maxResponseBytes,
    timeoutMs,
    toolPrefix,
  };
}

function buildToolDescription(operation: OpenAPIOperation, method: string, path: string): string {
  const summary = operation.summary ?? `${method.toUpperCase()} ${path}`;
  const description = operation.description ? `\n\n${operation.description}` : "";
  const tags = operation.tags?.length ? `\n\nTags: ${operation.tags.join(", ")}` : "";
  const deprecated = operation.deprecated ? "\n\n⚠️ DEPRECATED" : "";

  return `${summary}${description}${tags}${deprecated}`;
}

function buildInputSchema(operation: OpenAPIOperation): Schema<unknown> {
  return lazySchema(defineSchema((v) => {
    const shape: Record<string, Schema<unknown>> = {};
    const params = operation.parameters ?? [];

    for (const param of params) {
      if (param.in !== "path") continue;
      shape[param.name] = withRequired(buildParamSchema(v, param), param.required);
    }

    addParamGroup(v, shape, params, "query", "query", "Query parameters");
    addParamGroup(v, shape, params, "header", "headers", "Request headers");

    if (operation.requestBody) {
      shape.body = withRequired(
        v.unknown().describe("Request body (JSON)"),
        operation.requestBody.required,
      );
    }

    return v.object(shape);
  }));
}

function addParamGroup(
  v: SchemaValidator,
  shape: Record<string, Schema<unknown>>,
  params: OpenAPIParameter[],
  paramIn: "query" | "header",
  key: "query" | "headers",
  description: string,
): void {
  const groupParams = params.filter((p) => p.in === paramIn);
  if (!groupParams.length) return;

  const groupShape: Record<string, Schema<unknown>> = {};
  for (const param of groupParams) {
    groupShape[param.name] = withRequired(buildParamSchema(v, param), param.required);
  }

  shape[key] = v.object(groupShape).optional().describe(description);
}

function withRequired(schema: Schema<unknown>, required?: boolean): Schema<unknown> {
  return required ? schema : schema.optional();
}

function buildParamSchema(
  v: SchemaValidator,
  param: OpenAPIParameter,
): Schema<unknown> {
  const schema = param.schema;
  if (!schema) return v.string();

  switch (schema.type) {
    case "integer":
    case "number":
      return v.coerce.number();
    case "boolean":
      return v.coerce.boolean();
    case "array":
      return v.array(v.string());
    default:
      return v.string();
  }
}

async function executeAPICall(
  config: NormalizedMCPToolsConfig,
  method: string,
  path: string,
  input: Record<string, unknown>,
  operation: OpenAPIOperation,
  context?: ToolExecutionContext,
): Promise<unknown> {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new TypeError("OpenAPI operation path must start with one slash");
  }
  let resolvedPath = path;

  const params = operation.parameters ?? [];
  for (const param of params) {
    if (param.in !== "path") continue;

    const value = input[param.name];
    if (value === undefined || value === null) {
      if (param.required) throw new TypeError(`Missing required path parameter: ${param.name}`);
      continue;
    }

    resolvedPath = resolvedPath.replaceAll(`{${param.name}}`, encodeURIComponent(String(value)));
  }
  if (/\{[^}]+\}/.test(resolvedPath)) throw new TypeError("OpenAPI operation path is unresolved");

  const url = new URL(resolvedPath, config.baseUrl);
  if (url.origin !== config.baseUrl.origin) {
    throw new TypeError("OpenAPI operation path changed origin");
  }

  const queryParams = input.query as Record<string, unknown> | undefined;
  if (queryParams && Object.keys(queryParams).length) {
    const allowedQueryParams = new Set(
      params.filter((param) => param.in === "query").map((param) => param.name),
    );
    for (const [key, value] of Object.entries(queryParams)) {
      if (value === undefined || value === null) continue;
      if (!allowedQueryParams.has(key)) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== undefined && item !== null) url.searchParams.append(key, String(item));
        }
      } else if (typeof value === "object") {
        throw new TypeError(`Query parameter ${key} must be a primitive or array`);
      } else {
        url.searchParams.append(key, String(value));
      }
    }
  }

  const headers = new Headers();
  const allowedInputHeaders = new Set(
    params.filter((param) => param.in === "header").map((param) => param.name.toLowerCase()),
  );
  for (const [name, value] of Object.entries(input.headers as Record<string, unknown> ?? {})) {
    const normalizedName = name.toLowerCase();
    if (!allowedInputHeaders.has(normalizedName) || FORBIDDEN_CALLER_HEADERS.has(normalizedName)) {
      continue;
    }
    if (typeof value !== "string") throw new TypeError(`Header ${name} must be a string`);
    headers.set(name, value);
  }
  for (const [name, value] of config.headers) headers.set(name, value);

  const requestInit: RequestInit = {
    method: method.toUpperCase(),
    headers,
  };

  if (["post", "put", "patch"].includes(method) && input.body !== undefined) {
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    requestInit.body = JSON.stringify(input.body);
  }

  logger.debug("Executing API call", { method, path });

  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort(new DOMException("API call timed out", "TimeoutError"));
  }, config.timeoutMs);
  const abortFromContext = () => abortController.abort(context?.abortSignal?.reason);
  if (context?.abortSignal?.aborted) abortFromContext();
  else context?.abortSignal?.addEventListener("abort", abortFromContext, { once: true });
  requestInit.signal = abortController.signal;

  try {
    const response = await fetchWithSameOriginRedirects(url, requestInit, config.baseUrl.origin);
    const contentType = response.headers.get("content-type") ?? "";
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null) {
      if (!/^\d+$/.test(contentLength)) {
        throw new TypeError("API response Content-Length is invalid");
      }
      if (Number(contentLength) > config.maxResponseBytes) {
        await response.body?.cancel().catch(() => {});
        throw new RangeError("API response exceeded the configured size limit");
      }
    }
    const body = await readResponseTextPrefix(response, config.maxResponseBytes + 1);
    if (
      body.truncated || new TextEncoder().encode(body.text).byteLength > config.maxResponseBytes
    ) {
      throw new RangeError("API response exceeded the configured size limit");
    }

    let data: unknown;
    if (contentType.toLowerCase().includes("application/json")) {
      data = body.text ? JSON.parse(body.text) : null;
    } else {
      data = body.text;
    }

    return {
      status: response.status,
      statusText: response.statusText,
      data,
    };
  } catch (error) {
    logger.error("API call failed", {
      errorName: error instanceof Error ? error.name : typeof error,
      method,
      path,
    });
    const message = error instanceof RangeError &&
        error.message === "API response exceeded the configured size limit"
      ? error.message
      : timedOut
      ? "API call timed out"
      : context?.abortSignal?.aborted
      ? "API call was cancelled"
      : "API call failed";
    return {
      error: true,
      message,
    };
  } finally {
    clearTimeout(timeout);
    context?.abortSignal?.removeEventListener("abort", abortFromContext);
  }
}

async function fetchWithSameOriginRedirects(
  initialUrl: URL,
  initialInit: RequestInit,
  allowedOrigin: string,
): Promise<Response> {
  let url = initialUrl;
  let init = { ...initialInit, redirect: "manual" as const };

  for (let redirectCount = 0; redirectCount <= MAX_API_REDIRECTS; redirectCount++) {
    const response = await fetch(url, init);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    await response.body?.cancel().catch(() => {});
    if (redirectCount === MAX_API_REDIRECTS) throw new Error("API redirect limit exceeded");

    const redirected = new URL(location, url);
    if (redirected.origin !== allowedOrigin) throw new Error("API redirect changed origin");
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && init.method === "POST")
    ) {
      init = { ...init, method: "GET", body: undefined };
    }
    url = redirected;
  }

  throw new Error("API redirect validation failed");
}
