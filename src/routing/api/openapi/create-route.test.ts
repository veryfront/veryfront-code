import "#veryfront/schemas/_test-setup.ts";
/**
 * createRoute wrapper tests
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createRoute, defineSchema } from "./create-route.ts";
import { OPENAPI_METADATA, type OpenAPIRouteMetadata } from "./types.ts";

function getMetadata(handler: unknown): OpenAPIRouteMetadata {
  const metadata = (handler as Record<string | symbol, unknown>)[OPENAPI_METADATA];
  assertExists(metadata);
  return metadata as OpenAPIRouteMetadata;
}

describe("createRoute", () => {
  it("should attach metadata to handler", () => {
    const handler = createRoute({
      summary: "Get user",
      handler: () => new Response("ok"),
    });

    const metadata = getMetadata(handler);
    assertEquals(metadata.summary, "Get user");
  });

  it("should convert params schema to JSON Schema", () => {
    const handler = createRoute({
      params: defineSchema((v) =>
        v.object({
          id: v.string().uuid(),
        })
      )(),
      handler: () => new Response("ok"),
    });

    const metadata = getMetadata(handler);
    assertExists(metadata.params);
    assertEquals(metadata.params.type, "object");
    assertExists(metadata.params.properties?.id);
  });

  it("should convert query schema to JSON Schema", () => {
    const handler = createRoute({
      query: defineSchema((v) =>
        v.object({
          page: v.coerce.number().optional(),
          limit: v.coerce.number().default(10),
        })
      )(),
      handler: () => new Response("ok"),
    });

    const metadata = getMetadata(handler);
    assertExists(metadata.query);
    assertEquals(metadata.query.type, "object");
    assertExists(metadata.query.properties?.page);
    assertExists(metadata.query.properties?.limit);
  });

  it("should convert body schema to JSON Schema", () => {
    const handler = createRoute({
      body: defineSchema((v) =>
        v.object({
          name: v.string(),
          email: v.string().email(),
        })
      )(),
      handler: () => new Response("ok"),
    });

    const metadata = getMetadata(handler);
    assertExists(metadata.body);
    assertEquals(metadata.body.type, "object");
    assertExists(metadata.body.properties?.name);
    assertExists(metadata.body.properties?.email);
  });

  it("should handle response with schema only", () => {
    const handler = createRoute({
      response: {
        200: defineSchema((v) => v.object({ id: v.string() }))(),
      },
      handler: () => new Response("ok"),
    });

    const metadata = getMetadata(handler);
    assertExists(metadata.responses);
    assertExists(metadata.responses["200"]);
    assertEquals(metadata.responses["200"].description, "Successful response");
  });

  it("should handle response with schema and description", () => {
    const handler = createRoute({
      response: {
        200: {
          schema: defineSchema((v) => v.object({ id: v.string() }))(),
          description: "User found",
        },
        404: {
          schema: defineSchema((v) => v.object({ error: v.string() }))(),
          description: "User not found",
        },
      },
      handler: () => new Response("ok"),
    });

    const metadata = getMetadata(handler);
    assertExists(metadata.responses);
    assertExists(metadata.responses["200"]);
    assertExists(metadata.responses["404"]);
    assertEquals(metadata.responses["200"]!.description, "User found");
    assertEquals(metadata.responses["404"]!.description, "User not found");
  });

  it("should preserve tags and deprecated flag", () => {
    const handler = createRoute({
      tags: ["Users", "Admin"],
      deprecated: true,
      handler: () => new Response("ok"),
    });

    const metadata = getMetadata(handler);
    assertEquals(metadata.tags, ["Users", "Admin"]);
    assertEquals(metadata.deprecated, true);
  });

  it("should return callable handler", async () => {
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

  it("does not overwrite metadata when the same handler is reused", () => {
    const sharedHandler = () => new Response("ok");
    const first = createRoute({ summary: "First route", handler: sharedHandler });
    const second = createRoute({ summary: "Second route", handler: sharedHandler });

    assertEquals(first === second, false);
    assertEquals(getMetadata(first).summary, "First route");
    assertEquals(getMetadata(second).summary, "Second route");
    assertEquals(OPENAPI_METADATA in sharedHandler, false);
  });

  it("rejects response status codes outside the HTTP range", () => {
    let message = "";
    try {
      createRoute({
        response: {
          999: defineSchema((v) => v.object({ ok: v.boolean() }))(),
        },
        handler: () => new Response("ok"),
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    assertEquals(message.includes("HTTP status code"), true);
  });
});
