/**
 * createRoute wrapper tests
 */

import { assertEquals, assertExists } from "@std/assert";
import { createRoute, z } from "./create-route.ts";
import { OPENAPI_METADATA, type OpenAPIRouteMetadata } from "./types.ts";

Deno.test("createRoute", async (t) => {
  await t.step("should attach metadata to handler", () => {
    const handler = createRoute({
      summary: "Get user",
      handler: () => new Response("ok"),
    });

    const metadata = handler[OPENAPI_METADATA] as OpenAPIRouteMetadata;
    assertExists(metadata);
    assertEquals(metadata.summary, "Get user");
  });

  await t.step("should convert params schema to JSON Schema", () => {
    const handler = createRoute({
      params: z.object({
        id: z.string().uuid(),
      }),
      handler: () => new Response("ok"),
    });

    const metadata = handler[OPENAPI_METADATA] as OpenAPIRouteMetadata;
    assertExists(metadata.params);
    assertEquals(metadata.params.type, "object");
    assertExists(metadata.params.properties?.id);
  });

  await t.step("should convert query schema to JSON Schema", () => {
    const handler = createRoute({
      query: z.object({
        page: z.coerce.number().optional(),
        limit: z.coerce.number().default(10),
      }),
      handler: () => new Response("ok"),
    });

    const metadata = handler[OPENAPI_METADATA] as OpenAPIRouteMetadata;
    assertExists(metadata.query);
    assertEquals(metadata.query.type, "object");
    assertExists(metadata.query.properties?.page);
    assertExists(metadata.query.properties?.limit);
  });

  await t.step("should convert body schema to JSON Schema", () => {
    const handler = createRoute({
      body: z.object({
        name: z.string(),
        email: z.string().email(),
      }),
      handler: () => new Response("ok"),
    });

    const metadata = handler[OPENAPI_METADATA] as OpenAPIRouteMetadata;
    assertExists(metadata.body);
    assertEquals(metadata.body.type, "object");
    assertExists(metadata.body.properties?.name);
    assertExists(metadata.body.properties?.email);
  });

  await t.step("should handle response with schema only", () => {
    const handler = createRoute({
      response: {
        200: z.object({ id: z.string() }),
      },
      handler: () => new Response("ok"),
    });

    const metadata = handler[OPENAPI_METADATA] as OpenAPIRouteMetadata;
    assertExists(metadata.responses);
    assertExists(metadata.responses["200"]);
    assertEquals(metadata.responses["200"].description, "Successful response");
  });

  await t.step("should handle response with schema and description", () => {
    const handler = createRoute({
      response: {
        200: {
          schema: z.object({ id: z.string() }),
          description: "User found",
        },
        404: {
          schema: z.object({ error: z.string() }),
          description: "User not found",
        },
      },
      handler: () => new Response("ok"),
    });

    const metadata = handler[OPENAPI_METADATA] as OpenAPIRouteMetadata;
    assertExists(metadata.responses);
    assertExists(metadata.responses["200"]);
    assertExists(metadata.responses["404"]);
    assertEquals(metadata.responses["200"]!.description, "User found");
    assertEquals(metadata.responses["404"]!.description, "User not found");
  });

  await t.step("should preserve tags and deprecated flag", () => {
    const handler = createRoute({
      tags: ["Users", "Admin"],
      deprecated: true,
      handler: () => new Response("ok"),
    });

    const metadata = handler[OPENAPI_METADATA] as OpenAPIRouteMetadata;
    assertEquals(metadata.tags, ["Users", "Admin"]);
    assertEquals(metadata.deprecated, true);
  });

  await t.step("should return callable handler", async () => {
    const handler = createRoute({
      handler: () => new Response("success"),
    });

    const mockContext = {
      params: {},
      searchParams: new URLSearchParams(),
    };
    const response = await handler(new Request("http://test.com"), mockContext);
    assertEquals(await response.text(), "success");
  });
});
