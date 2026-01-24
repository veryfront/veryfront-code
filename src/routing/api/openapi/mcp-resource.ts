import { resource } from "#veryfront/resource";
import { z } from "zod";
import type { OpenAPISpec } from "./types.ts";

export function createOpenAPIResource(
  getSpec: () => Promise<OpenAPISpec>,
): ReturnType<typeof resource> {
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
          tags: spec.tags?.map((t) => t.name) ?? [],
        },
      };
    },
    mcp: {
      enabled: true,
      cachePolicy: "cache",
    },
  });
}
