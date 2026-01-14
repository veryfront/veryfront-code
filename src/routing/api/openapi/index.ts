/**
 * OpenAPI Module
 *
 * Automatic OpenAPI documentation generation for veryfront API routes.
 *
 * Features:
 * - `/_openapi.json` / `/_openapi.yaml` - Raw OpenAPI 3.1.0 spec
 * - `/_docs` - Interactive API documentation using Scalar
 * - MCP resource `openapi://spec` - AI agents can discover your API
 * - MCP tools `api:*` - AI agents can call your API endpoints
 *
 * @module routing/api/openapi
 *
 * @example
 * ```typescript
 * // In your API route file:
 * import { createRoute, z } from "veryfront/openapi";
 *
 * export const GET = createRoute({
 *   summary: "Get user by ID",
 *   params: z.object({ id: z.string() }),
 *   response: {
 *     200: z.object({ id: z.string(), name: z.string() }),
 *   },
 *   handler: async (request, { params }) => {
 *     return Response.json({ id: params.id, name: "John" });
 *   },
 * });
 * ```
 *
 * Access the generated OpenAPI spec at `/_openapi.json` or `/_openapi.yaml`.
 * View interactive docs at `/_docs`.
 */

// Main exports for users
export { createRoute, z } from "./create-route.ts";

// Types for advanced usage
export type {
  OpenAPIOperation,
  OpenAPIParameter,
  OpenAPIPathItem,
  OpenAPIRouteConfig,
  OpenAPIRouteMetadata,
  OpenAPISpec,
  WrappedHandler,
} from "./types.ts";

export { OPENAPI_METADATA } from "./types.ts";

// Internal utilities (for framework use)
export { extractPathParams, generateOperationId, toOpenAPIPath } from "./path-utils.ts";
export { generateOpenAPIJson, generateOpenAPISpec, specToYaml } from "./spec-generator.ts";

// MCP integration
export { createOpenAPIResource } from "./mcp-resource.ts";
export { generateMCPToolsFromSpec, type MCPToolsConfig } from "./mcp-tools.ts";
export {
  isOpenAPIMCPEnabled,
  type OpenAPIMCPConfig,
  registerOpenAPIMCP,
} from "./mcp-integration.ts";
