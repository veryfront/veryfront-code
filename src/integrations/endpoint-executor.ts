/**
 * Endpoint Executor
 *
 * Executes HTTP requests defined by connector.json endpoint specs.
 * Port of veryfront-api's execute-endpoint.ts for Deno/renderer execution.
 * Supports both REST and GraphQL endpoints.
 */

import { logger } from "#veryfront/utils";
import type { IntegrationEndpoint } from "./types.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

const PRIVATE_IP_RANGES = [
  /^127\./, // 127.0.0.0/8
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // 169.254.0.0/16
  /^0\./, // 0.0.0.0/8
  /^::1$/, // IPv6 loopback
  /^f[cd][0-9a-f]{2}:/i, // IPv6 unique local (fc00::/7)
  /^fe80:/i, // IPv6 link-local (fe80::/10)
];

export function validateEndpointUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw INVALID_ARGUMENT.create({ detail: `Invalid endpoint URL: ${url}` });
  }

  if (parsed.protocol !== "https:") {
    throw INVALID_ARGUMENT.create({
      detail: `Endpoint URL must use HTTPS: ${parsed.protocol}`,
    });
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost") {
    throw INVALID_ARGUMENT.create({
      detail: "Endpoint URL must not target localhost",
    });
  }

  // Strip IPv6 brackets for regex matching
  const bare = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;

  for (const range of PRIVATE_IP_RANGES) {
    if (range.test(bare)) {
      throw INVALID_ARGUMENT.create({
        detail: "Endpoint URL must not target private/internal networks",
      });
    }
  }
}

interface ExecutionContext {
  integration: string;
  toolId: string;
}

export async function executeEndpoint(
  endpoint: IntegrationEndpoint,
  args: Record<string, unknown>,
  accessToken: string,
  ctx: ExecutionContext,
): Promise<{ result: unknown; status: number }> {
  if (endpoint.type === "graphql") {
    return executeGraphQL(endpoint, args, accessToken, ctx);
  }
  return executeRest(endpoint, args, accessToken, ctx);
}

async function executeGraphQL(
  endpoint: IntegrationEndpoint,
  args: Record<string, unknown>,
  accessToken: string,
  ctx: ExecutionContext,
): Promise<{ result: unknown; status: number }> {
  if (!endpoint.query) {
    throw INVALID_ARGUMENT.create({
      detail: `GraphQL endpoint for ${ctx.integration}:${ctx.toolId} missing query`,
    });
  }

  // Build variables from params
  const variables: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(endpoint.params ?? {})) {
    if (args[key] !== undefined) {
      variables[key] = args[key];
    } else if (def.default !== undefined) {
      variables[key] = def.default;
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  // Add header params
  for (const [key, def] of Object.entries(endpoint.params ?? {})) {
    if (def.in === "header") {
      headers[key] = args[key] !== undefined ? String(args[key]) : String(def.default ?? "");
    }
  }

  validateEndpointUrl(endpoint.url);

  logger.debug("Executing GraphQL endpoint", {
    integration: ctx.integration,
    tool: ctx.toolId,
  });

  const response = await fetch(endpoint.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: endpoint.query,
      variables: Object.keys(variables).length > 0 ? variables : undefined,
    }),
  });

  const data = (await response.json()) as { data?: unknown; errors?: unknown[] };

  if (data.errors) {
    return { result: data, status: response.ok ? 200 : response.status };
  }

  let result: unknown = data.data;
  if (endpoint.response?.transform && typeof result === "object" && result !== null) {
    result = (result as Record<string, unknown>)[endpoint.response.transform];
  }

  return { result, status: response.status };
}

async function executeRest(
  endpoint: IntegrationEndpoint,
  args: Record<string, unknown>,
  accessToken: string,
  ctx: ExecutionContext,
): Promise<{ result: unknown; status: number }> {
  // 1. Build URL — replace {path} params
  let url = endpoint.url;
  for (const [key, def] of Object.entries(endpoint.params ?? {})) {
    if (def.in === "path") {
      const value = args[key];
      if (value === undefined) {
        throw INVALID_ARGUMENT.create({ detail: `Missing required path parameter: ${key}` });
      }
      url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
    }
  }

  // 2. Add query params
  const urlObj = new URL(url);
  for (const [key, def] of Object.entries(endpoint.params ?? {})) {
    if (def.in === "query" && args[key] !== undefined) {
      if (Array.isArray(args[key])) {
        for (const v of args[key] as unknown[]) {
          urlObj.searchParams.append(key, String(v));
        }
      } else {
        urlObj.searchParams.set(key, String(args[key]));
      }
    }
  }

  // 3. Build headers
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };

  for (const [key, def] of Object.entries(endpoint.params ?? {})) {
    if (def.in === "header") {
      const value = args[key] ?? def.default;
      if (value !== undefined) headers[key] = String(value);
    }
  }

  // 4. Build body for write operations
  let body: string | undefined;
  if (endpoint.body && ["POST", "PUT", "PATCH"].includes(endpoint.method)) {
    const bodyObj: Record<string, unknown> = {};
    for (const key of Object.keys(endpoint.body)) {
      if (args[key] !== undefined) {
        bodyObj[key] = args[key];
      }
    }
    body = JSON.stringify(bodyObj);
    headers["Content-Type"] = endpoint.contentType ?? "application/json";
  }

  validateEndpointUrl(urlObj.toString());

  logger.debug("Executing REST endpoint", {
    integration: ctx.integration,
    tool: ctx.toolId,
    method: endpoint.method,
  });

  // 5. Execute request
  const response = await fetch(urlObj.toString(), {
    method: endpoint.method,
    headers,
    body,
  });

  // 6. Parse response
  let data: unknown;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  // 7. Apply response transform
  const result = endpoint.response?.transform && typeof data === "object" && data !== null
    ? (data as Record<string, unknown>)[endpoint.response.transform]
    : data;

  return { result, status: response.status };
}
