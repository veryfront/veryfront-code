/**
 * OpenAPI MCP Resource
 *
 * Exposes the OpenAPI specification as an MCP resource for AI agent discovery.
 *
 * @module routing/api/openapi/mcp-resource
 */

import { resource } from "#veryfront/resource";
import { z } from "zod";
import type { OpenAPISpec } from "./types.ts";

/**
 * Create an MCP resource that exposes the OpenAPI specification.
 *
 * AI agents can read this resource to understand available API endpoints,
 * their parameters, request/response schemas, and authentication requirements.
 *
 * @param getSpec - Function that returns the OpenAPI specification
 * @returns MCP resource for the OpenAPI spec
 *
 * @example
 * ```typescript
 * const resource = createOpenAPIResource(async () => {
 *   return await generateOpenAPISpec(router, projectDir, adapter, config);
 * });
 *
 * registerResource("openapi_spec", resource);
 * ```
 */
export function createOpenAPIResource(getSpec: () => Promise<OpenAPISpec>) {
  return resource({
    pattern: "openapi://spec",
    description:
      "OpenAPI specification for this project's API routes. Use this to understand available endpoints, their parameters, request/response schemas, and authentication requirements.",
    paramsSchema: z.object({}),
    load: async () => {
      const spec = await getSpec();

      return {
        spec,
        summary: {
          title: spec.info.title,
          version: spec.info.version,
          endpoints: Object.keys(spec.paths).length,
          tags: spec.tags?.map((t) => t.name) || [],
        },
      };
    },
    mcp: {
      enabled: true,
      cachePolicy: "cache",
    },
  });
}
